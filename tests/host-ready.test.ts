import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkHost } from "../scripts/host-ready.ts";
import { runtimeVersion } from "../scripts/runtime-state.ts";
import { createApp } from "../server/app.js";

/** Stellt einen ausschließlich lokalen HTTP-Testdienst auf einem freien Port bereit. */
async function listen(t: TestContext, handler: RequestListener) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  return { port: address.port, origin: "http://127.0.0.1:" + address.port };
}

test("Start bestätigt App, Version und echte Browser-Startseite und legt keine Sitzung an", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "zuhause-ready-"));
  const dist = join(root, "dist");
  mkdirSync(dist);
  writeFileSync(
    join(dist, "index.html"),
    '<div id="root"></div><script src="/assets/app.js"></script>',
  );
  const app = createApp({ dataDir: root, distDir: dist, runtimeVersion: "testversion" });
  t.after(() => {
    app.db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const own = await listen(t, app.app);
  const config = { ...own, dataDir: root };
  assert.equal((await checkHost(config, "testversion")).code, 0);
  assert.equal((await checkHost(config, "alter-Stand")).code, 1);
  const ready = await fetch(own.origin + "/api/ready");
  assert.equal(ready.headers.get("set-cookie"), null);
  assert.equal(ready.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ready.json(), {
    application: "unser-zuhause",
    version: "testversion",
  });
  const other = await listen(t, (req, res) => {
    res.end(
      req.url === "/api/ready"
        ? JSON.stringify({ application: "unser-zuhause", version: "testversion" })
        : "Wir sind gleich wieder da.",
    );
  });
  const proxy = await checkHost({ ...config, origin: other.origin }, "testversion");
  assert.equal(proxy.code, 2);
  assert.match(proxy.message, /Startseite fehlt/);
});

test("Laufende und nach git pull geänderte Serverdateien werden bei gleicher Oberfläche unterschieden", () => {
  const root = mkdtempSync(join(tmpdir(), "zuhause-versions-"));
  try {
    for (const dir of ["server", "scripts", "src", "shared", "public"])
      mkdirSync(join(root, dir));
    for (const path of [
      "index.html",
      "package.json",
      "package-lock.json",
      "vite.config.ts",
      "scripts/build-state.ts",
      "server/index.ts",
    ])
      writeFileSync(join(root, path), "test");
    const previous = runtimeVersion(root);
    writeFileSync(join(root, "server/index.ts"), "geändert");
    assert.notEqual(runtimeVersion(root), previous);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
