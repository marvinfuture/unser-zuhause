import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BaseRecord } from '../shared/types.js';

export type RecordKind = 'rooms' | 'projects' | 'tasks' | 'shopping' | 'defects' | 'notes' | 'photos' | 'comparisons';
export interface SessionRow { token_hash: string; csrf_token: string; profile_id: 'karla' | 'marvin' | null; profile_version: number; expires_at: number; created_at: number }

/** One local database; media bytes deliberately remain outside SQLite. */
export class Store {
  readonly raw: DatabaseSync;
  readonly path: string;
  readonly dataDir: string;
  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true });
    this.path = join(this.dataDir, 'home.sqlite');
    this.raw = new DatabaseSync(this.path);
    this.raw.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.raw.exec('CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const latest = this.raw.prepare('SELECT MAX(version) AS version FROM migrations').get() as { version: number | null };
    if ((latest.version ?? 0) > 1) throw new Error('Diese Datenbank benötigt eine neuere App-Version.');
    if (!latest.version) this.transaction(() => {
      this.raw.exec(`
        CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE records(kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)), version INTEGER NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, profile_id TEXT CHECK(profile_id IN ('karla','marvin')), profile_version INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        CREATE TABLE idempotency(key TEXT PRIMARY KEY, response TEXT NOT NULL, created_at INTEGER NOT NULL);
      `);
      this.raw.prepare('INSERT INTO migrations VALUES(1,?)').run(new Date().toISOString());
    });
  }
  transaction<T>(operation: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.raw.exec('COMMIT'); return result; }
    catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
  list<T = BaseRecord>(kind: RecordKind): T[] {
    return (this.raw.prepare('SELECT json FROM records WHERE kind=? ORDER BY rowid').all(kind) as {json: string}[]).map(row => JSON.parse(row.json) as T);
  }
  get<T = BaseRecord>(kind: RecordKind, id: string): T | undefined {
    const row = this.raw.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id) as {json: string} | undefined;
    return row ? JSON.parse(row.json) as T : undefined;
  }
  put(kind: RecordKind, record: BaseRecord): void {
    this.raw.prepare('INSERT INTO records(kind,id,json,version) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,version=excluded.version').run(kind,record.id,JSON.stringify(record),record.version);
  }
  remove(kind: RecordKind, id: string): void { this.raw.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  getSetting<T = unknown>(key: string): T | undefined {
    const row = this.raw.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string}|undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  setSetting(key: string, value: unknown): void { this.raw.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)); }
  getIdempotent<T = unknown>(key: string): T | undefined {
    const row = this.raw.prepare('SELECT response FROM idempotency WHERE key=?').get(key) as {response:string}|undefined;
    return row ? JSON.parse(row.response) as T : undefined;
  }
  saveIdempotent(key: string, record: unknown): void { this.raw.prepare('INSERT INTO idempotency VALUES(?,?,?)').run(key,JSON.stringify(record),Date.now()); }
  close(): void { this.raw.close(); }
}
