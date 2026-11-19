import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createApp } from "../server/app.js";
import { createBackup, restoreBackup } from "../server/backup.js";
import type { ProfileId } from "../shared/types.js";

/** Startet den regulären Server in einem isolierten Datenordner und schließt alle Verbindungen nach dem Test. */
async function start(dataDir: string) {
  const ctx = createApp({ dataDir });
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  /** Beendet HTTP und SQLite, bevor ein temporärer Ordner entfernt wird. */
  async function close() {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    ctx.db.close();
  }
  return { ctx, base, close };
}

/** Erstellt zwei unabhängige Geräte mit eigenem Namensschild und entfernt nachher ausschließlich ihre Testdaten. */
async function household(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "zuhause-rewards-"));
  const dataDir = join(root, "data");
  const server = await start(dataDir);
  t.after(async () => {
    await server.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    ...server,
    root,
    dataDir,
    karla: await device(server.base, "karla"),
    marvin: await device(server.base, "marvin"),
  };
}

/** Meldet ein Testgerät mit Gerätesitzung, Namensauswahl und geschützten Anfragen an. */
async function device(base: string, profileId: ProfileId) {
  const entry = await fetch(base + "/api/session");
  const cookie = entry.headers.get("set-cookie")!.split(";")[0];
  const session = await entry.json();
  const headers = {
    Cookie: cookie,
    "X-CSRF-Token": session.csrfToken,
    Origin: base,
    "Content-Type": "application/json",
  };
  /** Führt einen normalen API-Aufruf aus und liefert fachliche Antwort und HTTP-Status. */
  async function send(path: string, method = "GET", body?: object) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers,
      body: body && JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const chosen = await send("/profile", "POST", {
    profileId,
    profileVersion: session.profileVersion,
  });
  assert.equal(chosen.status, 200);
  const profileVersion = chosen.body.profileVersion as number;
  /** Sendet eine beliebige geschützte Punkteaktion mit erneut verwendbarer Anfragekennung. */
  function command(fields: Record<string, unknown>) {
    return send("/rewards", "POST", {
      profileVersion,
      requestId: randomUUID(),
      settingsVersion: 1,
      ...fields,
    });
  }
  /** Legt eine normale Aufgabe über denselben Einstieg wie Projektschritte und schnelle Alltagserledigungen an. */
  function task(title: string, fields: Record<string, unknown> = {}) {
    return send("/tasks", "POST", { profileVersion, requestId: randomUUID(), title, ...fields });
  }
  /** Wechselt den Aufgabenstatus mit der gelesenen Versionsnummer. */
  function mark(record: { id: string; version: number }, status: string) {
    return send(`/tasks/${record.id}`, "PATCH", {
      profileVersion,
      version: record.version,
      status,
    });
  }
  return { send, command, task, mark, cookie, profileVersion };
}

test("nur aktivierte Punkte zählen, einmal je Aufgabe für die abhakende Person", async (t) => {
  const { base, karla, marvin } = await household(t);
  assert.equal((await fetch(base + "/api/rewards")).status, 401);
  assert.equal(
    (await fetch(base + "/api/rewards", { method: "POST", headers: { Cookie: karla.cookie } }))
      .status,
    403,
  );
  assert.equal((await karla.send("/rewards")).body.enabled, false);
  await karla.task("Alte Aufgabe", { status: "done" });
  const open = (await karla.task("Glaser anrufen", { assignees: ["karla"] })).body;
  const enabled = await marvin.command({ action: "configure", enabled: true, settingsVersion: 0 });
  assert.deepEqual(enabled.body.balances, { karla: 0, marvin: 0 });
  const done = await marvin.mark(open, "done");
  assert.equal(done.body.completedBy, "marvin");
  const reopened = await karla.mark(done.body, "open");
  assert.equal((await karla.mark(reopened.body, "done")).status, 200);
  const state = (await marvin.send("/rewards")).body;
  assert.deepEqual(state.balances, { karla: 0, marvin: 1 });
  assert.equal(state.recent.length, 1);
  assert.equal(state.recent[0].title, "Glaser anrufen");
  assert.equal(state.recent[0].createdBy, "marvin");

  const project = (
    await marvin.send("/projects", "POST", {
      title: "Bad",
      requestId: randomUUID(),
      profileVersion: marvin.profileVersion,
    })
  ).body;
  const predecessor = (await marvin.task("Abdecken", { projectId: project.id })).body;
  const follower = (
    await marvin.task("Streichen", { projectId: project.id, predecessorIds: [predecessor.id] })
  ).body;
  assert.equal((await marvin.mark(follower, "done")).status, 409);
  assert.equal((await marvin.send("/rewards")).body.balances.marvin, 1);
  await marvin.command({ action: "configure", enabled: false });
  await karla.task("Während der Pause", { status: "done" });
  const resumed = await karla.command({ action: "configure", enabled: true, settingsVersion: 2 });
  assert.deepEqual(resumed.body.balances, { karla: 0, marvin: 1 });
  assert.equal((await marvin.command({ action: "configure", enabled: false })).status, 409);
});

test("Belohnungspreis, persönliches Guthaben, Konkurrenz und Wiederholung bleiben konsistent", async (t) => {
  const { base, karla, marvin } = await household(t);
  await karla.command({ action: "configure", enabled: true, settingsVersion: 0 });
  await karla.task("Werkzeug aufräumen", { status: "done" });
  const create = { action: "create", title: "Kinoabend", cost: 1, requestId: randomUUID() };
  const catalog = (await marvin.command(create)).body;
  const reward = catalog.rewards[0];
  assert.equal((await marvin.command(create)).body.rewards.length, 1);
  assert.equal((await marvin.command({ ...create, cost: 4 })).status, 409);
  const redeem = { action: "redeem", id: reward.id, version: reward.version };
  assert.equal((await marvin.command(redeem)).body.code, "INSUFFICIENT_POINTS");
  const otherKarla = await device(base, "karla");
  const id1 = randomUUID(),
    id2 = randomUUID();
  const both = await Promise.all([
    karla.command({ ...redeem, requestId: id1 }),
    otherKarla.command({ ...redeem, requestId: id2 }),
  ]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  const replay = await karla.command({ ...redeem, requestId: both[0].status === 200 ? id1 : id2 });
  assert.deepEqual(replay.body.balances, { karla: 0, marvin: 0 });
  assert.equal(
    replay.body.recent.filter((entry: { points: number }) => entry.points < 0).length,
    1,
  );
  const edit = {
    action: "edit",
    id: reward.id,
    version: reward.version,
    title: "Eis essen",
    cost: 2,
    archived: false,
  };
  const changed = (await karla.command(edit)).body;
  assert.equal(changed.rewards[0].cost, 2);
  assert.equal(changed.recent[0].title, "Kinoabend");
  assert.equal((await marvin.command(redeem)).body.code, "REWARD_CHANGED");
  assert.equal((await marvin.command(edit)).status, 409);
  const archived = (
    await marvin.command({ ...edit, archived: true, version: changed.rewards[0].version })
  ).body.rewards[0];
  assert.equal(
    (await karla.command({ ...redeem, version: archived.version })).body.code,
    "REWARD_ARCHIVED",
  );
  await karla.send("/profile", "POST", {
    profileId: "marvin",
    profileVersion: karla.profileVersion,
  });
  assert.equal(
    (await karla.command({ action: "configure", enabled: false })).body.code,
    "PROFILE_CHANGED",
  );
});

test("verschlüsselte Rücksicherung erhält persönliche Konten, Katalog und dauerhafte Buchungskennungen", async (t) => {
  const { ctx, root, dataDir, karla, marvin } = await household(t);
  await karla.command({ action: "configure", enabled: true, settingsVersion: 0 });
  await marvin.task("Streichen", { status: "done" });
  await karla.task("Bestellen", { status: "done" });
  const created = (await karla.command({ action: "create", title: "Spieleabend", cost: 1 })).body
    .rewards[0];
  const redeem = {
    action: "redeem",
    id: created.id,
    version: created.version,
    requestId: randomUUID(),
  };
  assert.equal((await marvin.command(redeem)).status, 200);
  const repositoryDir = join(root, "archiv"),
    targetDir = join(root, "restored"),
    passphrase = "synthetische Testsicherung";
  const backup = await createBackup({ dataDir, repositoryDir, passphrase, database: ctx.db.raw });
  await restoreBackup({ repositoryDir, passphrase, targetDir, snapshotId: backup.id });
  const restored = await start(targetDir);
  try {
    const fresh = await device(restored.base, "marvin");
    assert.equal(
      (await fetch(restored.base + "/api/rewards", { headers: { Cookie: marvin.cookie } })).status,
      401,
    );
    const result = (await fresh.send("/rewards")).body;
    assert.deepEqual(result.balances, { karla: 1, marvin: 0 });
    assert.equal(result.rewards[0].id, created.id);
    assert.equal(result.recent.length, 3);
    assert.equal((await fresh.command(redeem)).body.code, "REWARD_ALREADY_REDEEMED");
  } finally {
    await restored.close();
  }
});
