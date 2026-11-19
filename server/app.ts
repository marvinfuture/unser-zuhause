import express, {
  type Express,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Store, type RecordKind, type SessionRow } from "./db.js";
import { registerTaskHistory, recordTaskHistory } from "./task-history.js";
import { registerCalendar } from "./calendar.js";
import { registerPush } from "./push.js";
import { registerRewards, recordTaskReward } from "./rewards.js";
import {
  profiles,
  PROFILE_IDS,
  TASK_PHASES,
  type AppState,
  type BaseRecord,
  type Collection,
  type ProfileId,
  type Session,
  type Photo,
  type Project,
  type Task,
} from "../shared/types.js";

export class HttpError extends Error {
  /**
   * Transportiert einen erwarteten HTTP-Fehler mit verständlicher Meldung, Fehlercode und optionalem aktuellen Datensatz für Konflikte.
   */
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
    public record?: unknown,
  ) {
    super(message);
  }
}
export interface AppContext {
  app: Express;
  db: Store;
  requireSession: RequestHandler;
  requireWrite: RequestHandler;
  /** Liefert die aktuelle Gerätesitzung oder fordert mit HTTP 401 einen neuen Einstieg an. */
  getSession(req: Request): SessionRow;
  /** Liefert das gewählte Profil einer gültigen Sitzung. */
  getActor(req: Request): ProfileId;
  /** Verhindert Speichern nach einem unbemerkten Profilwechsel. */
  assertProfile(req: Request, expected: unknown): ProfileId;
}
export interface AppOptions {
  dataDir: string;
  origin?: string;
  secureCookies?: boolean;
  distDir?: string;
  registerExtras?: (context: AppContext) => void;
}

const DAY = 86_400_000;
const COOKIE = "uz_session";
/**
 * Bildet den SHA-256-Fingerabdruck einer zufälligen Sitzungskennung. In SQLite liegt dadurch nicht der unmittelbar verwendbare Cookie-Wert.
 */
const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const title = z.string().trim().min(1, "Bitte einen Titel eingeben.").max(160);
const description = z.string().max(10_000).default("");
const id = z.string().uuid();
const optionalId = id.nullable().default(null);
const priority = z
  .enum(["urgent", "high", "normal", "later"])
  .default("normal");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    );
  }, "Ungültiges Datum.");
const optionalDay = day.nullable().default(null);
const assignees = z
  .array(z.enum(PROFILE_IDS))
  .max(2)
  .refine(
    (values) => new Set(values).size === values.length,
    "Person doppelt ausgewählt.",
  )
  .default([]);
const position = z.number().min(0).max(100).default(50);
const zoom = z.number().min(1).max(3).default(1);
const schemas = {
  rooms: z.object({
    title,
    description,
    color: z
      .string()
      .regex(/^#[\da-fA-F]{6}$/)
      .default("#456557"),
    icon: z.string().max(40).default("home"),
  }),
  projects: z.object({
    title,
    description,
    roomId: optionalId,
    priority,
    status: z
      .enum(["idea", "planned", "active", "paused", "done"])
      .default("planned"),
    startDate: optionalDay,
    dueDate: optionalDay,
    rank: z.number().finite().min(0).max(1_000_000_000).default(0),
  }),
  tasks: z.object({
    title,
    description,
    projectId: optionalId,
    roomId: optionalId,
    defectId: optionalId,
    priority,
    status: z.enum(["open", "active", "blocked", "done"]).default("open"),
    phase: z.enum(TASK_PHASES).default("preparation"),
    predecessorIds: z
      .array(id)
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        "Eine Vorgängeraufgabe darf nur einmal ausgewählt werden.",
      )
      .default([]),
    assignees,
    startDate: optionalDay,
    dueDate: optionalDay,
  }),
  shopping: z.object({
    title,
    projectId: optionalId,
    category: z.enum(["material", "tool", "household"]).default("material"),
    quantity: z.number().positive().max(1_000_000).default(1),
    unit: z.string().trim().min(1).max(40).default("Stück"),
    unitPriceCents: z
      .number()
      .int()
      .min(0)
      .max(100_000_000)
      .nullable()
      .default(null),
    purchased: z.boolean().default(false),
  }),
  defects: z.object({
    title,
    description,
    roomId: optionalId,
    projectId: optionalId,
    priority,
    status: z.enum(["open", "active", "resolved"]).default("open"),
    assignees,
    dueDate: optionalDay,
  }),
  notes: z.object({
    projectId: id,
    body: z.string().trim().min(1).max(10_000),
  }),
  comparisons: z.object({
    projectId: id,
    title,
    beforeId: id,
    afterId: id,
    beforeX: position,
    beforeY: position,
    afterX: position,
    afterY: position,
    beforeZoom: zoom,
    afterZoom: zoom,
  }),
};
const controlSchema = z.object({
  requestId: id,
  profileVersion: z.number().int().min(0),
});
const patchControl = z.object({
  version: z.number().int().positive(),
  profileVersion: z.number().int().min(0),
  archivedAt: z.string().datetime().nullable().optional(),
});

/**
 * Prüft unbekannte Eingaben gegen das übergebene Zod-Schema und liefert die bereinigten Daten; ungültige Angaben werden als HTTP 400 gemeldet.
 */
export function readBody<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(
      400,
      result.error.issues[0]?.message ?? "Bitte Angaben prüfen.",
      "VALIDATION",
    );
  return result.data;
}
/**
 * Erkennt localhost und die vorgesehenen Loopback-Adressen in einem Host-Header; URL-Zusätze und manipulierte Hostangaben werden abgewiesen.
 */
function localHost(value: string): boolean {
  if (!value || /[\s/@?#\\]/.test(value)) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(`http://${value}`).hostname,
    );
  } catch {
    return false;
  }
}

/**
 * Erstellt Datenbank, geschützte API und optionale statische Oberfläche, ohne selbst einen Netzwerkport zu öffnen. Zusätzliche Routen werden vor dem abschließenden Fehlerhandler registriert.
 */
export function createApp(options: AppOptions): AppContext {
  const app = express();
  const db = new Store(options.dataDir);
  const configuredOrigin = options.origin
    ? new URL(options.origin).origin
    : undefined;
  const configuredHost = configuredOrigin
    ? new URL(configuredOrigin).host.toLowerCase()
    : undefined;
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  /** Weist unbekannte Hostnamen ab, bevor sie private API-Routen erreichen können. */
  app.use((req, _res, next) => {
    const host = req.get("host") ?? "";
    if (!localHost(host) && host.toLowerCase() !== configuredHost)
      return next(
        new HttpError(
          403,
          "Diese Adresse ist nicht als App-Adresse freigegeben.",
          "HOST_NOT_ALLOWED",
        ),
      );
    next();
  });
  /** Setzt Browser-Schutzregeln gegen fremde Einbettung, MIME-Raten und externe Inhalte. */
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    next();
  });
  /** Private API-Antworten dürfen nicht dauerhaft im Browser- oder Proxycache landen. */
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "256kb" }));

  /**
   * Erlaubt Browser-Schreibzugriffe nur von der konfigurierten App-Adresse oder derselben lokalen Adresse. Anforderungen ohne Origin benötigen bei geschützten Schreibzugriffen weiterhin den CSRF-Nachweis.
   */
  function checkOrigin(req: Request): void {
    const origin = req.get("Origin");
    const site = req.get("Sec-Fetch-Site");
    if (site === "cross-site")
      throw new HttpError(
        403,
        "Diese Anfrage stammt nicht von eurer App.",
        "ORIGIN",
      );
    if (!origin) return; // Geschützte Schreibzugriffe benötigen auch ohne Browser weiterhin das nicht erratbare CSRF-Token.
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, "Ungültige Herkunft.", "ORIGIN");
    }
    const sameLocal =
      localHost(req.get("host") ?? "") &&
      localHost(parsed.host) &&
      parsed.host === req.get("host") &&
      ["http:", "https:"].includes(parsed.protocol);
    if (origin !== configuredOrigin && !sameLocal)
      throw new HttpError(
        403,
        "Diese Adresse ist nicht als App-Adresse freigegeben.",
        "ORIGIN",
      );
  }
  /**
   * Liest ausschließlich die syntaktisch gültige Sitzungskennung aus dem Cookie-Header; fehlende oder manipulierte Werte ergeben undefined.
   */
  function tokenFrom(req: Request): string | undefined {
    const value = req
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
  }
  /**
   * Sucht anhand des Cookie-Fingerabdrucks eine noch gültige Gerätesitzung. Fehlende, zurückgesetzte oder abgelaufene Sitzungen ergeben undefined.
   */
  function findSession(req: Request): SessionRow | undefined {
    const token = tokenFrom(req);
    if (!token) return undefined;
    return db.raw
      .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
      .get(hashToken(token), Date.now()) as SessionRow | undefined;
  }
  /**
   * Liest die Sitzung erneut aus SQLite und meldet bei fehlender Sitzung HTTP 401. So werden Zurücksetzen und Profilwechsel anderer Tabs sofort berücksichtigt.
   */
  function getSession(req: Request): SessionRow {
    // Erneutes Lesen berücksichtigt Profilwechsel anderer Tabs sowie widerrufene Sitzungen.
    const session = findSession(req);
    if (!session)
      throw new HttpError(
        401,
        "Bitte öffnet die App erneut, um eine Gerätesitzung zu erhalten.",
        "SESSION_REQUIRED",
      );
    return session;
  }
  /**
   * Liefert das in der gültigen Sitzung gewählte Profil; ohne Profilwahl wird die Aktion mit einem verständlichen Konflikthinweis abgebrochen.
   */
  function getActor(req: Request): ProfileId {
    const session = getSession(req);
    if (!session.profile_id)
      throw new HttpError(
        409,
        "Bitte zuerst Karla oder Marvin auswählen.",
        "PROFILE_REQUIRED",
      );
    return session.profile_id;
  }
  /**
   * Vergleicht die beim Formularstart gemerkte Profilversion mit der aktuellen Sitzung und liefert deren Profil. Eine inzwischen geänderte Auswahl verhindert das Speichern unter falschem Namen.
   */
  function assertProfile(req: Request, expected: unknown): ProfileId {
    const session = getSession(req);
    const value =
      typeof expected === "string" && /^\d+$/.test(expected)
        ? Number(expected)
        : expected;
    if (!session.profile_id)
      throw new HttpError(
        409,
        "Bitte zuerst Karla oder Marvin auswählen.",
        "PROFILE_REQUIRED",
      );
    if (!Number.isSafeInteger(value) || value !== session.profile_version)
      throw new HttpError(
        409,
        "Das Profil wurde gewechselt. Bitte die Eingabe unter dem gewünschten Namen erneut bestätigen.",
        "PROFILE_CHANGED",
      );
    return session.profile_id;
  }
  /**
   * Express-Middleware für Datenabrufe: eine automatisch vergebene Gerätesitzung ist nötig, sie ist kein persönlicher Identitätsnachweis.
   */
  const requireSession: RequestHandler = (req, _res, next) => {
    try {
      getSession(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  /**
   * Express-Middleware für Änderungen: prüft Herkunft, aktuelle Sitzung und CSRF-Token. Die fachliche Profilversion prüft der nachfolgende Handler.
   */
  const requireWrite: RequestHandler = (req, _res, next) => {
    try {
      checkOrigin(req);
      const session = getSession(req);
      if (req.get("X-CSRF-Token") !== session.csrf_token)
        throw new HttpError(
          403,
          "Die Sicherheitskennung fehlt. Bitte die App neu laden.",
          "CSRF",
        );
      next();
    } catch (error) {
      next(error);
    }
  };
  const ctx: AppContext = {
    app,
    db,
    requireSession,
    requireWrite,
    getSession,
    getActor,
    assertProfile,
  };
  /**
   * Liefert Profilwahl, Versionsnummer und CSRF-Token der Gerätesitzung, ohne den verwendbaren Cookie-Wert auszugeben.
   */
  function sessionView(session: SessionRow): Session {
    return {
      profiles,
      profileId: session.profile_id,
      profileVersion: session.profile_version,
      csrfToken: session.csrf_token,
    };
  }
  /**
   * Entfernt abgelaufene Sitzungen, speichert eine neue 30-Tage-Gerätesitzung und setzt den geschützten Cookie. Das Profil ist zunächst leer; ein Kennwort wird nicht verlangt.
   */
  function createSession(req: Request, res: Response): SessionRow {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const row: SessionRow = {
      token_hash: hashToken(token),
      csrf_token: randomBytes(32).toString("hex"),
      profile_id: null,
      profile_version: 0,
      expires_at: now + 30 * DAY,
      created_at: now,
    };
    db.raw.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
    db.raw
      .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)")
      .run(
        row.token_hash,
        row.csrf_token,
        row.profile_id,
        row.profile_version,
        row.expires_at,
        row.created_at,
      );
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: options.secureCookies ?? req.secure,
      sameSite: "strict",
      maxAge: 30 * DAY,
      path: "/",
    });
    return row;
  }
  /** GET /api/session: prüft die Herkunft und vergibt ohne Kennwort eine Sitzung; vorhandene Profilwahlen bleiben erhalten. */
  app.get("/api/session", (req, res) => {
    checkOrigin(req);
    res.json(sessionView(findSession(req) ?? createSession(req, res)));
  });
  /** DELETE /api/session: ersetzt nur die aktuelle Gerätesitzung und setzt ihre Profilwahl zurück; andere Geräte bleiben unverändert. */
  app.delete("/api/session", requireWrite, (req, res) => {
    const previous = getSession(req);
    const replacement = db.transaction(() => {
      db.raw
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(previous.token_hash);
      return createSession(req, res);
    });
    res.json(sessionView(replacement));
  });
  /** POST /api/profile: wechselt Karla/Marvin nur bei passender Profilversion und gibt den aktualisierten Sitzungsstand zurück. */
  app.post("/api/profile", requireWrite, (req, res) => {
    const input = readBody(
      z
        .object({
          profileId: z.enum(PROFILE_IDS),
          profileVersion: z.number().int().min(0),
        })
        .strict(),
      req.body,
    );
    const session = getSession(req);
    const changed = db.raw
      .prepare(
        "UPDATE sessions SET profile_id=?,profile_version=profile_version+1 WHERE token_hash=? AND profile_version=?",
      )
      .run(input.profileId, session.token_hash, input.profileVersion);
    if (!changed.changes)
      throw new HttpError(
        409,
        "Das Profil wurde zwischenzeitlich gewechselt. Bitte neu laden.",
        "PROFILE_CHANGED",
      );
    res.json(sessionView(getSession(req)));
  });
  /** GET /api/state: liefert mit gültiger Gerätesitzung den gemeinsamen Datenstand einschließlich archivierter Einträge. */
  app.get("/api/state", requireSession, (_req, res) => {
    const state: AppState = {
      profiles,
      rooms: db.list("rooms"),
      projects: db.list("projects"),
      tasks: db.list("tasks"),
      shopping: db.list("shopping"),
      defects: db.list("defects"),
      notes: db.list("notes"),
      photos: db.list("photos"),
      comparisons: db.list("comparisons"),
    };
    res.json(state);
  });

  /**
   * Prüft vorhandene Verknüpfungen, sinnvolle Terminfolgen und zusammengehörige Räume/Projekte. Vergleiche dürfen nur verfügbare, unterschiedliche Bilder desselben Projekts verwenden.
   */
  function checkReferences(
    kind: Collection,
    fields: Record<string, unknown>,
  ): void {
    const refs: [string, RecordKind][] = [
      ["roomId", "rooms"],
      ["projectId", "projects"],
      ["defectId", "defects"],
      ["beforeId", "photos"],
      ["afterId", "photos"],
    ];
    for (const [field, target] of refs) {
      const value = fields[field];
      if (typeof value === "string" && !db.get(target, value))
        throw new HttpError(
          400,
          "Eine verknüpfte Angabe existiert nicht mehr.",
          "INVALID_REFERENCE",
        );
    }
    if (fields.startDate && fields.dueDate && fields.startDate > fields.dueDate)
      throw new HttpError(
        400,
        "Der Beginn darf nicht nach der Fälligkeit liegen.",
        "VALIDATION",
      );
    if (fields.projectId && fields.roomId) {
      const project = db.get<Project>("projects", fields.projectId as string)!;
      if (project.roomId && project.roomId !== fields.roomId)
        throw new HttpError(
          400,
          "Projekt und Raum passen nicht zusammen.",
          "INVALID_REFERENCE",
        );
    }
    if (kind === "comparisons") {
      if (fields.beforeId === fields.afterId)
        throw new HttpError(
          400,
          "Bitte zwei verschiedene Bilder auswählen.",
          "VALIDATION",
        );
      for (const field of ["beforeId", "afterId"]) {
        const photo = db.get<Photo>("photos", fields[field] as string)!;
        if (
          photo.deletedAt ||
          photo.archivedAt ||
          photo.projectId !== fields.projectId
        )
          throw new HttpError(
            400,
            "Vergleichsbilder müssen zum selben Projekt gehören und verfügbar sein.",
            "INVALID_REFERENCE",
          );
      }
    }
  }
  /** Verhindert, dass ein Projekt-Raumwechsel verknüpfte Aufgaben oder Mängel nachträglich ungültig macht; auch archivierte Einträge müssen bearbeitbar und wiederherstellbar bleiben. */
  function checkProjectRoomChange(next: Project, current: Project): void {
    if (!next.roomId || next.roomId === current.roomId) return;
    const conflicts = [
      ...db.list<Task>("tasks"),
      ...db.list<
        BaseRecord & {
          title: string;
          projectId: string | null;
          roomId: string | null;
        }
      >("defects"),
    ].filter(
      (record) =>
        record.projectId === next.id &&
        record.roomId &&
        record.roomId !== next.roomId,
    );
    if (conflicts.length)
      throw new HttpError(
        409,
        `Diese Einträge sind noch einem anderen Raum zugeordnet: ${conflicts.map((record) => `„${record.title}“${record.archivedAt ? " (archiviert)" : ""}`).join(", ")}. Setzt deren Raum zuerst auf „Allgemein im Haus“. Danach könnt ihr den Projektraum ändern und die Einträge bei Bedarf neu zuordnen.`,
        "PROJECT_ROOM_CONFLICT",
      );
  }
  /**
   * Prüft den vorgeschlagenen Aufgabenstand im selben Schreibvorgang wie das Speichern. Verhindert Kreise, fremde Projekte und einen Arbeitsbeginn vor allen Vorgängern; bestehende Nachfolger dürfen durch Wiederöffnen, Archivieren oder Verschieben nicht ungültig werden.
   */
  function checkTaskDependencies(
    next: Task,
    current?: Task,
    explicitStatus?: unknown,
  ): void {
    const tasks = new Map(
      db.list<Task>("tasks").map((task) => [task.id, task]),
    );
    tasks.set(next.id, next);
    const dependencyChanged =
      current &&
      (current.predecessorIds.length !== next.predecessorIds.length ||
        current.predecessorIds.some(
          (value) => !next.predecessorIds.includes(value),
        ));
    if (
      dependencyChanged &&
      (current.status === "active" || current.status === "done") &&
      explicitStatus !== "open"
    )
      throw new HttpError(
        409,
        "Setzt diese Aufgabe beim Ändern ihrer Vorgänger gleichzeitig auf offen zurück.",
        "TASK_DEPENDENCY_CONFLICT",
      );

    const successors = [...tasks.values()].filter(
      (task) => !task.archivedAt && task.predecessorIds.includes(next.id),
    );
    const invalidated = successors.filter(
      (task) =>
        next.archivedAt ||
        !next.projectId ||
        task.projectId !== next.projectId ||
        (next.status !== "done" &&
          (task.status === "active" || task.status === "done")),
    );
    if (invalidated.length)
      throw new HttpError(
        409,
        `Diese Änderung würde folgende Nachfolger ungültig machen: ${invalidated.map((task) => `„${task.title}“`).join(", ")}. Öffnet sie zuerst wieder oder entfernt ihre Verknüpfung.`,
        "TASK_DEPENDENCY_CONFLICT",
      );

    const predecessors: Task[] = [];
    for (const predecessorId of next.predecessorIds) {
      const predecessor = tasks.get(predecessorId);
      if (predecessorId === next.id)
        throw new HttpError(
          400,
          "Eine Aufgabe kann nicht ihr eigener Vorgänger sein.",
          "INVALID_DEPENDENCY",
        );
      if (!predecessor)
        throw new HttpError(
          400,
          "Eine Vorgängeraufgabe existiert nicht mehr.",
          "INVALID_DEPENDENCY",
        );
      if (!next.projectId || predecessor.projectId !== next.projectId)
        throw new HttpError(
          400,
          "Vorgänger und Nachfolger müssen demselben Projekt angehören.",
          "INVALID_DEPENDENCY",
        );
      if (!next.archivedAt && predecessor.archivedAt)
        throw new HttpError(
          409,
          `Die Vorgängeraufgabe „${predecessor.title}“ ist archiviert. Stellt sie zuerst wieder her oder entfernt die Verknüpfung.`,
          "TASK_DEPENDENCY_CONFLICT",
        );
      predecessors.push(predecessor);
    }

    // Iteratives Durchlaufen bleibt auch bei langen Aufgabenketten ohne Rekursionslimit zuverlässig.
    const pending = [...next.predecessorIds];
    const visited = new Set<string>();
    while (pending.length) {
      const candidate = pending.pop()!;
      if (candidate === next.id)
        throw new HttpError(
          400,
          "Diese Verknüpfung würde einen Kreis zwischen Aufgaben erzeugen.",
          "DEPENDENCY_CYCLE",
        );
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      pending.push(...(tasks.get(candidate)?.predecessorIds ?? []));
    }
    if (
      !next.archivedAt &&
      (next.status === "active" || next.status === "done")
    ) {
      const waiting = predecessors.filter((task) => task.status !== "done");
      if (waiting.length)
        throw new HttpError(
          409,
          `Erledigt zuerst alle Vorgänger: ${waiting.map((task) => `„${task.title}“`).join(", ")}. Planung und Zuweisung sind schon möglich.`,
          "TASK_NOT_READY",
        );
    }
  }
  /**
   * Schreibt eine automatische, nicht direkt bearbeitbare Projektnotiz mit dem handelnden Profil. Ohne Projektbezug wird kein Verlaufseintrag angelegt.
   */
  function event(projectId: unknown, actor: ProfileId, body: string): void {
    if (typeof projectId !== "string") return;
    const now = new Date().toISOString();
    db.put("notes", {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
      version: 1,
      archivedAt: null,
      projectId,
      body,
      event: true,
    } as BaseRecord);
  }
  /** POST /api/projects/:id/move: tauscht benachbarte geplante Projekte atomar. Der vollständige erwartete Reihenfolgenstand verhindert unbemerkte Änderungen durch ein zweites Gerät; gleiche oder zu enge Ränge werden dabei normalisiert. */
  app.post("/api/projects/:id/move", requireWrite, (req, res) => {
    const input = readBody(
      z
        .object({
          direction: z.enum(["up", "down"]),
          version: z.number().int().positive(),
          profileVersion: z.number().int().min(0),
          expectedOrder: z
            .array(id)
            .min(1)
            .max(10_000)
            .refine(
              (values) => new Set(values).size === values.length,
              "Die erwartete Projektfolge enthält doppelte Einträge.",
            ),
        })
        .strict(),
      req.body,
    );
    const actor = assertProfile(req, input.profileVersion);
    const result = db.transaction(() => {
      const current = db.get<Project>("projects", String(req.params.id));
      if (!current)
        throw new HttpError(
          404,
          "Dieses Projekt wurde nicht gefunden.",
          "NOT_FOUND",
        );
      const planned = db
        .list<Project>("projects")
        .filter(
          (project) =>
            !project.archivedAt && ["idea", "planned"].includes(project.status),
        )
        .sort((a, b) => a.rank - b.rank);
      if (
        current.version !== input.version ||
        planned.length !== input.expectedOrder.length ||
        planned.some(
          (project, index) => project.id !== input.expectedOrder[index],
        )
      )
        throw new HttpError(
          409,
          "Die geplanten Projekte wurden inzwischen geändert. Bitte prüft die aktuelle Reihenfolge und verschiebt das Projekt erneut.",
          "VERSION_CONFLICT",
          current,
        );
      const from = planned.findIndex((project) => project.id === current.id);
      if (from === -1)
        throw new HttpError(
          409,
          "Nur nicht archivierte Ideen und geplante Projekte lassen sich in „Als Nächstes“ verschieben.",
          "PROJECT_NOT_PLANNED",
        );
      const to = from + (input.direction === "up" ? -1 : 1);
      if (to < 0 || to >= planned.length) return planned;
      [planned[from], planned[to]] = [planned[to], planned[from]];
      const now = new Date().toISOString();
      return planned.map((project, index) => {
        const rank = (index + 1) * 1024;
        // Das bewusst verschobene Projekt erhält auch bei zufällig gleichem Zahlenrang eine neue Bearbeitungszuordnung.
        if (project.rank === rank && project.id !== current.id) return project;
        const updated = {
          ...project,
          rank,
          version: project.version + 1,
          updatedAt: now,
          updatedBy: actor,
        };
        db.put("projects", updated);
        return updated;
      });
    });
    res.json(result);
  });
  for (const collection of Object.keys(schemas) as Collection[]) {
    const schema = schemas[collection];
    /** POST je Sammlung: validiert Eingaben und Verknüpfungen; Eintrag, Verlauf und Wiederholungsschutz werden gemeinsam gespeichert. */
    app.post(`/api/${collection}`, requireWrite, (req, res) => {
      const parsed = readBody(
        schema.extend(controlSchema.shape).strict(),
        req.body,
      ) as Record<string, unknown>;
      const actor = assertProfile(req, parsed.profileVersion);
      const { requestId, profileVersion, ...fields } = parsed;
      const session = getSession(req);
      const key = `${session.token_hash}:${collection}:${requestId}`;
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ actor, fields }))
        .digest("hex");
      const result = db.transaction(() => {
        const previous = db.getIdempotent<{
          fingerprint: string;
          record: BaseRecord;
        }>(key);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new HttpError(
              409,
              "Diese Anfrage wurde bereits mit anderen Angaben verwendet.",
              "IDEMPOTENCY_CONFLICT",
            );
          return { record: previous.record, replayed: true };
        }
        checkReferences(collection, fields);
        const now = new Date().toISOString();
        const record = {
          ...fields,
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          version: 1,
          archivedAt: null,
        } as BaseRecord & Record<string, unknown>;
        if (collection === "tasks") {
          record.completedBy = fields.status === "done" ? actor : null;
          checkTaskDependencies(record as unknown as Task);
        }
        if (collection === "shopping")
          record.purchasedBy = fields.purchased ? actor : null;
        if (collection === "notes") record.event = false;
        db.put(collection, record);
        if (collection === "tasks") {
          const task = record as unknown as Task;
          recordTaskHistory(db, undefined, task);
          recordTaskReward(db, undefined, task);
        }
        if (collection !== "notes")
          event(
            collection === "projects" ? record.id : fields.projectId,
            actor,
            `${collection === "projects" ? "Projekt" : collection === "tasks" ? "Aufgabe" : collection === "shopping" ? "Einkauf" : collection === "defects" ? "Mangel" : "Eintrag"} „${fields.title}“ angelegt.`,
          );
        db.saveIdempotent(key, { fingerprint, record });
        return { record, replayed: false };
      });
      res.status(result.replayed ? 200 : 201).json(result.record);
    });
    /** PATCH je Sammlung: ändert nur ausdrücklich übermittelte Felder bei passender Datensatz- und Profilversion; der ursprüngliche Ersteller bleibt erhalten. */
    app.patch(`/api/${collection}/:id`, requireWrite, (req, res) => {
      const parsed = readBody(
        schema.partial().extend(patchControl.shape).strict(),
        req.body,
      ) as Record<string, unknown>;
      const actor = assertProfile(req, parsed.profileVersion);
      const record = db.transaction(() => {
        const current = db.get<BaseRecord & Record<string, unknown>>(
          collection,
          String(req.params.id),
        );
        if (!current)
          throw new HttpError(
            404,
            "Dieser Eintrag wurde nicht gefunden.",
            "NOT_FOUND",
          );
        if (current.version !== parsed.version)
          throw new HttpError(
            409,
            "Dieser Eintrag wurde inzwischen geändert. Deine Eingaben bleiben erhalten.",
            "VERSION_CONFLICT",
            current,
          );
        if (collection === "notes" && current.event)
          throw new HttpError(
            400,
            "Automatische Verlaufseinträge können nicht bearbeitet werden.",
            "READ_ONLY",
          );
        const { version, profileVersion, archivedAt, ...parsedPatch } = parsed;
        // Zod setzt Standardwerte auch in optionalen Feldern. PATCH darf ausgelassene
        // Eigenschaften jedoch nicht auf ihre Anlege-Standardwerte zurücksetzen.
        const patch = Object.fromEntries(
          Object.entries(parsedPatch).filter(([key]) =>
            Object.hasOwn(req.body, key),
          ),
        );
        const merged = { ...current, ...patch };
        checkReferences(collection, merged);
        const next = {
          ...merged,
          updatedAt: new Date().toISOString(),
          updatedBy: actor,
          version: current.version + 1,
          archivedAt:
            archivedAt === undefined
              ? current.archivedAt
              : archivedAt === null
                ? null
                : new Date().toISOString(),
        } as BaseRecord & Record<string, unknown>;
        if (collection === "projects")
          checkProjectRoomChange(
            next as unknown as Project,
            current as unknown as Project,
          );
        if (collection === "tasks") {
          next.completedBy =
            next.status === "done"
              ? current.status === "done"
                ? current.completedBy
                : actor
              : null;
          checkTaskDependencies(
            next as unknown as Task,
            current as unknown as Task,
            patch.status,
          );
        }
        if (collection === "shopping")
          next.purchasedBy = next.purchased
            ? current.purchased
              ? current.purchasedBy
              : actor
            : null;
        db.put(collection, next);
        if (collection === "tasks") {
          const previous = current as unknown as Task;
          const task = next as unknown as Task;
          recordTaskHistory(db, previous, task);
          recordTaskReward(db, previous, task);
        }
        if (
          collection !== "notes" &&
          (next.status !== current.status ||
            next.purchased !== current.purchased ||
            next.archivedAt !== current.archivedAt)
        )
          event(
            collection === "projects" ? next.id : next.projectId,
            actor,
            `„${next.title}“: ${next.archivedAt ? "archiviert" : current.archivedAt ? "wiederhergestellt" : next.status === "done" ? "erledigt" : next.status === "resolved" ? "behoben" : next.purchased ? "gekauft" : "Status geändert"}.`,
          );
        return next;
      });
      res.json(record);
    });
  }

  registerCalendar(ctx);
  registerTaskHistory(ctx);
  registerRewards(ctx);
  registerPush(ctx);
  options.registerExtras?.(ctx);
  /** Unbekannte API-Adressen liefern JSON mit HTTP 404 statt der HTML-Oberfläche. */
  app.use("/api", (_req, _res, next) =>
    next(
      new HttpError(404, "Diese Funktion wurde nicht gefunden.", "NOT_FOUND"),
    ),
  );
  if (options.distDir && existsSync(join(options.distDir, "index.html"))) {
    const dist = resolve(options.distDir);
    /** Liefert gebaute öffentliche Dateien; HTML wird niemals als wiederverwendbare App-Oberfläche gespeichert. */
    app.use(
      express.static(dist, {
        index: false,
        maxAge: "1h",
        /** Verhindert veraltete Einstiegseiten auch bei direktem /index.html-Aufruf; PWA-Steuerdateien müssen revalidiert werden. */
        setHeaders: (res, path) => {
          if (path.toLowerCase().endsWith(".html")) {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
          } else if (
            path.endsWith("sw.js") ||
            path.endsWith("manifest.webmanifest")
          )
            res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    /** Fehlende Build-Dateien erhalten einen echten Fehler statt einer HTML-Antwort unter einer JavaScript- oder CSS-Adresse. */
    app.use("/assets", (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next(
        new HttpError(
          404,
          "Diese App-Datei wurde nicht gefunden. Bitte die Seite neu laden.",
          "ASSET_NOT_FOUND",
        ),
      );
    });
    /** Die React-Oberfläche übernimmt Browserseiten; jeder Einstieg muss den aktuellen HTML-Stand vom Server beziehen. */
    app.get("/{*path}", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.sendFile("index.html", { root: dist });
    });
  }
  /** Einheitliche Fehlerantwort: erwartete Meldungen bleiben verständlich, unerwartete Serverdetails werden nur lokal protokolliert. */
  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: express.NextFunction,
    ) => {
      const known = error as {
        status?: number;
        statusCode?: number;
        code?: string;
        message?: string;
        record?: unknown;
        type?: string;
      };
      const status = known.status ?? known.statusCode ?? 500;
      const expected = error instanceof HttpError;
      if (status >= 500 && !expected)
        console.error(
          "Anfrage fehlgeschlagen:",
          error instanceof Error ? error.message : "Unbekannter Fehler",
        );
      res.status(status).json({
        message:
          status >= 500 && !expected
            ? "Das hat leider nicht geklappt. Bitte erneut versuchen."
            : (known.message ?? "Ungültige Anfrage."),
        code: known.code ?? (status === 413 ? "TOO_LARGE" : "REQUEST_FAILED"),
        ...(known.record ? { record: known.record } : {}),
      });
    },
  );
  return ctx;
}
