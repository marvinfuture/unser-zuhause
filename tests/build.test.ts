import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  existsSync,
  statSync,
  utimesSync,
} from "node:fs";
import { dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkBuild,
  ensureBuild,
  sourceFingerprint,
  writeBuildMarker,
} from "../scripts/build-state.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const qaRoot = join(projectRoot, ".qa");

/** Erstellt eine kleine Buildumgebung ohne Haushaltsdaten; Vite und der echte Marker-Hook stammen aus dem vorhandenen Projekt. */
function fixture() {
  mkdirSync(qaRoot, { recursive: true });
  const root = mkdtempSync(join(qaRoot, "build-regression-"));
  for (const path of [
    "src",
    "shared",
    "public",
    "scripts",
    "dist/assets",
    "node_modules/typescript/bin",
    "node_modules/vite/bin",
  ])
    mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  writeFileSync(join(root, "package-lock.json"), "{}");
  writeFileSync(join(root, "tsconfig.json"), "{}");
  writeFileSync(
    join(root, "index.html"),
    '<html><body><script type="module" src="/src/main.ts"></script></body></html>',
  );
  writeFileSync(
    join(root, "src/main.ts"),
    'document.body.dataset.build = "fixture";',
  );
  writeFileSync(
    join(root, "public/icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  copyFileSync(
    join(projectRoot, "scripts/build-state.ts"),
    join(root, "scripts/build-state.ts"),
  );
  copyFileSync(
    join(projectRoot, "vite.config.ts"),
    join(root, "vite.config.ts"),
  );
  // Der kleine Typecheck-Ersatz zählt nur Aufrufe; der reale Projekt-Typecheck wird getrennt ausgeführt.
  writeFileSync(
    join(root, "node_modules/typescript/bin/tsc"),
    'require("node:fs").appendFileSync("tsc-runs.txt", "run\\n");',
  );
  writeFileSync(
    join(root, "node_modules/vite/bin/vite.js"),
    `import(${JSON.stringify(pathToFileURL(join(projectRoot, "node_modules/vite/bin/vite.js")).href)});`,
  );
  return {
    root,
    /** Hinterlegt eine vollständige markierte Ausgabe für reine Aktualitätsprüfungen. */
    mark() {
      writeFileSync(
        join(root, "dist/index.html"),
        '<script src="/assets/app.js"></script>',
      );
      writeFileSync(
        join(root, "dist/assets/app.js"),
        'console.log("fixture");',
      );
      writeBuildMarker(root, sourceFingerprint(root));
    },
    /** Entfernt ausschließlich den zuvor erzeugten und auf den QA-Stamm geprüften Testordner. */
    cleanup() {
      const path = relative(qaRoot, root);
      assert(
        path.startsWith("build-regression-") &&
          !isAbsolute(path) &&
          !path.includes(sep),
      );
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("build marker detects missing, changed and damaged input/output by content", () => {
  const f = fixture();
  try {
    assert.equal(checkBuild(f.root).current, false);
    f.mark();
    assert.equal(checkBuild(f.root).current, true);
    const marker = readFileSync(join(f.root, "dist/.build-state.json"), "utf8");
    assert(!marker.includes(f.root) && !marker.includes(projectRoot));

    const source = join(f.root, "src/main.ts");
    const original = readFileSync(source);
    const timestamps = statSync(source);
    writeFileSync(source, 'document.body.dataset.build = "changed";');
    utimesSync(source, timestamps.atime, timestamps.mtime);
    assert.equal(
      checkBuild(f.root).current,
      false,
      "same timestamps cannot hide changed source",
    );
    writeFileSync(source, original);
    assert.equal(checkBuild(f.root).current, true);

    writeFileSync(join(f.root, "dist/assets/app.js"), "damaged");
    assert.equal(checkBuild(f.root).current, false);
    f.mark();
    rmSync(join(f.root, "dist/index.html"));
    assert.equal(checkBuild(f.root).current, false);
    f.mark();
    writeFileSync(join(f.root, "dist/.build-state.json"), "{");
    assert.equal(checkBuild(f.root).current, false);
  } finally {
    f.cleanup();
  }
});

test("local ensure builds with actual Vite marker only when required and is independent of cwd", () => {
  const f = fixture();
  try {
    assert.equal(ensureBuild(f.root), true);
    assert.equal(checkBuild(f.root).current, true);
    assert.equal(ensureBuild(f.root), false);
    assert.equal(readFileSync(join(f.root, "tsc-runs.txt"), "utf8"), "run\n");
    writeFileSync(
      join(f.root, "public/icon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><title>changed</title></svg>',
    );
    assert.equal(checkBuild(f.root).current, false);
    assert.equal(ensureBuild(f.root), true);
    assert.equal(
      readFileSync(join(f.root, "tsc-runs.txt"), "utf8"),
      "run\nrun\n",
    );
    assert.equal(checkBuild(f.root).current, true);
  } finally {
    f.cleanup();
  }
});

test("failed build and sources changing during output never receive a current marker", () => {
  const f = fixture();
  try {
    const before = sourceFingerprint(f.root);
    writeFileSync(join(f.root, "public/icon.svg"), "changed");
    assert.throws(() => writeBuildMarker(f.root, before), /während des Builds/);
    assert.equal(existsSync(join(f.root, "dist/.build-state.json")), false);
    writeFileSync(
      join(f.root, "node_modules/typescript/bin/tsc"),
      "process.exit(7);",
    );
    assert.throws(() => ensureBuild(f.root), /fehlgeschlagen/);
    assert.equal(checkBuild(f.root).current, false);
    assert.equal(existsSync(join(f.root, "dist/.build-state.json")), false);
  } finally {
    f.cleanup();
  }
});
