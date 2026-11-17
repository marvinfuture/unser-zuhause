import express, {
  type Express,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Store, type RecordKind, type SessionRow } from "./db.js";
import {
  profiles,
  PROFILE_IDS,
  type AppState,
  type BaseRecord,
  type Collection,
  type ProfileId,
  type Session,
  type Photo,
  type Project,
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
  requireAuth: RequestHandler;
  requireWrite: RequestHandler;
  /** Liefert die aktuelle gültige Sitzung oder bricht mit HTTP 401 ab. */
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
  allowSetup?: boolean;
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
    assignees,
    startDate: optionalDay,
    dueDate: optionalDay,
  }),
  shopping: z.object({
    title,
    projectId: optionalId,
    category: z.enum(["material", "tool"]).default("material"),
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
function readBody<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
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
 * Leitet aus Kennwort und Salt asynchron einen 64-Byte-scrypt-Schlüssel ab. Die festgelegten Kosten erschweren das Erraten gespeicherter Kennwörter.
 */
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
/**
 * Erzeugt für ein neues Kennwort einen zufälligen Salt und gibt Salt samt abgeleitetem Schlüssel als speicherbaren Text zurück.
 */
async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(24).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}
/**
 * Prüft ein Kennwort gegen den gespeicherten Salt und Schlüssel; der abschließende Bytevergleich vermeidet inhaltsabhängige Vergleichszeiten.
 */
async function passwordMatches(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, key] = stored.split(":");
  const actual = await derive(password, salt);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
/**
 * Erkennt die erlaubten lokalen IPv4-/IPv6-Adressen der tatsächlichen TCP-Verbindung für die Ersteinrichtung.
 */
function loopback(value: string | undefined): boolean {
  return (
    value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1"
  );
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
  const authAttempts = new Map<string, { count: number; until: number }>();
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
   * Sucht anhand des Cookie-Fingerabdrucks eine noch gültige Datenbanksitzung. Fehlende, widerrufene oder abgelaufene Anmeldungen ergeben undefined.
   */
  function findSession(req: Request): SessionRow | undefined {
    const token = tokenFrom(req);
    if (!token) return undefined;
    return db.raw
      .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
      .get(hashToken(token), Date.now()) as SessionRow | undefined;
  }
  /**
   * Liest die Sitzung erneut aus SQLite und meldet bei fehlender Anmeldung HTTP 401. So werden Widerrufe und Profilwechsel anderer Tabs sofort berücksichtigt.
   */
  function getSession(req: Request): SessionRow {
    // Erneutes Lesen berücksichtigt Profilwechsel anderer Tabs sowie widerrufene Sitzungen.
    const session = findSession(req);
    if (!session)
      throw new HttpError(
        401,
        "Bitte meldet euch erneut an.",
        "UNAUTHENTICATED",
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
   * Express-Middleware für lesende private Routen: nur gültige Haushaltssitzungen dürfen den nächsten Handler erreichen.
   */
  const requireAuth: RequestHandler = (req, _res, next) => {
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
    requireAuth,
    requireWrite,
    getSession,
    getActor,
    assertProfile,
  };
  /**
   * Erstellt die öffentliche Sitzungsantwort ohne Kennworthash oder Cookie-Geheimnis. Das CSRF-Token wird nur für eine gültige Anmeldung mitgeliefert.
   */
  function sessionView(session?: SessionRow): Session {
    return {
      configured: !!db.getSetting("passwordHash"),
      authenticated: !!session,
      profiles,
      profileId: session?.profile_id ?? null,
      profileVersion: session?.profile_version ?? 0,
      ...(session ? { csrfToken: session.csrf_token } : {}),
    };
  }
  /**
   * Entfernt abgelaufene Sitzungen, speichert eine neue 30-Tage-Anmeldung und setzt den geschützten Cookie. Das ausgewählte Profil ist zunächst leer.
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
  /**
   * Zählt Kennwortversuche je Client-Adresse im Arbeitsspeicher und sperrt nach zehn Versuchen für den Rest des 15-Minuten-Fensters.
   */
  function rateLimit(req: Request): void {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    for (const [k, v] of authAttempts)
      if (v.until < now) authAttempts.delete(k);
    const row = authAttempts.get(key) ?? { count: 0, until: now + 15 * 60_000 };
    if (row.count >= 10)
      throw new HttpError(
        429,
        "Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.",
        "RATE_LIMIT",
      );
    row.count++;
    authAttempts.set(key, row);
  }
  const passwordInput = z
    .string()
    .min(12, "Bitte mindestens 12 Zeichen für das Haushaltskennwort verwenden.")
    .max(200);
  /** GET /api/session: liefert Einrichtungs- und Anmeldestatus; ohne gültige Sitzung keine privaten Inhalte. */
  app.get("/api/session", (req, res) =>
    res.json(sessionView(findSession(req))),
  );
  /** POST /api/setup: richtet das Haushaltskennwort ausschließlich lokal und nur einmal ein; parallele Versuche werden innerhalb der Transaktion abgefangen. */
  app.post("/api/setup", async (req, res) => {
    checkOrigin(req);
    rateLimit(req);
    if (
      options.allowSetup === false ||
      !loopback(req.socket.remoteAddress) ||
      !localHost(req.get("host") ?? "") ||
      (req.get("X-Forwarded-For") &&
        !req
          .get("X-Forwarded-For")!
          .split(",")
          .every((ip) => loopback(ip.trim())))
    )
      throw new HttpError(
        403,
        "Die Ersteinrichtung ist nur direkt auf dem Zuhause-PC möglich.",
        "LOCAL_SETUP_ONLY",
      );
    if (db.getSetting("passwordHash"))
      throw new HttpError(
        409,
        "Der Haushalt ist bereits eingerichtet.",
        "ALREADY_CONFIGURED",
      );
    const input = readBody(
      z.object({ password: passwordInput }).strict(),
      req.body,
    );
    const hash = await passwordHash(input.password);
    db.transaction(() => {
      if (db.getSetting("passwordHash"))
        throw new HttpError(
          409,
          "Der Haushalt ist bereits eingerichtet.",
          "ALREADY_CONFIGURED",
        );
      db.setSetting("passwordHash", hash);
    });
    res.status(201).json(sessionView(createSession(req, res)));
  });
  /** POST /api/login: prüft das Haushaltskennwort, ersetzt eine vorhandene Gerätesitzung und liefert die neue Anmeldung ohne vorgewähltes Profil. */
  app.post("/api/login", async (req, res) => {
    checkOrigin(req);
    rateLimit(req);
    const input = readBody(
      z.object({ password: z.string().min(1).max(200) }).strict(),
      req.body,
    );
    const stored = db.getSetting<string>("passwordHash");
    if (!stored || !(await passwordMatches(input.password, stored)))
      throw new HttpError(
        401,
        "Das Haushaltskennwort stimmt nicht.",
        "BAD_PASSWORD",
      );
    const existing = findSession(req);
    if (existing)
      db.raw
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(existing.token_hash);
    authAttempts.delete(req.ip ?? req.socket.remoteAddress ?? "unknown");
    res.json(sessionView(createSession(req, res)));
  });
  /** POST /api/logout: widerruft diese Sitzung serverseitig und entfernt den zugehörigen Browsercookie. */
  app.post("/api/logout", requireWrite, (req, res) => {
    db.raw
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(getSession(req).token_hash);
    res.clearCookie(COOKIE, {
      httpOnly: true,
      secure: options.secureCookies ?? req.secure,
      sameSite: "strict",
      path: "/",
    });
    res.json(sessionView());
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
  /** POST /api/password: prüft das bisherige Kennwort, ersetzt es konfliktgeschützt und widerruft sämtliche alten Anmeldungen. */
  app.post("/api/password", requireWrite, async (req, res) => {
    rateLimit(req);
    const input = readBody(
      z
        .object({
          currentPassword: z.string().max(200),
          newPassword: passwordInput,
        })
        .strict(),
      req.body,
    );
    const old = db.getSetting<string>("passwordHash")!;
    if (!(await passwordMatches(input.currentPassword, old)))
      throw new HttpError(
        401,
        "Das bisherige Kennwort stimmt nicht.",
        "BAD_PASSWORD",
      );
    const newHash = await passwordHash(input.newPassword);
    db.transaction(() => {
      if (db.getSetting("passwordHash") !== old)
        throw new HttpError(
          409,
          "Das Kennwort wurde inzwischen geändert.",
          "VERSION_CONFLICT",
        );
      db.setSetting("passwordHash", newHash);
      db.raw.exec("DELETE FROM sessions");
    });
    res.json(sessionView(createSession(req, res)));
  });
  /** GET /api/state: liefert nach Anmeldung den gemeinsamen Datenstand einschließlich archivierter Einträge für die Filter der Oberfläche. */
  app.get("/api/state", requireAuth, (_req, res) => {
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
        if (collection === "tasks")
          record.completedBy = fields.status === "done" ? actor : null;
        if (collection === "shopping")
          record.purchasedBy = fields.purchased ? actor : null;
        if (collection === "notes") record.event = false;
        db.put(collection, record);
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
        if (collection === "tasks")
          next.completedBy =
            next.status === "done"
              ? current.status === "done"
                ? current.completedBy
                : actor
              : null;
        if (collection === "shopping")
          next.purchasedBy = next.purchased
            ? current.purchased
              ? current.purchasedBy
              : actor
            : null;
        db.put(collection, next);
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

  options.registerExtras?.(ctx);
  /** Unbekannte API-Adressen liefern JSON mit HTTP 404 statt der HTML-Oberfläche. */
  app.use("/api", (_req, _res, next) =>
    next(
      new HttpError(404, "Diese Funktion wurde nicht gefunden.", "NOT_FOUND"),
    ),
  );
  if (options.distDir && existsSync(join(options.distDir, "index.html"))) {
    const dist = resolve(options.distDir);
    /** Liefert gebaute öffentliche Dateien; Service Worker und Manifest sollen nicht mit langem Cache veralten. */
    app.use(
      express.static(dist, {
        index: false,
        maxAge: "1h",
        /** Verhindert lange Cache-Laufzeiten für Dateien, die PWA-Updates steuern. */
        setHeaders: (res, path) => {
          if (path.endsWith("sw.js") || path.endsWith("manifest.webmanifest"))
            res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    /** Die React-Oberfläche übernimmt gültige Browserseiten; index.html wird vor Wiederverwendung beim Server geprüft. */
    app.get("/{*path}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(join(dist, "index.html"));
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
