import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  createBackup,
  listBackups,
  readBackupStatus,
  restoreBackup,
  retainedSnapshotIds,
} from "../server/backup.ts";

const password = "Zuhause-Backup-Test-2026";
/** Erzeugt eine kleine Testdatenbank samt künstlichem Foto und ein getrenntes Sicherungsarchiv im temporären Ordner. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zuhause-backup-test-"));
  const dataDir = join(root, "data"),
    repositoryDir = join(root, "repository");
  await mkdir(join(dataDir, "media", "originals"), { recursive: true });
  await writeFile(
    join(dataDir, "media", "originals", "photo.jpg"),
    "private photo bytes",
  );
  const database = new DatabaseSync(join(dataDir, "home.sqlite"));
  database.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE sessions(token TEXT); CREATE TABLE idempotency(key TEXT); CREATE TABLE rooms(title TEXT); INSERT INTO sessions VALUES('private-token'); INSERT INTO idempotency VALUES('retry-key'); INSERT INTO rooms VALUES('Wohnzimmer');",
  );
  database
    .prepare("INSERT INTO settings VALUES(?,?)")
    .run(
      "media:one",
      JSON.stringify({ original: "media/originals/photo.jpg" }),
    );
  return {
    root,
    dataDir,
    repositoryDir,
    database,
    /** Schließt SQLite und entfernt nur den zuvor geprüften temporären Testordner. */
    async cleanup() {
      database.close();
      const rel = relative(resolve(tmpdir()), resolve(root));
      assert(!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== "..");
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("encrypted backup restores consistent database and photos, clearing sessions", async () => {
  const f = await fixture();
  try {
    const result = await createBackup({ ...f, passphrase: password });
    assert.equal(result.fileCount, 2);
    const raw = await readFile(
      join(f.repositoryDir, "snapshots", result.id + ".enc"),
    );
    assert(!raw.includes(Buffer.from("Wohnzimmer")));
    const restored = join(f.root, "restored");
    await restoreBackup({
      repositoryDir: f.repositoryDir,
      snapshotId: result.id,
      passphrase: password,
      targetDir: restored,
    });
    assert.equal(
      await readFile(join(restored, "media", "originals", "photo.jpg"), "utf8"),
      "private photo bytes",
    );
    const db = new DatabaseSync(join(restored, "home.sqlite"));
    try {
      assert.equal(
        (db.prepare("SELECT title FROM rooms").get() as { title: string })
          .title,
        "Wohnzimmer",
      );
      assert.equal(
        (
          db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as {
            n: number;
          }
        ).n,
        0,
      );
      assert.equal(
        (
          db.prepare("SELECT COUNT(*) AS n FROM idempotency").get() as {
            n: number;
          }
        ).n,
        0,
      );
    } finally {
      db.close();
    }
    assert.equal(
      (await readBackupStatus(f.dataDir)).lastSuccess?.id,
      result.id,
    );
  } finally {
    await f.cleanup();
  }
});

test(
  "Windows restore script preserves Unicode passwords through native stdin",
  { skip: process.platform !== "win32" },
  async () => {
    const f = await fixture();
    try {
      const passphrase = "Prüfpasswort-ÄΩ-2026";
      const result = await createBackup({ ...f, passphrase });
      const restored = join(f.root, "restored");
      const wrapper = join(f.root, "restore-test.ps1");
      // Nur die interaktive Eingabe wird ersetzt; das echte Skript entschlüsselt ein echtes Testarchiv.
      await writeFile(
        wrapper,
        "\uFEFF" +
          `
$ErrorActionPreference = 'Stop'
$global:OutputEncoding = [Text.Encoding]::ASCII
$initialEncoding = $global:OutputEncoding
# Liefert ausschließlich das künstliche Testkennwort und verlangt eine verdeckte Eingabe.
function global:Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if (-not $AsSecureString) { throw 'Expected a protected password prompt.' }
    ConvertTo-SecureString -String $env:UZ_TEST_PASSWORD -AsPlainText -Force
}
& $env:UZ_TEST_RESTORE_SCRIPT -RepositoryDir $env:UZ_TEST_ARCHIVE -SnapshotId $env:UZ_TEST_SNAPSHOT -TargetDir $env:UZ_TEST_TARGET
if ($LASTEXITCODE -ne 0) { throw 'Restore script failed.' }
if (-not [Object]::ReferenceEquals($global:OutputEncoding, $initialEncoding)) { throw 'OutputEncoding was not restored.' }
`,
        "utf8",
      );
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          wrapper,
        ],
        {
          cwd: resolve("."),
          env: {
            ...process.env,
            UZ_TEST_PASSWORD: passphrase,
            UZ_TEST_RESTORE_SCRIPT: resolve("scripts/Restore.ps1"),
            UZ_TEST_ARCHIVE: f.repositoryDir,
            UZ_TEST_SNAPSHOT: result.id,
            UZ_TEST_TARGET: restored,
          },
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
        },
      );
      assert.equal(
        await readFile(
          join(restored, "media", "originals", "photo.jpg"),
          "utf8",
        ),
        "private photo bytes",
      );
      const database = new DatabaseSync(join(restored, "home.sqlite"), {
        readOnly: true,
      });
      try {
        assert.equal(
          (
            database.prepare("SELECT title FROM rooms").get() as {
              title: string;
            }
          ).title,
          "Wohnzimmer",
        );
        assert.equal(
          (
            database.prepare("SELECT COUNT(*) AS n FROM sessions").get() as {
              n: number;
            }
          ).n,
          0,
        );
      } finally {
        database.close();
      }
    } finally {
      await f.cleanup();
    }
  },
);

test("unchanged files are deduplicated and both snapshots remain available", async () => {
  const f = await fixture();
  try {
    const first = await createBackup({ ...f, passphrase: password });
    const count = (await readdir(join(f.repositoryDir, "objects"))).length;
    const second = await createBackup({ ...f, passphrase: password });
    assert.equal(second.newObjects, 0);
    assert.equal(
      (await readdir(join(f.repositoryDir, "objects"))).length,
      count,
    );
    assert.deepEqual(
      new Set(await listBackups(f.repositoryDir)),
      new Set([first.id, second.id]),
    );
  } finally {
    await f.cleanup();
  }
});

test("wrong password, corrupted object and occupied target are refused", async () => {
  const f = await fixture();
  try {
    const b = await createBackup({ ...f, passphrase: password });
    await assert.rejects(
      restoreBackup({
        repositoryDir: f.repositoryDir,
        snapshotId: b.id,
        passphrase: "incorrect-password",
        targetDir: join(f.root, "wrong"),
      }),
    );
    await assert.rejects(
      restoreBackup({
        repositoryDir: f.repositoryDir,
        snapshotId: b.id,
        passphrase: password,
        targetDir: f.dataDir,
      }),
      /leeren Ordner/,
    );
    const names = await readdir(join(f.repositoryDir, "objects"));
    const object = join(f.repositoryDir, "objects", names[0]);
    const bytes = await readFile(object);
    bytes[20] ^= 1;
    await writeFile(object, bytes);
    const destination = join(f.root, "damaged");
    await assert.rejects(
      restoreBackup({
        repositoryDir: f.repositoryDir,
        snapshotId: b.id,
        passphrase: password,
        targetDir: destination,
      }),
    );
    assert.deepEqual(await readdir(destination), []);
  } finally {
    await f.cleanup();
  }
});

test("missing referenced media fails backup and preserves last successful status", async () => {
  const f = await fixture();
  try {
    const b = await createBackup({ ...f, passphrase: password });
    await rm(join(f.dataDir, "media", "originals", "photo.jpg"));
    await assert.rejects(createBackup({ ...f, passphrase: password }));
    const status = await readBackupStatus(f.dataDir);
    assert.equal(status.lastSuccess?.id, b.id);
    assert(status.error);
    assert.equal((await listBackups(f.repositoryDir)).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("unsafe locations and snapshot traversal are rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      createBackup({
        ...f,
        repositoryDir: join(f.dataDir, "backup"),
        passphrase: password,
      }),
      /getrennte Ordner/,
    );
    await assert.rejects(
      restoreBackup({
        repositoryDir: f.repositoryDir,
        snapshotId: "../../secret",
        passphrase: password,
        targetDir: join(f.root, "restore"),
      }),
      /Sicherungs-ID/,
    );
    f.database
      .prepare("UPDATE settings SET value=?")
      .run(JSON.stringify({ original: "../outside.jpg" }));
    await assert.rejects(
      createBackup({ ...f, passphrase: password }),
      /außerhalb/,
    );
  } finally {
    await f.cleanup();
  }
});

test("retention preserves daily, weekly and monthly recovery points plus newest-day snapshots", () => {
  const snapshots = [] as { id: string; createdAt: string }[];
  for (let days = 0; days < 120; days++) {
    const date = new Date("2026-11-16T15:00:00.000Z");
    date.setUTCDate(date.getUTCDate() - days);
    snapshots.push({ id: `day-${days}`, createdAt: date.toISOString() });
  }
  snapshots.push({ id: "second-today", createdAt: "2026-11-16T16:00:00.000Z" });
  const keep = retainedSnapshotIds(snapshots);
  assert(keep.has("second-today"));
  for (let day = 0; day < 7; day++) assert(keep.has(`day-${day}`));
  assert(keep.has("day-8"));
  assert(keep.has("day-15"));
  assert(keep.has("day-16"));
  assert(keep.has("day-47"));
  assert(!keep.has("day-119"));
  assert(keep.size < 20);
});

test("an archive lock prevents a concurrent restore without modifying target files", async () => {
  const f = await fixture();
  try {
    const result = await createBackup({ ...f, passphrase: password });
    await writeFile(
      join(f.repositoryDir, ".backup.lock"),
      JSON.stringify({ pid: process.pid, host: "another-server" }),
    );
    await assert.rejects(
      restoreBackup({
        repositoryDir: f.repositoryDir,
        snapshotId: result.id,
        passphrase: password,
        targetDir: join(f.root, "restore"),
      }),
      /bereits verwendet/,
    );
    assert.equal((await listBackups(f.repositoryDir)).length, 1);
  } finally {
    await f.cleanup();
  }
});
