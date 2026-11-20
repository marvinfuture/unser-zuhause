import { createHash, ECDH, randomUUID } from "node:crypto";
import * as webpush from "web-push";
import { z } from "zod";
import type { ProfileId } from "../shared/types.js";
import { HttpError, readBody, type AppContext } from "./app.js";
import type { Store } from "./db.js";
import { dueCalendarReminders } from "./calendar.js";

const minute = 60_000;
const day = 24 * 60 * minute;
const devicePrefix = "push:device:";
type Message = { title: string; body: string; key: string; kind: string };
type Device = {
  generation: string;
  profile: ProfileId;
  subscription: webpush.PushSubscription;
  receipts: Record<string, number>;
  testAt: number;
  lastFailure: string | null;
};
type Delivery = (
  subscription: webpush.PushSubscription,
  message: Message,
  options: webpush.RequestOptions,
) => Promise<unknown>;

/** Beschränkt ausgehende Verbindungen auf HTTPS-Adressen verbreiteter Browser-Pushdienste. */
function providerEndpoint(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname;
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.length > 1 &&
      (host.endsWith(".push.apple.com") ||
        host === "fcm.googleapis.com" ||
        host.endsWith(".push.services.mozilla.com") ||
        host.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}

/** Prüft die beiden binären Web-Push-Schlüssel einschließlich des tatsächlichen P-256-Kurvenpunkts. */
function browserKeys(keys: { p256dh: string; auth: string }): boolean {
  const publicKey = Buffer.from(keys.p256dh, "base64url");
  if (
    publicKey.length !== 65 ||
    publicKey[0] !== 4 ||
    Buffer.from(keys.auth, "base64url").length !== 16
  )
    return false;
  try {
    ECDH.convertKey(publicKey, "prime256v1");
    return true;
  } catch {
    return false;
  }
}

const endpoint = z
  .string()
  .max(4096)
  .refine(providerEndpoint, "Dieser Browser-Pushdienst wird nicht unterstützt.");
const token = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w-]+$/);
const subscriptionSchema = z
  .object({
    endpoint,
    keys: z
      .object({ p256dh: token, auth: token })
      .strict()
      .refine(browserKeys, "Die Geräteschlüssel sind ungültig. Bitte erneut aktivieren."),
    expirationTime: z.number().nullable().optional(),
  })
  .strict();
const control = z.object({ profileVersion: z.number().int().nonnegative() });
const deviceControl = control.extend({ endpoint }).strict();
const email = z.string().trim().max(250).email("Bitte eine gültige Kontakt-E-Mail eingeben.");

/** Liefert einen stabilen, kurzen Hash für lokale Geräteschlüssel und Zustellkennungen. */
function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Erzeugt das private VAPID-Schlüsselpaar einmalig im lokalen Datenordner. */
function vapid(db: Store): webpush.VapidKeys {
  const existing = db.getSetting<webpush.VapidKeys>("push:vapid");
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  db.setSetting("push:vapid", keys);
  return keys;
}

/** Liest den für den Zustelldienst bestimmten Kontakt aus der Betriebskonfiguration oder der Ersteinrichtung. */
function subject(db: Store): string | undefined {
  const configured = process.env.UZ_PUSH_SUBJECT;
  if (configured?.startsWith("mailto:") && email.safeParse(configured.slice(7)).success)
    return configured;
  return db.getSetting<string>("push:subject");
}

/** Überträgt ausschließlich die von web-push für dieses Gerät verschlüsselten Nachrichtendaten. */
const sendEncrypted: Delivery = (subscription, message, options) =>
  webpush.sendNotification(subscription, JSON.stringify(message), options);

/** Führt eine begrenzte Anfrage aus; derselbe Kalendereintrag ersetzt eine bereits wartende Anbieter-Nachricht. */
function deliver(db: Store, send: Delivery, device: Device, message: Message) {
  const contact = subject(db);
  if (!contact)
    throw new HttpError(409, "Für Handy-Erinnerungen fehlt die Kontakt-E-Mail des Haushalts.");
  return send(device.subscription, message, {
    vapidDetails: { subject: contact, ...vapid(db) },
    TTL: 86400,
    timeout: 8000,
    urgency: "normal",
    topic: digest(message.key).slice(0, 32),
    contentEncoding: "aes128gcm",
  });
}

/** Entfernt ein abgemeldetes oder vom Anbieter abgelaufenes Gerät samt seiner Zustellquittungen. */
function forget(db: Store, key: string): void {
  db.raw.prepare("DELETE FROM settings WHERE key=?").run(key);
}

/** Bestimmt anhand des HTTP-Status, ob die alte Anmeldung beim Zustelldienst dauerhaft ungültig ist. */
function expired(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

/** Registriert Geräteeinrichtung, Status, Abmeldung und den freiwilligen Zustelltest für den gewählten Haushalt. */
export function registerPush(ctx: AppContext, send: Delivery = sendEncrypted): void {
  const { app, db, requireSession, requireWrite, getActor, assertProfile } = ctx;
  app.get("/api/push/setup", requireSession, (req, res) => {
    getActor(req);
    res.json({ publicKey: vapid(db).publicKey, needsContact: !subject(db) });
  });
  app.post("/api/push/status", requireWrite, (req, res) => {
    const body = readBody(deviceControl, req.body);
    assertProfile(req, body.profileVersion);
    const device = db.getSetting<Device>(devicePrefix + digest(body.endpoint));
    res.json({ profile: device?.profile ?? null, lastFailure: device?.lastFailure ?? null });
  });
  app.post("/api/push/subscribe", requireWrite, (req, res) => {
    const body = readBody(
      control.extend({ subscription: subscriptionSchema, contactEmail: email.optional() }).strict(),
      req.body,
    );
    const profile = assertProfile(req, body.profileVersion);
    const key = devicePrefix + digest(body.subscription.endpoint);
    db.transaction(() => {
      if (!subject(db)) {
        if (!body.contactEmail)
          throw new HttpError(
            400,
            "Bitte gebt einmalig eine Kontakt-E-Mail für den Push-Dienst an.",
          );
        db.setSetting("push:subject", "mailto:" + body.contactEmail);
      }
      vapid(db);
      const existing = db.getSetting<Device>(key);
      if (
        existing?.profile === profile &&
        existing.subscription.keys.auth === body.subscription.keys.auth &&
        existing.subscription.keys.p256dh === body.subscription.keys.p256dh
      )
        return;
      db.setSetting(key, {
        generation: randomUUID(),
        profile,
        subscription: { endpoint: body.subscription.endpoint, keys: body.subscription.keys },
        receipts: {},
        testAt: 0,
        lastFailure: null,
      } satisfies Device);
    });
    res.json({ profile });
  });
  app.post("/api/push/unsubscribe", requireWrite, (req, res) => {
    const body = readBody(deviceControl, req.body);
    assertProfile(req, body.profileVersion);
    forget(db, devicePrefix + digest(body.endpoint));
    res.json({ removed: true });
  });
  app.post("/api/push/test", requireWrite, async (req, res) => {
    const body = readBody(deviceControl, req.body);
    const profile = assertProfile(req, body.profileVersion);
    const key = devicePrefix + digest(body.endpoint);
    const device = db.getSetting<Device>(key);
    if (device?.profile !== profile)
      throw new HttpError(409, "Aktiviert die Handy-Erinnerungen zuerst für dieses Profil.");
    if (Date.now() - device.testAt < minute)
      throw new HttpError(429, "Eine weitere Testnachricht ist in einer Minute möglich.");
    db.setSetting(key, { ...device, testAt: Date.now() });
    try {
      await deliver(db, send, device, {
        title: "Unser Zuhause",
        body: "Die Handy-Erinnerungen sind auf diesem Gerät eingerichtet.",
        kind: "event",
        key: "test",
      });
    } catch (error) {
      if (expired(error) && db.getSetting<Device>(key)?.generation === device.generation)
        forget(db, key);
      throw new HttpError(
        502,
        expired(error)
          ? "Diese Browser-Anmeldung ist abgelaufen. Bitte erneut aktivieren."
          : "Der Push-Dienst konnte die Testnachricht nicht annehmen. Prüft Internetzugang und Push-Einrichtung.",
      );
    }
    res.json({ accepted: true });
  });
}

/** Sichert pro Gerät und Serientermin eine Zustellung gegen parallele Ticks und merkt Annahmen über Neustarts. */
export async function dispatchPush(
  db: Store,
  now = new Date(),
  send: Delivery = sendEncrypted,
): Promise<void> {
  const devices = db.raw
    .prepare("SELECT key FROM settings WHERE key LIKE 'push:device:%'")
    .all() as { key: string }[];
  if (!devices.length || !subject(db)) return;
  const time = now.getTime();
  const messages = dueCalendarReminders(db, now);
  for (const { key } of devices) {
    for (const message of messages) {
      const receiptKeys = [message.key];
      if (message.previousDateKey) receiptKeys.push(message.previousDateKey);
      const receipts = receiptKeys.map((occurrence) => digest(occurrence + ":" + message.dueAt));
      const device = db.transaction(() => {
        // Während der vorigen Zustellung kann die Serie verschoben oder dieser Termin abgehakt worden sein.
        if (
          db.get("calendar", message.seriesId)?.version !== message.seriesVersion ||
          (db.get("calendarOverrides", message.key)?.version ?? 0) !== message.occurrenceVersion
        )
          return;
        const current = db.getSetting<Device>(key);
        if (
          !current ||
          (message.profileIds.length && !message.profileIds.includes(current.profile))
        )
          return;
        if (receipts.some((receipt) => current.receipts[receipt] > time)) return;
        for (const [id, until] of Object.entries(current.receipts))
          if (until <= time) delete current.receipts[id];
        for (const receipt of receipts) current.receipts[receipt] = time + 10 * minute;
        db.setSetting(key, current);
        return current;
      });
      if (!device) continue;
      let error: unknown;
      try {
        await deliver(db, send, device, {
          title: message.title,
          body: message.body,
          key: message.key,
          kind: message.kind,
        });
      } catch (failure) {
        error = failure;
      }
      // Eine Abmeldung oder erneute Anmeldung während des Netzwerkaufrufs behält Vorrang.
      const current = db.getSetting<Device>(key);
      if (current?.generation !== device.generation) continue;
      if (expired(error)) {
        forget(db, key);
        break;
      }
      for (const receipt of receipts)
        current.receipts[receipt] = time + (error ? 10 * minute : 3 * day);
      current.lastFailure = error ? now.toISOString() : null;
      db.setSetting(key, current);
    }
  }
}

/** Prüft beim Start und jede Minute offene Erinnerungen und gibt dem Server eine abwartbare Stoppfunktion zurück. */
export function startPushScheduler(db: Store): () => Promise<void> {
  let running: Promise<void> | null = null;
  /** Verhindert einen zweiten Durchlauf während eines laufenden Versands; Fehlermeldungen enthalten keine Gerätedaten. */
  function tick() {
    if (running) return;
    running = dispatchPush(db)
      .catch(() => console.warn("Handy-Erinnerungen konnten gerade nicht verarbeitet werden."))
      .finally(() => {
        running = null;
      });
  }
  const timer = setInterval(tick, minute);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
