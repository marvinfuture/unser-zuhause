import multer from "multer";
import type { Request, Response } from "express";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, statfsSync, existsSync } from "node:fs";
import { readFile, rename, rm, readdir, lstat } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { HttpError, type AppContext } from "./app.js";
import type {
  Photo,
  Comparison,
  Project,
  Defect,
  ProfileId,
} from "../shared/types.js";
import { isBackupRunning } from "./backup.js";

const MAX_FILE = 25 * 1024 * 1024;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export interface MediaMetadata {
  original: string;
  display: string;
  thumb: string;
  sha256: string;
  storedBytes: number;
}
interface ImageResult {
  mime: string;
  ext: string;
  width: number;
  height: number;
  displayBytes: number;
  thumbBytes: number;
}
interface MediaOptions {
  minFreeBytes?: number;
  limitBytes?: number;
}
/**
 * Summiert den in der Datenbank erfassten Platz für Originale und Ableitungen, einschließlich Papierkorb. Dateisystemreste ohne Datensatz sind hierin nicht enthalten.
 */
export function mediaUsage(ctx: AppContext): number {
  return ctx.db
    .list<Photo>("photos")
    .reduce(
      (sum, photo) =>
        sum +
        (ctx.db.getSetting<MediaMetadata>(`media:${photo.id}`)?.storedBytes ??
          photo.bytes),
      0,
    );
}
/**
 * Liefert den aktuell verfügbaren Speicher des Datenlaufwerks in Byte.
 */
export function freeSpace(dataDir: string): number {
  const s = statfsSync(dataDir);
  return Number(s.bavail) * Number(s.bsize);
}
/**
 * Liest die konfigurierte Medienobergrenze und rechnet GiB in Byte um. Fehlende oder ungültige Werte ergeben den Standard von 20 GiB.
 */
export const mediaLimit = () => {
  const value = Number(process.env.UZ_MEDIA_LIMIT_GB ?? 20);
  return (Number.isFinite(value) && value > 0 ? value : 20) * 1024 ** 3;
};
/**
 * Löst einen internen Dateipfad auf und erlaubt nur Ziele innerhalb des Medienordners; absolute Ausweichpfade und Traversal werden abgefangen.
 */
function safeMediaPath(dataDir: string, path: string): string {
  const root = resolve(dataDir, "media"),
    full = resolve(dataDir, path),
    rel = relative(root, full);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new HttpError(500, "Ungültiger interner Medienpfad.");
  return full;
}
/**
 * Startet die Bildprüfung in einem separaten Worker und liefert Format sowie Größe der erzeugten Vorschauen. Timeout oder Decoderfehler beenden den Worker, bevor die Anfrage fortgesetzt wird.
 */
export function processImage(
  input: string,
  display: string,
  thumb: string,
): Promise<ImageResult> {
  return new Promise((done, fail) => {
    const worker = new Worker(new URL("./image-worker.mjs", import.meta.url), {
      workerData: { input, display, thumb, maxPixels: 60_000_000 },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
      execArgv: [],
    });
    let finished = false;
    /**
     * Beendet genau einmal den Bild-Worker und löst erst nach dessen Ende das Ergebnis oder den Fehler aus. So werden Windows-Dateihandles vor der Bereinigung freigegeben.
     */
    const finish = (error?: Error, value?: ImageResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      // Vor dem Aufräumen unter Windows auf das Ende der Decoderarbeit und ihrer Dateihandles warten.
      void worker.terminate().then(
        () => {
          if (error) fail(error);
          else done(value!);
        },
        () =>
          fail(
            error ??
              new HttpError(
                422,
                "Die Bildverarbeitung konnte nicht beendet werden.",
                "IMAGE_INVALID",
              ),
          ),
      );
    };
    const timer = setTimeout(
      () =>
        finish(
          new HttpError(
            422,
            "Die Bildverarbeitung dauerte zu lange. Bitte ein kleineres Foto verwenden.",
            "IMAGE_TIMEOUT",
          ),
        ),
      30_000,
    );
    worker.on("message", (msg) =>
      msg.ok
        ? finish(undefined, msg.result)
        : finish(new HttpError(422, msg.message, "IMAGE_INVALID")),
    );
    worker.on("error", () =>
      finish(
        new HttpError(
          422,
          "Das Bild konnte nicht sicher verarbeitet werden. Bitte als JPEG erneut versuchen.",
          "IMAGE_INVALID",
        ),
      ),
    );
    worker.on("exit", () => {
      if (!finished)
        finish(
          new HttpError(
            422,
            "Die Bildverarbeitung wurde beendet.",
            "IMAGE_INVALID",
          ),
        );
    });
  });
}

/**
 * Entfernt abgelaufene Papierkorbfotos ohne Vergleichsverweise sowie alte temporäre und verwaiste Dateien. Referenzierte Medien und laufende Sicherungen bleiben geschützt.
 */
export async function cleanupMedia(ctx: AppContext): Promise<void> {
  if (isBackupRunning(ctx.db.dataDir)) return;
  const comparisons = ctx.db.list<Comparison>("comparisons");
  const cutoff = Date.now() - 30 * 86_400_000;
  for (const photo of ctx.db.list<Photo>("photos")) {
    if (
      !photo.deletedAt ||
      new Date(photo.deletedAt).getTime() > cutoff ||
      comparisons.some((c) => c.beforeId === photo.id || c.afterId === photo.id)
    )
      continue;
    if (isBackupRunning(ctx.db.dataDir)) return;
    const meta = ctx.db.getSetting<MediaMetadata>(`media:${photo.id}`);
    // Datenbankverweise vor dem ersten asynchronen Löschschritt entfernen, damit neue Snapshots diese Dateien nicht mehr benötigen.
    ctx.db.transaction(() => {
      ctx.db.remove("photos", photo.id);
      ctx.db.raw
        .prepare("DELETE FROM settings WHERE key=?")
        .run(`media:${photo.id}`);
    });
    if (meta)
      for (const key of ["original", "display", "thumb"] as const)
        await rm(safeMediaPath(ctx.db.dataDir, meta[key]), { force: true });
  }
  const tmp = join(ctx.db.dataDir, "media", "tmp");
  for (const item of await readdir(tmp).catch(() => [])) {
    const path = safeMediaPath(ctx.db.dataDir, join("media", "tmp", item));
    const info = await lstat(path).catch(() => null);
    if (info?.isFile() && info.mtimeMs < Date.now() - 86_400_000)
      await rm(path, { force: true });
  }
  // Ein Absturz zwischen Dateiumzug und SQLite-Transaktion kann verwaiste Dateien hinterlassen.
  // Die eintägige Schutzfrist lässt aktuellen Uploads Zeit, ihre Datenbankeinträge anzulegen.
  const referenced = new Set(
    ctx.db.list<Photo>("photos").flatMap((photo) => {
      const meta = ctx.db.getSetting<MediaMetadata>(`media:${photo.id}`);
      return meta
        ? [meta.original, meta.display, meta.thumb].map((p) =>
            safeMediaPath(ctx.db.dataDir, p),
          )
        : [];
    }),
  );
  for (const dir of ["originals", "display", "thumb"]) {
    for (const name of await readdir(join(ctx.db.dataDir, "media", dir)).catch(
      () => [],
    )) {
      if (!/^[a-f0-9-]{36}\.(jpg|png|webp|heic)$/.test(name)) continue;
      const path = safeMediaPath(ctx.db.dataDir, join("media", dir, name));
      if (referenced.has(path)) continue;
      const info = await lstat(path).catch(() => null);
      if (
        info?.isFile() &&
        info.mtimeMs < Date.now() - 86_400_000 &&
        !isBackupRunning(ctx.db.dataDir)
      )
        await rm(path, { force: true });
    }
  }
}

/**
 * Legt Medienordner an und registriert geschützte Upload-, Abruf- und Änderungsrouten. Es wird höchstens ein Upload gleichzeitig verarbeitet.
 */
export function registerMedia(
  ctx: AppContext,
  options: MediaOptions = {},
): void {
  const { app, db, requireAuth, requireWrite, assertProfile } = ctx;
  const root = join(db.dataDir, "media"),
    tmp = join(root, "tmp");
  for (const dir of [
    tmp,
    join(root, "originals"),
    join(root, "display"),
    join(root, "thumb"),
  ])
    mkdirSync(dir, { recursive: true });
  const receiver = multer({
    dest: tmp,
    limits: {
      fileSize: MAX_FILE,
      files: 1,
      fields: 10,
      fieldSize: 2048,
      parts: 12,
    },
  }).single("file");
  /**
   * Überführt Multers Multipart-Verarbeitung in ein Promise und begrenzt Dateigröße, Dateianzahl und Formularfelder; Fehler werden an den Upload-Handler weitergereicht.
   */
  const receive = (req: Request, res: Response) =>
    new Promise<void>((done, fail) =>
      receiver(req, res, (err) => (err ? fail(err) : done())),
    );
  let busy = false;
  /** POST /api/photos: verarbeitet einen geschützten, begrenzten Upload; erst bestätigte Dateien erhalten einen sichtbaren Datenbankeintrag. */
  app.post("/api/photos", requireWrite, async (req, res, next) => {
    if (busy)
      return next(
        new HttpError(
          409,
          "Ein Foto wird gerade verarbeitet. Bitte gleich erneut versuchen.",
          "UPLOAD_BUSY",
        ),
      );
    busy = true;
    const staging: string[] = [];
    const committedPaths: string[] = [];
    let saved = false;
    let cleaned = false;
    /**
     * Bereinigt temporäre oder noch nicht bestätigte Dateien genau einmal und gibt die Upload-Sperre frei. Erfolgreich gespeicherte Originale und Vorschauen bleiben bestehen.
     */
    const clean = async () => {
      if (cleaned) return;
      cleaned = true;
      if (req.file?.path && !staging.includes(req.file.path))
        staging.push(req.file.path);
      await Promise.all(
        [...staging, ...(saved ? [] : committedPaths)].map((path) =>
          rm(safeMediaPath(db.dataDir, path), { force: true }).catch(() => {}),
        ),
      );
      busy = false;
    };
    try {
      if (
        freeSpace(db.dataDir) <
        (options.minFreeBytes ?? 10 * 1024 ** 3) + MAX_FILE * 3
      )
        throw new HttpError(
          507,
          "Auf dem PC ist zu wenig freier Speicher für ein weiteres Foto.",
          "STORAGE_FULL",
        );
      if (mediaUsage(ctx) + MAX_FILE > (options.limitBytes ?? mediaLimit()))
        throw new HttpError(
          507,
          "Der Fotospeicher ist voll. Bitte die Speichergrenze prüfen.",
          "STORAGE_FULL",
        );
      await receive(req, res);
      if (!req.file)
        throw new HttpError(400, "Bitte ein Foto auswählen.", "VALIDATION");
      staging.push(
        req.file.path,
        req.file.path + ".display.webp",
        req.file.path + ".thumb.webp",
      );
      const allowed = [
        "profileVersion",
        "projectId",
        "defectId",
        "category",
        "title",
        "requestId",
      ];
      if (
        Object.entries(req.body).some(
          ([key, value]) => !allowed.includes(key) || typeof value !== "string",
        )
      )
        throw new HttpError(
          400,
          "Ungültige oder mehrfach übermittelte Fotoangaben.",
          "VALIDATION",
        );
      const actor = assertProfile(req, req.body.profileVersion);
      const projectId = req.body.projectId || null,
        defectId = req.body.defectId || null;
      if ((!projectId && !defectId) || (projectId && defectId))
        throw new HttpError(
          400,
          "Das Foto benötigt genau ein Projekt oder einen Mangel.",
          "VALIDATION",
        );
      if (
        (projectId &&
          (typeof projectId !== "string" || !UUID.test(projectId))) ||
        (defectId && (typeof defectId !== "string" || !UUID.test(defectId)))
      )
        throw new HttpError(
          400,
          "Ungültige Zuordnung für das Foto.",
          "VALIDATION",
        );
      const target = projectId
        ? db.get<Project>("projects", projectId)
        : db.get<Defect>("defects", defectId);
      if (!target || target.archivedAt)
        throw new HttpError(
          400,
          "Das zugehörige Projekt oder der Mangel ist nicht verfügbar.",
          "VALIDATION",
        );
      const category = req.body.category ?? "progress";
      if (!["before", "progress", "after"].includes(category))
        throw new HttpError(400, "Ungültige Fotokategorie.", "VALIDATION");
      const title = String(req.body.title ?? "").trim();
      if (title.length > 160)
        throw new HttpError(
          400,
          "Die Bildunterschrift darf höchstens 160 Zeichen haben.",
          "VALIDATION",
        );
      if (!UUID.test(req.body.requestId ?? ""))
        throw new HttpError(400, "Ungültige Uploadkennung.", "VALIDATION");
      const key = `photos:${actor}:${req.body.requestId}`;
      const sha256 = createHash("sha256")
        .update(await readFile(req.file.path))
        .digest("hex");
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({ sha256, projectId, defectId, category, title }),
        )
        .digest("hex");
      const existing = db.getIdempotent<{ photo: Photo; fingerprint: string }>(
        key,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "Diese Uploadkennung wurde bereits für ein anderes Foto verwendet.",
            "REQUEST_CONFLICT",
          );
        await clean();
        return res.json(existing.photo);
      }
      const result = await processImage(staging[0], staging[1], staging[2]);
      assertProfile(req, req.body.profileVersion); // Nach der asynchronen Bildverarbeitung die Profilwahl erneut prüfen.
      const currentTarget = projectId
        ? db.get<Project>("projects", projectId)
        : db.get<Defect>("defects", defectId);
      if (!currentTarget || currentTarget.archivedAt)
        throw new HttpError(
          409,
          "Das zugehörige Projekt wurde inzwischen archiviert.",
          "VERSION_CONFLICT",
        );
      const storedBytes =
        req.file.size + result.displayBytes + result.thumbBytes;
      if (mediaUsage(ctx) + storedBytes > (options.limitBytes ?? mediaLimit()))
        throw new HttpError(507, "Der Fotospeicher ist voll.", "STORAGE_FULL");
      const id = randomUUID(),
        now = new Date().toISOString();
      const meta: MediaMetadata = {
        original: `media/originals/${id}.${result.ext}`,
        display: `media/display/${id}.webp`,
        thumb: `media/thumb/${id}.webp`,
        sha256,
        storedBytes,
      };
      for (const [i, k] of (
        ["original", "display", "thumb"] as const
      ).entries()) {
        const dest = safeMediaPath(db.dataDir, meta[k]);
        await rename(staging[i], dest);
        committedPaths.push(dest);
      }
      assertProfile(req, req.body.profileVersion);
      const finalTarget = projectId
        ? db.get<Project>("projects", projectId)
        : db.get<Defect>("defects", defectId);
      if (!finalTarget || finalTarget.archivedAt)
        throw new HttpError(
          409,
          "Das zugehörige Projekt wurde inzwischen archiviert.",
          "VERSION_CONFLICT",
        );
      const photo: Photo = {
        id,
        projectId,
        defectId,
        title,
        category,
        width: result.width,
        height: result.height,
        bytes: req.file.size,
        mime: result.mime,
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
        version: 1,
        archivedAt: null,
        deletedAt: null,
      };
      db.transaction(() => {
        db.put("photos", photo);
        db.setSetting(`media:${id}`, meta);
        db.saveIdempotent(key, { photo, fingerprint });
      });
      saved = true;
      await clean();
      res.status(201).json(photo);
    } catch (error) {
      await clean();
      if (error instanceof multer.MulterError)
        next(
          new HttpError(
            413,
            "Bitte ein einzelnes Foto mit höchstens 25 MB hochladen.",
            "UPLOAD_LIMIT",
          ),
        );
      else next(error);
    } finally {
      await clean();
    }
  });
  /** GET /api/photos/:id/file: liefert Original oder Vorschau nur mit gültiger Sitzung und ohne dauerhafte Browserablage. */
  app.get("/api/photos/:id/file", requireAuth, (req, res, next) => {
    try {
      const photo = db.get<Photo>("photos", String(req.params.id));
      if (!photo || photo.deletedAt)
        throw new HttpError(
          404,
          "Dieses Foto ist nicht verfügbar.",
          "NOT_FOUND",
        );
      const meta = db.getSetting<MediaMetadata>(`media:${photo.id}`);
      const variant = req.query.variant ?? "display";
      if (!meta || !["display", "thumb", "original"].includes(String(variant)))
        throw new HttpError(
          404,
          "Diese Bildansicht ist nicht verfügbar.",
          "NOT_FOUND",
        );
      const file = safeMediaPath(
        db.dataDir,
        meta[
          variant as keyof Pick<MediaMetadata, "original" | "display" | "thumb">
        ],
      );
      if (!existsSync(file))
        throw new HttpError(
          404,
          "Die Bilddatei fehlt. Bitte die Datensicherung prüfen.",
          "MEDIA_MISSING",
        );
      res.setHeader(
        "Content-Type",
        variant === "original" ? photo.mime : "image/webp",
      );
      res.setHeader("Cache-Control", "no-store");
      if (variant === "original")
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="foto-${photo.id}.${photo.mime === "image/jpeg" ? "jpg" : photo.mime.split("/")[1]}"`,
        );
      res.sendFile(file, { cacheControl: false }, (err) => {
        if (err) next(err);
      });
    } catch (error) {
      next(error);
    }
  });
  /** PATCH /api/photos/:id: ändert Beschriftung, Kategorie oder Papierkorbstatus konfliktgeschützt und schützt Bilder aktiver Vergleiche. */
  app.patch("/api/photos/:id", requireWrite, (req, res, next) => {
    try {
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).some(
          (key) =>
            ![
              "title",
              "category",
              "deletedAt",
              "profileVersion",
              "version",
            ].includes(key),
        )
      )
        throw new HttpError(400, "Ungültige Fotoangaben.", "VALIDATION");
      const actor: ProfileId = assertProfile(req, req.body.profileVersion);
      const photo = db.get<Photo>("photos", String(req.params.id));
      if (!photo) throw new HttpError(404, "Foto nicht gefunden.", "NOT_FOUND");
      if (req.body.version !== photo.version)
        throw new HttpError(
          409,
          "Das Foto wurde inzwischen geändert. Bitte neu laden.",
          "VERSION_CONFLICT",
          photo,
        );
      const updated = { ...photo };
      if ("title" in req.body) {
        if (
          typeof req.body.title !== "string" ||
          req.body.title.trim().length > 160
        )
          throw new HttpError(400, "Ungültige Bildunterschrift.", "VALIDATION");
        updated.title = req.body.title.trim();
      }
      if ("category" in req.body) {
        if (!["before", "progress", "after"].includes(req.body.category))
          throw new HttpError(400, "Ungültige Fotokategorie.", "VALIDATION");
        updated.category = req.body.category;
      }
      if ("deletedAt" in req.body) {
        if (
          req.body.deletedAt !== null &&
          (typeof req.body.deletedAt !== "string" ||
            !Number.isFinite(Date.parse(req.body.deletedAt)))
        )
          throw new HttpError(
            400,
            "Ungültiger Papierkorbstatus.",
            "VALIDATION",
          );
        if (
          req.body.deletedAt &&
          db
            .list<Comparison>("comparisons")
            .some(
              (c) =>
                !c.archivedAt &&
                (c.beforeId === photo.id || c.afterId === photo.id),
            )
        )
          throw new HttpError(
            409,
            "Dieses Foto gehört zu einem Vergleich. Bitte zuerst den Vergleich archivieren.",
            "PHOTO_IN_USE",
          );
        updated.deletedAt = req.body.deletedAt
          ? new Date().toISOString()
          : null;
      }
      updated.version++;
      updated.updatedAt = new Date().toISOString();
      updated.updatedBy = actor;
      db.put("photos", updated);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });
}
