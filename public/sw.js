const CACHE_PREFIX = "zuhause-shell-";
const CACHE = `${CACHE_PREFIX}v2`;
/** Installiert ausschließlich die unpersönliche Offline-Seite und das App-Symbol; Hausdaten und Fotos werden nicht vorab gespeichert. */
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/offline.html", "/icon.svg"])));
  self.skipWaiting();
});

/** Zeigt eingehende, vom Browser entschlüsselte Erinnerungen auch bei geschlossener App als sichtbare Systemmeldung. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    // Jede vom Gerät empfangene Nachricht erhält auch bei einem Formatwechsel eine sichtbare Meldung.
  }
  const symbols = { waste: "🗑️", household: "🛒", event: "📅" };
  const symbol = symbols[data.kind] || "📅";
  const title = typeof data.title === "string" && data.title ? data.title : "Unser Zuhause";
  event.waitUntil(
    self.registration.showNotification(symbol + " " + title, {
      body:
        typeof data.body === "string" ? data.body : "Öffne den Kalender für deine Erinnerungen.",
      icon: "/icon-192.png",
      tag: typeof data.key === "string" ? "zuhause:" + data.key : undefined,
    }),
  );
});

/** Öffnet ausschließlich den lokalen Kalender, ohne Entwürfe in einer anderen geöffneten Ansicht zu verwerfen. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const calendar = new URL("/#/calendar", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const openCalendar = windows.find((client) => client.url === calendar);
      if (openCalendar) await openCalendar.focus();
      else await self.clients.openWindow(calendar);
    })(),
  );
});
/** Entfernt nur ältere Caches dieser App und übernimmt anschließend die offenen Fenster; andere Anwendungen am selben Ursprung bleiben unberührt. */
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
/** Lässt API, fremde Adressen und Schreibzugriffe unverändert passieren. Nur fehlgeschlagene Seitennavigationen erhalten die neutrale Offline-Seite. */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    event.request.method !== "GET" ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        caches.open(CACHE).then((cache) => cache.match("/offline.html")),
      ),
    );
});
