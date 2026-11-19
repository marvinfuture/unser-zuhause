import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bundledNpm } from "../scripts/dependencies.ts";

/** Führt die echte npm-CLI oder das Startwerkzeug nur mit lokalem Paketarchiv und isoliertem Offline-Cache aus. */
function run(cwd: string, cache: string, args: string[]) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      npm_config_cache: cache,
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

test("Paketprüfung erkennt ein Update, startet einen aktuellen Altbestand offline und repariert abgebrochene Installationen", () => {
  const base = resolve(tmpdir());
  const root = mkdtempSync(join(base, "uz-pakettest-"));
  const cache = join(root, "npm-cache"),
    source = join(root, "quelle"),
    helperDir = join(root, "scripts");
  const npm = bundledNpm();
  const helper = join(helperDir, "dependencies.ts");
  const manifest = join(root, "package.json");
  const lock = join(root, "package-lock.json");
  const pending = join(root, ".runtime", "dependencies.pending");
  const sentinel = join(root, "node_modules", "nur-im-alten-bestand");
  try {
    mkdirSync(source);
    mkdirSync(helperDir);
    copyFileSync(
      fileURLToPath(new URL("../scripts/dependencies.ts", import.meta.url)),
      helper,
    );
    /** Simuliert einen vollständigen neuen Checkout mit geändertem lokalem Testpaket und passender Lockdatei. */
    function revision(version: string) {
      writeFileSync(
        join(source, "package.json"),
        JSON.stringify({
          name: "zuhause-paketprobe",
          version,
          main: "index.js",
        }),
      );
      writeFileSync(
        join(source, "index.js"),
        `module.exports=${JSON.stringify(version)};`,
      );
      const pack = run(source, cache, [
        npm,
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        root,
      ]);
      assert.equal(pack.status, 0, pack.output);
      writeFileSync(
        manifest,
        JSON.stringify({
          name: "test-installation",
          version: "1.0.0",
          type: "module",
          devDependencies: {
            "zuhause-paketprobe": `file:zuhause-paketprobe-${version}.tgz`,
          },
        }),
      );
      const locked = run(root, cache, [
        npm,
        "install",
        "--package-lock-only",
        "--ignore-scripts",
      ]);
      assert.equal(locked.status, 0, locked.output);
    }
    /** Prüft das eigenständig ausführbare Werkzeug absichtlich von außerhalb des Checkout-Verzeichnisses. */
    function command(action: string, status: number) {
      const result = run(base, cache, [helper, action]);
      assert.equal(result.status, status, result.output);
    }
    revision("1.0.0");
    command("check", 1);
    // Simuliert eine ältere Installation, die ausschließlich durch npm ci eingerichtet wurde.
    const old = run(root, cache, [npm, "ci", "--include=dev"]);
    assert.equal(old.status, 0, old.output);
    writeFileSync(sentinel, "erhalten");
    command("check", 0);
    command("ensure", 0);
    assert.ok(
      existsSync(sentinel),
      "Kein erneutes npm ci bei aktuellen Paketen",
    );
    revision("2.0.0");
    command("check", 1);
    assert.ok(
      existsSync(sentinel),
      "Die lesende Prüfung darf einen laufenden Paketbestand nicht anfassen",
    );
    command("ensure", 0);
    command("check", 0);
    assert.equal(
      JSON.parse(
        readFileSync(
          join(root, "node_modules", "zuhause-paketprobe", "package.json"),
          "utf8",
        ),
      ).version,
      "2.0.0",
    );
    assert.ok(!existsSync(sentinel));
    rmSync(join(root, "node_modules", "zuhause-paketprobe", "index.js"));
    command("check", 1);
    command("ensure", 0);
    command("check", 0);
    const validManifest = readFileSync(manifest),
      validLock = readFileSync(lock);
    const invalid = JSON.parse(validManifest.toString());
    invalid.dependencies = { "fehlendes-testpaket": "file:fehlt.tgz" };
    writeFileSync(manifest, JSON.stringify(invalid));
    command("ensure", 1);
    assert.ok(existsSync(pending));
    writeFileSync(manifest, validManifest);
    writeFileSync(lock, validLock);
    command("check", 1);
    command("ensure", 0);
    command("check", 0);
    assert.ok(!existsSync(pending));
  } finally {
    assert.equal(dirname(resolve(root)), base);
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
