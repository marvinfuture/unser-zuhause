const CACHE_PREFIX = "zuhause-shell-";
const CACHE = `${CACHE_PREFIX}v2`;
/** Installiert ausschließlich die unpersönliche Offline-Seite und das App-Symbol; Hausdaten und Fotos werden nicht vorab gespeichert. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/offline.html", "/icon.svg"])),
  );
  self.skipWaiting();
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
