import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import * as webpush from "web-push";
import type { ProfileId, Session } from "../shared/types.js";
import { createApp } from "../server/app.js";
import { dispatchPush } from "../server/push.js";
import { createBackup, restoreBackup } from "../server/backup.js";
import { Store } from "../server/db.js";

/** Erzeugt ein lokales Testgerät mit gültigen Verschlüsselungsschlüsseln und einem fiktiven Anbieter-Endpunkt. */
function subscription() {
  const keys = createECDH("prime256v1");
  return {
    endpoint: "https://web.push.apple.com/" + randomUUID(),
    expirationTime: null,
    keys: {
      p256dh: keys.generateKeys().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

/** Startet die echte Anwendung mit einem temporären Haushalt und zwei unabhängigen Browsersitzungen. */
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "uz-push-"));
  const ctx = createApp({ dataDir: join(dir, "home") });
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const base = "http://127.0.0.1:" + addr.port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    ctx.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  /** Meldet ein Testgerät an und sendet echte Anfragen mit seiner aktuellen Profilversion. */
  async function browser(profileId: ProfileId) {
    const initial = await fetch(base + "/api/session");
    const cookie = initial.headers.get("set-cookie")!.split(";")[0];
    let session: Session = await initial.json();
    /** Überträgt benannte Aktionen mit dem im Browser bestätigten CSRF- und Profilstand. */
    function post(path: string, body: Record<string, unknown>) {
      return fetch(base + "/api/" + path, {
        method: "POST",
        headers: {
          Origin: base,
          Cookie: cookie,
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileVersion: session.profileVersion, ...body }),
      });
    }
    const chosen = await post("profile", { profileId });
    assert.equal(chosen.status, 200);
    session = await chosen.json();
    return { post, cookie };
  }
  const karla = await browser("karla");
  const marvin = await browser("marvin");
  /** Legt einen Termin mit fester Berliner Erinnerungszeit an, damit alle Versuche denselben Zeitpunkt verwenden. */
  async function entry(title: string, profileIds: ProfileId[]) {
    const res = await karla.post("calendar", {
      title,
      kind: "waste",
      startDay: "2030-02-08",
      everyWeeks: 2,
      endDay: null,
      remindDays: 1,
      remindTime: "18:00",
      profileIds,
      requestId: randomUUID(),
    });
    assert.equal(res.status, 201);
    return res.json();
  }
  return { ctx, dir, base, karla, marvin, entry };
}

const now = new Date("2030-02-07T17:00:00Z");

test("Beim Versand abgehakte Termine bleiben still und ein verschobener Termin erinnert zur neuen Zeit", async (t) => {
  const { ctx, karla, entry } = await fixture(t);
  await karla.post("push/subscribe", {
    subscription: subscription(),
    contactEmail: "test@example.test",
  });
  const early = await entry("A Papier", ["karla"]);
  const later = await entry("B Restmüll", ["karla"]);
  const date = "2030-02-08";
  const received: string[] = [];
  await dispatchPush(ctx.db, now, async (_device, message) => {
    received.push(message.title);
    assert.equal(
      (
        await karla.post(`calendar/${later.id}/occurrences/${date}`, {
          action: "done",
          version: 0,
          seriesVersion: 1,
        })
      ).status,
      200,
    );
  });
  assert.deepEqual(received, ["A Papier"]);
  assert.equal(
    (
      await karla.post(`calendar/${early.id}/occurrences/${date}`, {
        action: "move",
        movedTo: "2030-02-09",
        version: 0,
        seriesVersion: 1,
      })
    ).status,
    200,
  );
  await dispatchPush(ctx.db, new Date("2030-02-08T17:00:00Z"), async (_device, message) => {
    received.push(message.title);
  });
  assert.deepEqual(received, ["A Papier", "A Papier"]);
});

test("Push-Einrichtung validiert Profil, Herkunft des Endpunkts und Schlüssel, ohne Geräteinformationen offenzulegen", async (t) => {
  const { base, ctx, karla } = await fixture(t);
  const device = subscription();
  assert.equal((await fetch(base + "/api/push/setup")).status, 401);
  const setup = await fetch(base + "/api/push/setup", { headers: { Cookie: karla.cookie } });
  const data = await setup.json();
  assert.deepEqual(Object.keys(data).sort(), ["needsContact", "publicKey"]);
  assert.equal(Buffer.from(data.publicKey, "base64url").length, 65);
  const body = { subscription: device, contactEmail: "haushalt@example.test" };
  assert.equal((await karla.post("push/subscribe", { ...body, profileVersion: 0 })).status, 409);
  for (const url of [
    "https://example.test/push",
    "https://web.push.apple.com.invalid/push",
    "https://web.push.apple.com:8443/push",
    "https://user@web.push.apple.com/token",
    "http://web.push.apple.com/token",
  ]) {
    assert.equal(
      (await karla.post("push/subscribe", { ...body, subscription: { ...device, endpoint: url } }))
        .status,
      400,
    );
  }
  assert.equal(
    (
      await karla.post("push/subscribe", {
        ...body,
        subscription: { ...device, keys: { ...device.keys, p256dh: "AAAA" } },
      })
    ).status,
    400,
  );
  assert.equal((await karla.post("push/subscribe", body)).status, 200);
  assert.equal((await karla.post("push/subscribe", body)).status, 200);
  const status = await (await karla.post("push/status", { endpoint: device.endpoint })).json();
  assert.deepEqual(status, { profile: "karla", lastFailure: null });
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'push:device:%'").get()
      ?.n,
    1,
  );
  assert.equal((await karla.post("push/unsubscribe", { endpoint: device.endpoint })).status, 200);
  assert.equal((await karla.post("push/test", { endpoint: device.endpoint })).status, 409);
});

test("Kalenderzustellung verschlüsselt Text, wählt passende Profile und verhindert doppelte Zusagen bei parallelen Ticks", async (t) => {
  const { ctx, karla, marvin, entry } = await fixture(t);
  const a = subscription(),
    b = subscription();
  await karla.post("push/subscribe", { subscription: a, contactEmail: "haushalt@example.test" });
  await marvin.post("push/subscribe", { subscription: b });
  await entry("Blaue Tonne", ["karla"]);
  await entry("Restmüll", ["karla", "marvin"]);
  const calls: string[] = [];
  /** Erzeugt den echten signierten, verschlüsselten Web-Push-Request im Speicher und prüft seine Zielzuordnung. */
  const capture: NonNullable<Parameters<typeof dispatchPush>[2]> = async (
    device,
    message,
    options,
  ) => {
    const details = webpush.generateRequestDetails(device, JSON.stringify(message), options);
    assert.equal(details.headers["Content-Encoding"], "aes128gcm");
    assert.ok(details.body && !details.body.includes(Buffer.from(message.title)));
    assert.match(String(details.headers.Authorization), /^vapid /);
    assert.equal(details.endpoint, device.endpoint);
    calls.push((device.endpoint === a.endpoint ? "Karla " : "Marvin ") + message.title);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  await dispatchPush(ctx.db, new Date(now.getTime() - 1), capture);
  assert.deepEqual(calls, []);
  await Promise.all([dispatchPush(ctx.db, now, capture), dispatchPush(ctx.db, now, capture)]);
  await dispatchPush(ctx.db, new Date(now.getTime() + 3600000), capture);
  assert.deepEqual(calls.sort(), ["Karla Blaue Tonne", "Karla Restmüll", "Marvin Restmüll"]);
  const reopened = new Store(ctx.db.dataDir);
  try {
    await dispatchPush(reopened, new Date(now.getTime() + 3600000), capture);
  } finally {
    reopened.close();
  }
  assert.equal(calls.length, 3);
});

test("Vorübergehende Ausfälle werden erneut versucht, abgelaufene Abos gelöscht und Restore beginnt ohne alte Push-Geräte", async (t) => {
  const { ctx, dir, karla, marvin, entry } = await fixture(t);
  const a = subscription(),
    b = subscription();
  await karla.post("push/subscribe", { subscription: a, contactEmail: "haushalt@example.test" });
  await marvin.post("push/subscribe", { subscription: b });
  await entry("Biotonne", ["karla", "marvin"]);
  let attempts = 0;
  await dispatchPush(ctx.db, now, async (device) => {
    attempts++;
    throw Object.assign(new Error("Nur Testtransport"), {
      statusCode: device.endpoint === a.endpoint ? 503 : 410,
    });
  });
  assert.equal(attempts, 2);
  const temp = await (await karla.post("push/status", { endpoint: a.endpoint })).json();
  assert.equal(temp.lastFailure, now.toISOString());
  const gone = await (await marvin.post("push/status", { endpoint: b.endpoint })).json();
  assert.equal(gone.profile, null);
  /** Zählt nur erfolgreiche Wiederholungen für das weiterhin angemeldete Gerät. */
  const accept: NonNullable<Parameters<typeof dispatchPush>[2]> = async (device) => {
    assert.equal(device.endpoint, a.endpoint);
    attempts++;
  };
  await dispatchPush(ctx.db, new Date(now.getTime() + 60_000), accept);
  assert.equal(attempts, 2);
  await dispatchPush(ctx.db, new Date(now.getTime() + 11 * 60_000), accept);
  assert.equal(attempts, 3);
  const repositoryDir = join(dir, "archive"),
    targetDir = join(dir, "restored"),
    passphrase = randomBytes(32).toString("hex");
  const result = await createBackup({
    dataDir: ctx.db.dataDir,
    database: ctx.db.raw,
    databaseFilename: "home.sqlite",
    repositoryDir,
    passphrase,
  });
  await restoreBackup({ repositoryDir, targetDir, passphrase, snapshotId: result.id });
  const restored = new Store(targetDir);
  try {
    assert.equal(
      restored.raw.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'push:%'").get()?.n,
      0,
    );
    assert.equal(restored.list("calendar").length, 1);
    await dispatchPush(restored, now, accept);
    assert.equal(attempts, 3);
  } finally {
    restored.close();
  }
});

test("Der echte Service Worker zeigt Text und Symbol an und öffnet beim Antippen ausschließlich den lokalen Kalender", async () => {
  const handlers = new Map<string, (event: any) => void>();
  const notices: { title: string; options: any }[] = [];
  const opened: string[] = [];
  let closed = false;
  runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL,
    self: {
      location: { origin: "https://haus.example" },
      addEventListener: (name: string, handler: (event: any) => void) =>
        handlers.set(name, handler),
      registration: {
        showNotification: async (title: string, options: unknown) =>
          notices.push({ title, options }),
      },
      clients: { matchAll: async () => [], openWindow: async (url: string) => opened.push(url) },
    },
  });
  const work: Promise<unknown>[] = [];
  handlers.get("push")!({
    data: {
      json: () => ({
        title: "Biotonne",
        body: "Morgen",
        kind: "waste",
        key: "abc",
        url: "https://example.test",
      }),
    },
    waitUntil: (p: Promise<unknown>) => work.push(p),
  });
  handlers.get("notificationclick")!({
    notification: {
      close: () => {
        closed = true;
      },
    },
    waitUntil: (p: Promise<unknown>) => work.push(p),
  });
  await Promise.all(work);
  assert.equal(notices[0].title, "🗑️ Biotonne");
  assert.equal(notices[0].options.body, "Morgen");
  assert.equal(notices[0].options.icon, "/icon-192.png");
  assert.equal(closed, true);
  assert.deepEqual(opened, ["https://haus.example/#/calendar"]);
});
