import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { createApp } from "../server/app.js";

/** Startet ausschließlich eine temporäre Testinstallation mit kleinen künstlichen Build-Dateien und entfernt sie nach dem Test. */
async function deliveryFixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "uz-delivery-"));
  const dist = join(dir, ".checkout", "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await Promise.all([
    writeFile(
      join(dist, "index.html"),
      "<!doctype html><title>Aktueller Einstieg</title>",
    ),
    writeFile(
      join(dist, "offline.html"),
      "<!doctype html><title>Offline</title>",
    ),
    writeFile(
      join(dist, "assets", "app-test123.js"),
      "export const current = true;",
    ),
    writeFile(join(dist, "sw.js"), "// synthetic worker"),
    writeFile(
      join(dist, "manifest.webmanifest"),
      JSON.stringify({ name: "Test" }),
    ),
  ]);
  const ctx = createApp({ dataDir: join(dir, "data"), distDir: dist });
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${address.port}`;
}

test("HTML entry points cannot be stored while hashed assets remain cacheable", async (t) => {
  const base = await deliveryFixture(t);
  for (const path of [
    "/",
    "/index.html",
    "/projects/example",
    "/offline.html",
    "/index.html?reload=1",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
    assert.equal(response.headers.get("pragma"), "no-cache", path);
    assert.equal(response.headers.get("expires"), "0", path);
    assert.match(await response.text(), /<!doctype html>/);
  }
  const head = await fetch(base + "/index.html", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("cache-control"), "no-store");
  assert.equal(await head.text(), "");
  const asset = await fetch(base + "/assets/app-test123.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control") ?? "", /max-age=3600/);
  assert.equal(await asset.text(), "export const current = true;");
  for (const path of ["/sw.js", "/manifest.webmanifest"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
  }
});

test("missing build assets return a real 404 instead of the SPA HTML", async (t) => {
  const base = await deliveryFixture(t);
  for (const path of [
    "/assets/old-build.js",
    "/assets/old-build.css",
    "/assets/missing/icon.svg",
  ]) {
    const response = await fetch(base + path, {
      headers: { Accept: "text/html,*/*" },
    });
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
    );
    assert.equal((await response.json()).code, "ASSET_NOT_FOUND");
  }
  const api = await fetch(base + "/api/missing");
  assert.equal(api.status, 404);
  assert.equal((await api.json()).code, "NOT_FOUND");
});

type WorkerRequest = { url: string; method: string; mode: string };

/** Führt die unveränderte Service-Worker-Datei in einer VM aus; nur Browsertransport und Cache-Speicher werden durch beobachtbare Testobjekte ersetzt. */
async function workerFixture() {
  const handlers = new Map<string, (event: any) => void>();
  const fetched: { request: WorkerRequest; options?: RequestInit }[] = [];
  const opened: string[] = [];
  const deleted: string[] = [];
  const precached: string[][] = [];
  const matched: { cache: string; path: string }[] = [];
  let offline = false;
  let skipped = false;
  let claimed = false;
  const source = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );
  runInNewContext(source, {
    URL,
    self: {
      location: { origin: "https://zuhause.example" },
      /** Merkt die echten Ereignisbehandler des geladenen Workers für gezielte Ereignisse. */
      addEventListener(type: string, handler: (event: any) => void) {
        handlers.set(type, handler);
      },
      /** Bestätigt, dass die neue Worker-Version ohne erneuten Browserstart aktiviert werden kann. */
      skipWaiting() {
        skipped = true;
        return Promise.resolve();
      },
      clients: {
        /** Vermerkt die Übernahme bereits geöffneter App-Fenster. */
        claim() {
          claimed = true;
          return Promise.resolve();
        },
      },
    },
    caches: {
      /** Simuliert zusätzlich einen fremden Cache, den diese App niemals löschen darf. */
      keys: async () => [
        "zuhause-shell-v1",
        "zuhause-shell-v2",
        "other-app-v1",
      ],
      /** Protokolliert ausschließlich die vom echten Worker angeforderten Löschungen. */
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
      /** Öffnet einen benannten Cache und beobachtet Vorabladen sowie die neutrale Offline-Antwort. */
      open: async (cache: string) => {
        opened.push(cache);
        return {
          /** Hält fest, welche Ressourcen der Worker ausdrücklich offline speichern möchte. */
          addAll: async (paths: string[]) => {
            precached.push(Array.from(paths));
          },
          /** Liefert nur den künstlichen Offline-Text und merkt den dafür verwendeten App-Cache. */
          match: async (path: string) => {
            matched.push({ cache, path });
            return new Response("Neutrale Offline-Seite");
          },
        };
      },
    },
    /** Simuliert erfolgreiche Navigation oder Netzverlust, ohne irgendeine tatsächliche Adresse aufzurufen. */
    fetch: async (request: WorkerRequest, options?: RequestInit) => {
      fetched.push({ request, options });
      if (offline) throw new Error("Synthetic offline failure");
      return new Response("Aktuelle Netzwerkseite");
    },
  });
  /** Löst Installations- oder Aktivierungsereignisse aus und wartet auf deren reale waitUntil-Arbeit. */
  async function lifecycle(type: string) {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)!({
      /** Sammelt die vom Worker registrierten Hintergrundarbeiten dieses Ereignisses. */
      waitUntil(work: Promise<unknown>) {
        pending.push(work);
      },
    });
    await Promise.all(pending);
  }
  /** Reicht ein Fetch-Ereignis an den echten Worker weiter; undefined bedeutet unveränderte Browserbehandlung. */
  function dispatch(request: WorkerRequest): Promise<Response> | undefined {
    let result: Promise<Response> | undefined;
    handlers.get("fetch")!({
      request,
      /** Übernimmt die tatsächliche Antwort-Promise des Workers, ohne seine Entscheidungslogik nachzubauen. */
      respondWith(response: Promise<Response>) {
        result = response;
      },
    });
    return result;
  }
  return {
    lifecycle,
    dispatch,
    fetched,
    opened,
    deleted,
    precached,
    matched,
    /** Schaltet ausschließlich den simulierten Netzwerktransport auf Ausfall um. */
    goOffline() {
      offline = true;
    },
    /** Liefert den beobachteten Worker-Lebenszyklus für die Testprüfung. */
    lifecycleState() {
      return { skipped, claimed };
    },
  };
}

test("service worker caches only neutral files and cleans up only its own old cache", async () => {
  const worker = await workerFixture();
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.deepEqual(worker.precached, [["/offline.html", "/icon.svg"]]);
  assert.deepEqual(worker.opened, ["zuhause-shell-v2"]);
  assert.deepEqual(worker.deleted, ["zuhause-shell-v1"]);
  assert.deepEqual(worker.lifecycleState(), { skipped: true, claimed: true });
});

test("service worker navigation bypasses the HTTP cache and uses only its neutral offline fallback", async () => {
  const worker = await workerFixture();
  const request = {
    url: "https://zuhause.example/projects/room",
    method: "GET",
    mode: "navigate",
  };
  assert.equal(
    await (await worker.dispatch(request))!.text(),
    "Aktuelle Netzwerkseite",
  );
  assert.equal(worker.fetched[0].request, request);
  assert.equal(worker.fetched[0].options?.cache, "no-store");
  assert.deepEqual(worker.matched, []);
  worker.goOffline();
  assert.equal(
    await (await worker.dispatch(request))!.text(),
    "Neutrale Offline-Seite",
  );
  assert.deepEqual(worker.matched, [
    { cache: "zuhause-shell-v2", path: "/offline.html" },
  ]);
});

test("service worker leaves API, media, writes, bundles and other origins untouched", async () => {
  const worker = await workerFixture();
  for (const request of [
    { url: "https://zuhause.example/api", method: "GET", mode: "navigate" },
    {
      url: "https://zuhause.example/api/session",
      method: "GET",
      mode: "navigate",
    },
    {
      url: "https://zuhause.example/api/photos/example/file",
      method: "GET",
      mode: "cors",
    },
    { url: "https://zuhause.example/api/tasks", method: "POST", mode: "cors" },
    {
      url: "https://zuhause.example/assets/app-test123.js",
      method: "GET",
      mode: "cors",
    },
    { url: "https://other.example/", method: "GET", mode: "navigate" },
  ])
    assert.equal(worker.dispatch(request), undefined, request.url);
  assert.equal(worker.fetched.length, 0);
  assert.equal(worker.opened.length, 0);
});
