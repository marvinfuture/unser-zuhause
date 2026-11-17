import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { hostname } from "node:os";

const magic = Buffer.from("UZB1");
const active = new Set<string>();
const objectPattern = /^[a-f0-9]{64}$/;
const snapshotPattern = /^[0-9]{8}T[0-9]{9}Z-[a-f0-9-]{36}$/;
interface Entry {
  path: string;
  sha256: string;
  size: number;
}
interface Manifest {
  version: 1;
  id: string;
  createdAt: string;
  databaseFilename: string;
  files: Entry[];
}
interface RepositoryConfig {
  version: 1;
  salt: string;
  keyCheck: string;
}
export interface BackupResult {
  id: string;
  createdAt: string;
  fileCount: number;
  totalBytes: number;
  newObjects: number;
  removedSnapshots?: number;
  retentionWarning?: string;
}
export interface BackupStatus {
  lastAttempt?: string;
  lastSuccess?: BackupResult;
  error?: string;
}
export interface BackupOptions {
  dataDir: string;
  repositoryDir: string;
  passphrase: string;
  database: DatabaseSync;
  databaseFilename?: string;
}
export interface RestoreOptions {
  repositoryDir: string;
  snapshotId: string;
  passphrase: string;
  targetDir: string;
}

/**
 * Prüft anhand aufgelöster Pfade, ob ein Ziel lexikalisch innerhalb eines erlaubten Ordners liegt. Dateisystem-Verknüpfungen werden separat geprüft.
 */
function within(parent: string, child: string): boolean {
  const r = relative(resolve(parent), resolve(child));
  return (
    r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r))
  );
}
/**
 * Akzeptiert ausschließlich sichere relative Manifestpfade und weist Traversal, Laufwerksangaben sowie problematische Windows-Dateinamen zurück.
 */
function safeRelative(path: string): string {
  if (
    !path ||
    path.includes("\\") ||
    path.includes(":") ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[. ]$/.test(p) ||
          /[<>"|?*\x00-\x1f]/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw new Error("Ungültiger Pfad in der Sicherung.");
  return path;
}
/**
 * Prüft, ob auf einen Pfad zugegriffen werden kann. Fehlender Zugriff oder ein nicht vorhandener Pfad ergibt false.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
/**
 * Öffnet eine exklusive Archiv-Sperrdatei. Eine alte Sperre wird nur übernommen, wenn sie vom selben Rechner stammt und ihr Prozess nachweislich nicht mehr existiert.
 */
async function repositoryLock(
  repositoryDir: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  const path = join(repositoryDir, ".backup.lock");
  try {
    return await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let stale = false;
    try {
      const saved = JSON.parse(await readFile(path, "utf8"));
      if (
        saved.host === hostname() &&
        Number.isSafeInteger(saved.pid) &&
        saved.pid > 0
      ) {
        try {
          process.kill(saved.pid, 0);
        } catch (e) {
          stale = (e as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
    } catch {}
    if (!stale)
      throw new Error(
        "Das Sicherungsarchiv wird bereits verwendet. Nach einem Absturz die Sperrdatei nur entfernen, wenn kein Sicherungs- oder Wiederherstellungsvorgang läuft.",
      );
    await rm(path);
    return open(path, "wx", 0o600);
  }
}
/**
 * Leitet aus Sicherungskennwort und Archiv-Salt den 256-Bit-Schlüssel ab; Kennwörter unter zwölf Zeichen werden zurückgewiesen.
 */
async function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (passphrase.length < 12)
    throw new Error("Das Sicherungskennwort muss mindestens 12 Zeichen haben.");
  return new Promise((done, fail) =>
    scrypt(
      passphrase,
      salt,
      32,
      { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 },
      (err, key) => (err ? fail(err) : done(key)),
    ),
  );
}
/**
 * Verschlüsselt einen kleinen Datenblock mit AES-256-GCM und zufälligem Initialisierungswert. Formatkennung und Authentifizierungstag werden mitgespeichert.
 */
function seal(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(magic);
  return Buffer.concat([
    magic,
    iv,
    cipher.update(data),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
/**
 * Prüft das verschlüsselte Blockformat und entschlüsselt authentifiziert. Falsche Schlüssel oder veränderte Daten führen zu einem Fehler.
 */
function unseal(data: Buffer, key: Buffer): Buffer {
  if (data.length < 32 || !data.subarray(0, 4).equals(magic))
    throw new Error("Ungültige verschlüsselte Sicherung.");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(4, 16));
  decipher.setAAD(magic);
  decipher.setAuthTag(data.subarray(-16));
  try {
    return Buffer.concat([
      decipher.update(data.subarray(16, -16)),
      decipher.final(),
    ]);
  } catch {
    throw new Error("Sicherungskennwort falsch oder Sicherung beschädigt.");
  }
}
/**
 * Öffnet ein vorhandenes Sicherungsarchiv und prüft das Kennwort. Mit create=true wird bei Bedarf ein neues Archiv mit eigenem Salt angelegt.
 */
async function repositoryKey(
  repositoryDir: string,
  passphrase: string,
  create = false,
): Promise<Buffer> {
  const configPath = join(repositoryDir, "repository.json");
  if (!(await exists(configPath))) {
    if (!create) throw new Error("Kein Sicherungsarchiv gefunden.");
    await mkdir(repositoryDir, { recursive: true });
    const salt = randomBytes(32),
      key = await derive(passphrase, salt);
    const config: RepositoryConfig = {
      version: 1,
      salt: salt.toString("base64"),
      keyCheck: seal(Buffer.from("Unser Zuhause Backup v1"), key).toString(
        "base64",
      ),
    };
    await writeFile(configPath, JSON.stringify(config), {
      flag: "wx",
      mode: 0o600,
    });
    await mkdir(join(repositoryDir, "objects"), { recursive: true });
    await mkdir(join(repositoryDir, "snapshots"), { recursive: true });
    return key;
  }
  const config = JSON.parse(
    await readFile(configPath, "utf8"),
  ) as RepositoryConfig;
  if (
    config.version !== 1 ||
    typeof config.salt !== "string" ||
    typeof config.keyCheck !== "string" ||
    Buffer.from(config.salt, "base64").length !== 32
  )
    throw new Error("Nicht unterstütztes Sicherungsformat.");
  const key = await derive(passphrase, Buffer.from(config.salt, "base64"));
  if (
    unseal(Buffer.from(config.keyCheck, "base64"), key).toString() !==
    "Unser Zuhause Backup v1"
  )
    throw new Error("Ungültiger Sicherungsschlüssel.");
  return key;
}
/**
 * Liest eine Datei stückweise und liefert SHA-256-Prüfsumme sowie Bytezahl, ohne die gesamte Datei im Speicher zu halten.
 */
async function hashFile(
  path: string,
): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}
/**
 * Prüft ein verschlüsseltes Archivobjekt gegen Prüfsumme und Größe des Manifests. Optional wird es in eine neue Zieldatei geschrieben; fehlerhafte Teildateien werden entfernt.
 */
async function decryptFile(
  source: string,
  key: Buffer,
  expected: Entry,
  target?: string,
): Promise<void> {
  const info = await stat(source);
  if (info.size < 32) throw new Error("Beschädigte Sicherungsdatei.");
  const handle = await open(source, "r");
  const header = Buffer.alloc(16),
    tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, 16, 0);
    await handle.read(tag, 0, 16, info.size - 16);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, 4).equals(magic))
    throw new Error("Ungültige Sicherungsdatei.");
  const cipher = createDecipheriv("aes-256-gcm", key, header.subarray(4));
  cipher.setAAD(magic);
  cipher.setAuthTag(tag);
  const hash = createHash("sha256");
  let size = 0;
  const checker = new Transform({
    /**
     * Aktualisiert beim Entschlüsseln Prüfsumme und Bytezahl und reicht dieselben Daten unverändert an das Ziel weiter.
     */
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  const sink = target
    ? createWriteStream(target, { flags: "wx", mode: 0o600 })
    : new Writable({
        /**
         * Verwirft bereits geprüfte Datenblöcke, wenn nur die Integrität kontrolliert und keine Zieldatei wiederhergestellt werden soll.
         */
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
  try {
    if (info.size === 32) {
      cipher.end();
      await pipeline(cipher, checker, sink);
    } else
      await pipeline(
        createReadStream(source, { start: 16, end: info.size - 17 }),
        cipher,
        checker,
        sink,
      );
    if (size !== expected.size || hash.digest("hex") !== expected.sha256)
      throw new Error("Prüfsumme der Sicherung stimmt nicht.");
  } catch (error) {
    if (target) await rm(target, { force: true });
    throw error;
  }
}
/**
 * Speichert eine Datei als verschlüsseltes, über ihren Inhalt adressiertes Archivobjekt. Bereits vorhandene Objekte werden geprüft und wiederverwendet; true bedeutet neu gespeichert.
 */
async function storeObject(
  source: string,
  repositoryDir: string,
  key: Buffer,
  entry: Entry,
): Promise<boolean> {
  const target = join(repositoryDir, "objects", entry.sha256 + ".enc");
  if (await exists(target)) {
    await decryptFile(target, key, entry);
    return false;
  }
  const tmp = target + "." + randomUUID() + ".tmp",
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(magic);
  try {
    await writeFile(tmp, Buffer.concat([magic, iv]), {
      flag: "wx",
      mode: 0o600,
    });
    await pipeline(
      createReadStream(source),
      cipher,
      createWriteStream(tmp, { flags: "a" }),
    );
    await appendFile(tmp, cipher.getAuthTag());
    await decryptFile(tmp, key, entry); // Erkennt auch eine während der Sicherung veränderte Quelldatei.
    await rename(tmp, target);
    return true;
  } finally {
    await rm(tmp, { force: true });
  }
}
/**
 * Sammelt rekursiv reguläre Dateien als relative Pfade. Symbolische Verknüpfungen werden abgelehnt, damit fremde Dateien nicht unbeabsichtigt ins Archiv gelangen.
 */
async function walkFiles(root: string, prefix = ""): Promise<string[]> {
  if (!(await exists(root))) return [];
  const out: string[] = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const file = join(root, item.name),
      rel = prefix ? `${prefix}/${item.name}` : item.name;
    const s = await lstat(file);
    if (s.isSymbolicLink())
      throw new Error("Verknüpfungen werden nicht in Sicherungen aufgenommen.");
    if (s.isDirectory()) out.push(...(await walkFiles(file, rel)));
    else if (s.isFile()) out.push(safeRelative(rel));
  }
  return out;
}
/**
 * Schreibt den letzten Sicherungsstatus zunächst in eine temporäre Datei und ersetzt anschließend die Statusdatei.
 */
async function writeStatus(
  dataDir: string,
  status: BackupStatus,
): Promise<void> {
  const path = join(dataDir, "backup-status.json"),
    tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(status), { mode: 0o600 });
  await rename(tmp, path);
}
/**
 * Meldet, ob dieser App-Prozess gerade eine Sicherung des angegebenen Datenordners ausführt; die Medienbereinigung nutzt dies als Löschsperre.
 */
export function isBackupRunning(dataDir: string): boolean {
  return active.has(resolve(dataDir));
}
/**
 * Liest den gespeicherten Sicherungsstatus. Ist er nicht verfügbar oder nicht lesbar, wird ein leerer Status zurückgegeben.
 */
export async function readBackupStatus(dataDir: string): Promise<BackupStatus> {
  try {
    return JSON.parse(
      await readFile(join(dataDir, "backup-status.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

/**
 * Erstellt unter Archiv-Sperre einen konsistenten SQLite-Snapshot und sichert genau dessen referenzierte Medien sowie Betriebskonfiguration verschlüsselt. Prüft alle Objekte, veröffentlicht das Manifest und aktualisiert den sichtbaren Erfolgs- oder Fehlerstatus.
 */
export async function createBackup(
  options: BackupOptions,
): Promise<BackupResult> {
  const dataDir = resolve(options.dataDir),
    repositoryDir = resolve(options.repositoryDir);
  if (within(dataDir, repositoryDir) || within(repositoryDir, dataDir))
    throw new Error(
      "Datenordner und Sicherungsarchiv müssen getrennte Ordner sein.",
    );
  if (active.has(dataDir)) throw new Error("Eine Sicherung läuft bereits.");
  const filename = safeRelative(options.databaseFilename ?? "home.sqlite");
  if (filename.includes("/")) throw new Error("Ungültiger Datenbankname.");
  active.add(dataDir);
  let tempDir: string | undefined;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let key: Buffer | undefined;
  const status: BackupStatus = {
    ...(await readBackupStatus(dataDir)),
    lastAttempt: new Date().toISOString(),
    error: undefined,
  };
  try {
    await mkdir(repositoryDir, { recursive: true });
    lock = await repositoryLock(repositoryDir);
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        host: hostname(),
        startedAt: status.lastAttempt,
      }),
    );
    key = await repositoryKey(repositoryDir, options.passphrase, true);
    tempDir = await mkdtemp(join(dataDir, ".backup-"));
    const snapshotDb = join(tempDir, filename);
    options.database.prepare("VACUUM INTO ?").run(snapshotDb);
    const snapshot = new DatabaseSync(snapshotDb, { readOnly: true });
    const required = new Set<string>();
    try {
      const hasSettings = snapshot
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
        )
        .get();
      if (hasSettings)
        for (const row of snapshot
          .prepare("SELECT value FROM settings WHERE key LIKE 'media:%'")
          .all() as { value: string }[]) {
          const metadata = JSON.parse(row.value);
          for (const property of ["original", "display", "thumb"])
            if (metadata[property]) {
              const p = String(metadata[property]);
              const absolute = isAbsolute(p) ? resolve(p) : resolve(dataDir, p);
              if (!within(join(dataDir, "media"), absolute))
                throw new Error("Medienverweis außerhalb des Datenordners.");
              required.add(
                safeRelative(relative(dataDir, absolute).split(sep).join("/")),
              );
            }
        }
      const integrity = snapshot
        .prepare("PRAGMA integrity_check")
        .get() as Record<string, unknown>;
      if (Object.values(integrity)[0] !== "ok")
        throw new Error("Die Datenbankprüfung ist fehlgeschlagen.");
    } finally {
      snapshot.close();
    }
    // Caddys lokale Zertifizierungsstelle wird zusammen mit den Hausdaten verschlüsselt gesichert.
    for (const path of await walkFiles(join(dataDir, "caddy"), "caddy"))
      required.add(path);
    if (await exists(join(dataDir, "runtime-config.json")))
      required.add("runtime-config.json");
    const files: Entry[] = [];
    let newObjects = 0;
    for (const path of [filename, ...[...required].sort()]) {
      const source =
        path === filename ? snapshotDb : join(dataDir, ...path.split("/"));
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error(
          "Eine benötigte Sicherungsdatei fehlt oder ist kein reguläres Dokument.",
        );
      const entry: Entry = { path, ...(await hashFile(source)) };
      files.push(entry);
      if (await storeObject(source, repositoryDir, key, entry)) newObjects++;
    }
    const createdAt = new Date().toISOString(),
      id = createdAt.replace(/[-:.]/g, "") + "-" + randomUUID();
    const manifest: Manifest = {
      version: 1,
      id,
      createdAt,
      databaseFilename: filename,
      files,
    };
    const target = join(repositoryDir, "snapshots", id + ".enc"),
      tmp = target + ".tmp";
    await writeFile(tmp, seal(Buffer.from(JSON.stringify(manifest)), key), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(tmp, target);
    const result: BackupResult = {
      id,
      createdAt,
      fileCount: files.length,
      totalBytes: files.reduce((sum, x) => sum + x.size, 0),
      newObjects,
    };
    try {
      result.removedSnapshots = await pruneSnapshotManifests(
        repositoryDir,
        key,
        id,
      );
    } catch {
      result.retentionWarning =
        "Der neue Stand ist gesichert. Alte Sicherungsstände konnten nicht bereinigt werden und bleiben erhalten.";
    }
    status.lastSuccess = result;
    await writeStatus(dataDir, status);
    return result;
  } catch (error) {
    status.error =
      error instanceof Error ? error.message : "Sicherung fehlgeschlagen.";
    await writeStatus(dataDir, status).catch(() => {});
    throw error;
  } finally {
    key?.fill(0);
    if (
      tempDir &&
      within(dataDir, tempDir) &&
      basename(tempDir).startsWith(".backup-")
    )
      await rm(tempDir, { recursive: true, force: true });
    if (lock) {
      await lock.close();
      await rm(join(repositoryDir, ".backup.lock"), { force: true });
    }
    active.delete(dataDir);
  }
}

/**
 * Prüft Struktur, Datumswert, Dateigrenzen und erlaubte Zielpfade eines entschlüsselten Manifests. Doppelte oder fehlende Datenbankpfade werden zurückgewiesen.
 */
function validateManifest(raw: unknown, id: string): Manifest {
  const m = raw as Manifest;
  if (
    !m ||
    m.version !== 1 ||
    m.id !== id ||
    typeof m.createdAt !== "string" ||
    !Number.isFinite(new Date(m.createdAt).getTime()) ||
    !Array.isArray(m.files) ||
    m.files.length < 1 ||
    m.files.length > 200000 ||
    typeof m.databaseFilename !== "string"
  )
    throw new Error("Ungültiges Sicherungsmanifest.");
  const databaseFilename = safeRelative(m.databaseFilename);
  if (databaseFilename.includes("/"))
    throw new Error("Ungültiger Datenbankpfad.");
  const seen = new Set<string>();
  for (const entry of m.files) {
    if (
      typeof entry.path !== "string" ||
      typeof entry.sha256 !== "string" ||
      !objectPattern.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    )
      throw new Error("Ungültiger Dateieintrag.");
    safeRelative(entry.path);
    if (seen.has(entry.path.toLowerCase()))
      throw new Error("Doppelter Pfad im Sicherungsmanifest.");
    seen.add(entry.path.toLowerCase());
    if (
      entry.path !== databaseFilename &&
      !entry.path.startsWith("media/") &&
      !entry.path.startsWith("caddy/") &&
      entry.path !== "runtime-config.json"
    )
      throw new Error("Unerlaubter Pfad im Sicherungsmanifest.");
  }
  if (!seen.has(databaseFilename.toLowerCase()))
    throw new Error("Datenbank fehlt im Sicherungsmanifest.");
  return m;
}

/**
 * Entschlüsselt einen gewählten Stand ausschließlich in einen leeren Zielordner. Prüft Dateien und SQLite, verwirft alte Sitzungen/Anfragekennungen und übernimmt erst danach die vorbereiteten Daten.
 */
export async function restoreBackup(
  options: RestoreOptions,
): Promise<{ id: string; fileCount: number; targetDir: string }> {
  if (!snapshotPattern.test(options.snapshotId))
    throw new Error("Ungültige Sicherungs-ID.");
  const repositoryDir = resolve(options.repositoryDir),
    targetDir = resolve(options.targetDir);
  if (within(repositoryDir, targetDir) || within(targetDir, repositoryDir))
    throw new Error(
      "Wiederherstellung und Archiv müssen getrennte Ordner sein.",
    );
  if (await exists(targetDir)) {
    const info = await lstat(targetDir);
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      (await readdir(targetDir)).length
    )
      throw new Error("Wiederherstellung nur in einen leeren Ordner erlaubt.");
  }
  await mkdir(targetDir, { recursive: true });
  const lock = await repositoryLock(repositoryDir);
  await lock.writeFile(
    JSON.stringify({
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
    }),
  );
  let key: Buffer | undefined;
  let staging: string | undefined;
  try {
    key = await repositoryKey(repositoryDir, options.passphrase);
    const manifest = validateManifest(
      JSON.parse(
        unseal(
          await readFile(
            join(repositoryDir, "snapshots", options.snapshotId + ".enc"),
          ),
          key,
        ).toString(),
      ),
      options.snapshotId,
    );
    staging = await mkdtemp(join(targetDir, ".restore-"));
    for (const entry of manifest.files) {
      const destination = join(staging, ...entry.path.split("/"));
      if (!within(staging, destination))
        throw new Error("Ungültiges Wiederherstellungsziel.");
      await mkdir(dirname(destination), { recursive: true });
      await decryptFile(
        join(repositoryDir, "objects", entry.sha256 + ".enc"),
        key,
        entry,
        destination,
      );
    }
    const database = new DatabaseSync(join(staging, manifest.databaseFilename));
    try {
      const integrity = database
        .prepare("PRAGMA integrity_check")
        .get() as Record<string, unknown>;
      if (Object.values(integrity)[0] !== "ok")
        throw new Error("Wiederhergestellte Datenbank ist beschädigt.");
      for (const table of ["sessions", "idempotency"])
        if (
          database
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          database.exec(`DELETE FROM ${table}`);
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      database.close();
    }
    for (const name of await readdir(staging))
      await rename(join(staging, name), join(targetDir, name));
    await rm(staging, { recursive: true, force: true });
    staging = undefined;
    return { id: manifest.id, fileCount: manifest.files.length, targetDir };
  } finally {
    key?.fill(0);
    if (
      staging &&
      within(targetDir, staging) &&
      basename(staging).startsWith(".restore-")
    )
      await rm(staging, { recursive: true, force: true });
    await lock.close();
    await rm(join(repositoryDir, ".backup.lock"), { force: true });
  }
}

/**
 * Liefert gültig benannte Sicherungsstände absteigend sortiert. Ein nicht lesbares oder noch fehlendes Archiv ergibt eine leere Liste.
 */
export async function listBackups(repositoryDir: string): Promise<string[]> {
  try {
    return (await readdir(join(repositoryDir, "snapshots")))
      .filter(
        (name) =>
          name.endsWith(".enc") && snapshotPattern.test(name.slice(0, -4)),
      )
      .map((name) => name.slice(0, -4))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Wählt die neuesten Stände aus sieben unterschiedlichen UTC-Kalendertagen, vier Wochen und drei Monaten. Alle Sicherungen des jüngsten Tages bleiben zusätzlich erhalten.
 */
export function retainedSnapshotIds(
  snapshots: { id: string; createdAt: string }[],
): Set<string> {
  const ordered = [...snapshots].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const keep = new Set<string>();
  const days = new Set<string>(),
    weeks = new Set<string>(),
    months = new Set<string>();
  const newestDay = ordered[0]?.createdAt.slice(0, 10);
  for (const item of ordered) {
    const date = new Date(item.createdAt);
    if (!Number.isFinite(date.getTime()))
      throw new Error("Ungültiges Sicherungsdatum.");
    const day = date.toISOString().slice(0, 10),
      month = day.slice(0, 7);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const week = date.toISOString().slice(0, 10);
    if (day === newestDay) keep.add(item.id);
    for (const [bucket, key, limit] of [
      [days, day, 7],
      [weeks, week, 4],
      [months, month, 3],
    ] as const) {
      if (!bucket.has(key) && bucket.size < limit) {
        bucket.add(key);
        keep.add(item.id);
      }
    }
  }
  return keep;
}
/**
 * Authentifiziert zunächst alle Manifeste und entfernt anschließend überzählige Sicherungsstände. Verschlüsselte Dateiobjekte bleiben vorsorglich bestehen; die Anzahl gelöschter Manifeste wird zurückgegeben.
 */
async function pruneSnapshotManifests(
  repositoryDir: string,
  key: Buffer,
  newId: string,
): Promise<number> {
  const snapshots: Manifest[] = [];
  // Erst alle Manifeste authentifizieren; bei einem beschädigten Archiv bleiben ältere Stände erhalten.
  for (const id of await listBackups(repositoryDir))
    snapshots.push(
      validateManifest(
        JSON.parse(
          unseal(
            await readFile(join(repositoryDir, "snapshots", id + ".enc")),
            key,
          ).toString(),
        ),
        id,
      ),
    );
  const keep = retainedSnapshotIds(snapshots);
  keep.add(newId);
  let removed = 0;
  for (const snapshot of snapshots)
    if (!keep.has(snapshot.id)) {
      await rm(join(repositoryDir, "snapshots", snapshot.id + ".enc"));
      removed++;
    }
  // Nicht mehr referenzierte verschlüsselte Objekte bleiben vorsorglich erhalten; ihre Bereinigung benötigt einen gesondert geprüften Ablauf.
  return removed;
}
