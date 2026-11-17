const CACHE = "zuhause-shell-v1";
/** Installiert ausschließlich die unpersönliche Offline-Seite und das App-Symbol; Hausdaten und Fotos werden nicht vorab gespeichert. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/offline.html", "/icon.svg"])),
  );
  self.skipWaiting();
});
/** Entfernt ältere App-Caches und übernimmt anschließend die offenen Fenster für diese Service-Worker-Version. */
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
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
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html")),
    );
});
