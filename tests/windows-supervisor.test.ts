import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";

/** Belegt einen zufälligen Loopback-Port und hält ihn bei Bedarf als fremder Prozess offen. */
async function listener() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    port: address.port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Wartet begrenzt auf eine fachliche Testbedingung, auch wenn eine Statusdatei noch fehlt. */
async function until<T>(get: () => Promise<T | undefined>, message: string): Promise<T> {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const value = await get();
    if (value !== undefined) return value;
    await delay(100);
  }
  throw Error(message);
}

/** Startet die echte Windows-Überwachung mit getrennten Verzeichnissen, Testport und kontrollierten Hilfsprogrammen. */
async function fixture(
  t: TestContext,
  options: {
    dependencyFailure?: boolean;
    proxyPort?: number;
    throughStart?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "uz-supervisor-"));
  const runtime = join(directory, ".runtime");
  const scripts = join(directory, "scripts");
  const backend = await listener();
  const port = backend.port;
  await backend.close();
  await Promise.all(
    [
      runtime,
      scripts,
      join(directory, "server"),
      join(directory, "node_modules", "tsx"),
    ].map((folder) => mkdir(folder, { recursive: true })),
  );
  await Promise.all(
    ["Common.ps1", "Run.ps1", "Start.ps1", "host-ready.ts"].map((name) =>
      copyFile(resolve("scripts", name), join(scripts, name)),
    ),
  );
  const version = "a".repeat(64);
  await writeFile(join(scripts, "runtime-state.ts"), `console.log('${version}');`);
  // Der erste Helfer hält die Vorbereitung offen, bis der Test den frühen Marker gesehen hat.
  await writeFile(
    join(scripts, "dependencies.ts"),
    options.dependencyFailure
      ? "console.error('synthetischer Installationsfehler'); process.exitCode=12;"
      : "const fs=require('node:fs');const i=setInterval(()=>{if(fs.existsSync('release-install'))clearInterval(i)},50);",
  );
  await writeFile(join(scripts, "build-state.ts"), "console.log('Testbuild');");
  await writeFile(
    join(directory, "node_modules", "tsx", "package.json"),
    JSON.stringify({ name: "tsx", main: "index.cjs" }),
  );
  await writeFile(join(directory, "node_modules", "tsx", "index.cjs"), "");
  await writeFile(
    join(directory, "server", "index.ts"),
    `
    const http = require('node:http');
    http.createServer((req,res) => {
      if (req.url === '/api/ready') return res.end(JSON.stringify({ application:'unser-zuhause', version:'${version}' }));
      if (${!!options.throughStart} && req.url === '/') return res.end('<div id="root"></div><script src="/assets/app.js"></script>');
      res.end(String(process.pid));
      if(req.url === '/simulate-exit') setTimeout(() => process.exit(0), 20);
    }).listen(Number(process.env.PORT),'127.0.0.1');
  `,
  );
  if (options.proxyPort) {
    await mkdir(join(directory, ".tools", "caddy"), { recursive: true });
    // Der Portkonflikt muss bereits vor einem Start dieses Testprogramms erkannt werden.
    await writeFile(join(directory, ".tools", "caddy", "caddy.exe"), "");
    await writeFile(join(runtime, "Caddyfile"), "");
  }
  await writeFile(
    join(runtime, "config.json"),
    JSON.stringify({
      origin: options.proxyPort
        ? "https://localhost:" + options.proxyPort
        : "http://localhost:" + port,
      https: !!options.proxyPort,
      port,
      lanIp: "127.0.0.1",
      dataDir: join(directory, "data"),
      backupDir: "",
    }),
  );
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(scripts, options.throughStart ? "Start.ps1" : "Run.ps1"),
    ],
    {
      stdio: "ignore",
      windowsHide: true,
      cwd: directory,
      env: {
        ...process.env,
        PATH: dirname(process.execPath) + delimiter + (process.env.PATH || ""),
      },
    },
  );
  const exited = once(child, "exit").then(([code]) => code);
  t.after(async () => {
    await writeFile(join(runtime, "stop.request"), "stop");
    if (child.exitCode === null && child.signalCode === null)
      await Promise.race([exited, delay(8000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
    if (options.throughStart)
      await until(
        async () => ((await marker()) ? undefined : true),
        "Separater Supervisor blieb im Test aktiv.",
      );
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  /** Liest die komplett veröffentlichte Identität; nur die noch nicht angelegte Datei ist zulässig. */
  async function marker(): Promise<
    { pid: number; version: string; prepared: boolean; started: boolean } | undefined
  > {
    try {
      return JSON.parse(await readFile(join(runtime, "supervisor.json"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  return { child, exited, directory, runtime, port, marker };
}

test(
  "Windows-Supervisor unterscheidet Vorbereitung und Listener, startet sein Backend neu und stoppt auf Wunsch",
  { skip: process.platform !== "win32", timeout: 65_000 },
  async (t) => {
    const f = await fixture(t);
    const pending = await until(f.marker, "Früher Startmarker fehlt.");
    assert.equal(pending.pid, f.child.pid);
    assert.equal(pending.version, "a".repeat(64));
    assert.equal(pending.prepared, false);
    assert.equal(pending.started, false);
    await writeFile(join(f.directory, "release-install"), "ok");
    const ready = await until(async () => {
      const m = await f.marker();
      return m?.started ? m : undefined;
    }, "Das eigene Backend wurde nicht bereit.");
    assert.equal(ready.prepared, true);
    const url = "http://127.0.0.1:" + f.port;
    const oldPid = await (await fetch(url + "/simulate-exit")).text();
    const replacement = await until(async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) }).catch(
        () => undefined,
      );
      if (response?.ok) {
        const pid = await response.text();
        if (pid !== oldPid) return pid;
      }
    }, "Backend wurde nicht neu gestartet.");
    assert.match(replacement, /^\d+$/);
    await writeFile(join(f.runtime, "stop.request"), "stop");
    assert.equal(await f.exited, 0);
    assert.equal(await f.marker(), undefined);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1500) }));
  },
);

test(
  "Windows-Supervisor protokolliert fehlgeschlagene Pakete und meldet keine Betriebsbereitschaft",
  { skip: process.platform !== "win32", timeout: 30_000 },
  async (t) => {
    const f = await fixture(t, { dependencyFailure: true, throughStart: true });
    assert.notEqual(await f.exited, 0);
    assert.match(
      await readFile(join(f.runtime, "logs", "supervisor.err.log"), "utf8"),
      /install\.err\.log/,
    );
    assert.match(
      await readFile(join(f.runtime, "logs", "install.err.log"), "utf8"),
      /synthetischer Installationsfehler/,
    );
    assert.equal(await f.marker(), undefined);
  },
);

test(
  "Start.ps1 ohne Browser wartet auf die Vorbereitung und die aktuelle HTTP-Startseite",
  { skip: process.platform !== "win32", timeout: 55_000 },
  async (t) => {
    const f = await fixture(t, { throughStart: true });
    await until(f.marker, "Der versteckte Dienst wurde nicht gestartet.");
    assert.equal(f.child.exitCode, null);
    await writeFile(join(f.directory, "release-install"), "ok");
    assert.equal(await f.exited, 0);
    assert.equal((await f.marker())?.started, true);
    const res = await fetch("http://127.0.0.1:" + f.port + "/api/ready");
    assert.deepEqual(await res.json(), {
      application: "unser-zuhause",
      version: "a".repeat(64),
    });
  },
);

test(
  "Windows-Supervisor lässt einen fremden HTTPS-Listener auf dem konfigurierten Sonderport unangetastet",
  { skip: process.platform !== "win32", timeout: 30_000 },
  async (t) => {
    const foreign = await listener();
    t.after(foreign.close);
    const f = await fixture(t, { proxyPort: foreign.port });
    assert.notEqual(await f.exited, 0);
    const log = await readFile(join(f.runtime, "logs", "supervisor.err.log"), "utf8");
    assert.ok(log.includes("HTTPS-Port " + foreign.port + " ist bereits belegt"));
    assert.equal(await f.marker(), undefined);
  },
);
