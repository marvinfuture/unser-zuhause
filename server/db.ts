import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BaseRecord } from "../shared/types.js";

export type RecordKind =
  | "rooms"
  | "projects"
  | "tasks"
  | "shopping"
  | "defects"
  | "notes"
  | "photos"
  | "comparisons";
export interface SessionRow {
  token_hash: string;
  csrf_token: string;
  profile_id: "karla" | "marvin" | null;
  profile_version: number;
  expires_at: number;
  created_at: number;
}

/** Gemeinsamer lokaler Datenspeicher; die eigentlichen Bilddateien liegen getrennt von SQLite. */
export class Store {
  readonly raw: DatabaseSync;
  readonly path: string;
  readonly dataDir: string;
  /**
   * Öffnet die lokale SQLite-Datei, aktiviert belastbare Schreibregeln und führt fehlende nummerierte Migrationen aus. Eine neuere unbekannte Schema-Version wird nicht verändert.
   */
  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true });
    this.path = join(this.dataDir, "home.sqlite");
    this.raw = new DatabaseSync(this.path);
    this.raw.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    this.raw.exec(
      "CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const latest = this.raw
      .prepare("SELECT MAX(version) AS version FROM migrations")
      .get() as { version: number | null };
    if ((latest.version ?? 0) > 1)
      throw new Error("Diese Datenbank benötigt eine neuere App-Version.");
    if (!latest.version)
      this.transaction(() => {
        this.raw.exec(`
        CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE records(kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)), version INTEGER NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, profile_id TEXT CHECK(profile_id IN ('karla','marvin')), profile_version INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        CREATE TABLE idempotency(key TEXT PRIMARY KEY, response TEXT NOT NULL, created_at INTEGER NOT NULL);
      `);
        this.raw
          .prepare("INSERT INTO migrations VALUES(1,?)")
          .run(new Date().toISOString());
      });
  }
  /**
   * Führt ausschließlich synchrone Datenbankarbeit gemeinsam aus: Erfolg bestätigt alle Änderungen, ein Fehler rollt sie zurück und wird erneut geworfen.
   */
  transaction<T>(operation: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
  /**
   * Lädt alle Datensätze einer Kategorie in Einfügereihenfolge, einschließlich archivierter Einträge. Die jeweilige Ansicht entscheidet über ihre Filter.
   */
  list<T = BaseRecord>(kind: RecordKind): T[] {
    return (
      this.raw
        .prepare("SELECT json FROM records WHERE kind=? ORDER BY rowid")
        .all(kind) as { json: string }[]
    ).map((row) => JSON.parse(row.json) as T);
  }
  /**
   * Lädt einen einzelnen Datensatz über Kategorie und ID; eine nicht vorhandene Kombination ergibt undefined.
   */
  get<T = BaseRecord>(kind: RecordKind, id: string): T | undefined {
    const row = this.raw
      .prepare("SELECT json FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }
  /**
   * Legt einen Datensatz an oder ersetzt dessen JSON-Inhalt und Versionsnummer. Rechte, Eingaben und Versionskonflikte müssen bereits vom aufrufenden Handler geprüft sein.
   */
  put(kind: RecordKind, record: BaseRecord): void {
    this.raw
      .prepare(
        "INSERT INTO records(kind,id,json,version) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,version=excluded.version",
      )
      .run(kind, record.id, JSON.stringify(record), record.version);
  }
  /**
   * Löscht genau den Datensatz der angegebenen Kategorie und ID endgültig. Mediendateien und weitere Verweise werden hier nicht automatisch entfernt.
   */
  remove(kind: RecordKind, id: string): void {
    this.raw.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  /**
   * Liest einen als JSON gespeicherten Einstellungswert; für unbekannte Schlüssel wird undefined zurückgegeben.
   */
  getSetting<T = unknown>(key: string): T | undefined {
    const row = this.raw
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  /**
   * Speichert oder ersetzt einen JSON-Einstellungswert, beispielsweise den Kennworthash oder interne Medienmetadaten.
   */
  setSetting(key: string, value: unknown): void {
    this.raw
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  /**
   * Liest das gespeicherte Ergebnis einer bereits verarbeiteten Anfrage, damit Wiederholungen keinen zweiten Eintrag erzeugen.
   */
  getIdempotent<T = unknown>(key: string): T | undefined {
    const row = this.raw
      .prepare("SELECT response FROM idempotency WHERE key=?")
      .get(key) as { response: string } | undefined;
    return row ? (JSON.parse(row.response) as T) : undefined;
  }
  /**
   * Speichert das erste Ergebnis unter einer eindeutigen Anfragekennung. Der Aufrufer schreibt es gemeinsam mit der fachlichen Änderung in einer Transaktion.
   */
  saveIdempotent(key: string, record: unknown): void {
    this.raw
      .prepare("INSERT INTO idempotency VALUES(?,?,?)")
      .run(key, JSON.stringify(record), Date.now());
  }
  /**
   * Schließt die SQLite-Verbindung nach abgeschlossenen Anfragen und gibt die zugehörigen Dateiressourcen frei.
   */
  close(): void {
    this.raw.close();
  }
}
