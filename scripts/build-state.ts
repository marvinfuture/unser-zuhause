import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const markerName = ".build-state.json";
const sourceDirectories = ["src", "shared", "public"];
const sourceFiles = [
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "scripts/build-state.ts",
];

interface BuildMarker {
  version: 1;
  sourceHash: string;
  files: { path: string; sha256: string }[];
}

/** Liest Dateien unter einem festen Stamm; symbolische Verknüpfungen dürfen den Build-Abgleich nicht aus dem Projekt führen. */
export function filesBelow(root: string, directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  if (lstatSync(absolute).isSymbolicLink())
    throw new Error("Verknüpfte Build-Ordner werden nicht unterstützt.");
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Verknüpfte Build-Dateien werden nicht unterstützt.");
    return entry.isDirectory()
      ? filesBelow(root, path)
      : entry.isFile()
        ? [path.replaceAll("\\", "/")]
        : [];
  });
}

/** Berechnet einen SHA-256-Wert aus dem Dateiinhalt; Zeitstempel beeinflussen die Aktualitätsprüfung nicht. */
function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Bindet alle Frontendquellen, öffentlichen Dateien und Buildkonfigurationen über relative Pfade und Inhalte an einen Stand. */
export function sourceFingerprint(root: string): string {
  const paths = [
    ...sourceFiles,
    ...readdirSync(root).filter((name) =>
      /^tsconfig(?:\..+)?\.json$/.test(name),
    ),
    ...sourceDirectories.flatMap((directory) => filesBelow(root, directory)),
  ].sort();
  const entries = paths.map((path) => {
    const absolute = join(root, path);
    if (lstatSync(absolute).isSymbolicLink())
      throw new Error("Verknüpfte Build-Dateien werden nicht unterstützt.");
    return { path, sha256: fileHash(absolute) };
  });
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

/** Erfasst alle tatsächlich gebauten Dateien außer dem Marker; der Marker enthält ausschließlich relative Pfade und Prüfsummen. */
function outputFiles(root: string): BuildMarker["files"] {
  const dist = join(root, "dist");
  return filesBelow(dist, "")
    .filter((path) => path !== markerName)
    .sort()
    .map((path) => ({
      path,
      sha256: fileHash(join(dist, path)),
    }));
}

/** Schreibt nach erfolgreicher Vite-Ausgabe einen Marker und verweigert während des Builds veränderte Quellen. */
export function writeBuildMarker(
  root: string,
  expectedSourceHash: string,
): void {
  if (sourceFingerprint(root) !== expectedSourceHash)
    throw new Error(
      "Die Quellen wurden während des Builds geändert. Bitte erneut bauen.",
    );
  const files = outputFiles(root);
  if (
    !files.some((entry) => entry.path === "index.html") ||
    !files.some((entry) => entry.path.startsWith("assets/"))
  )
    throw new Error("Der Build enthält keine vollständige Oberfläche.");
  const marker: BuildMarker = {
    version: 1,
    sourceHash: expectedSourceHash,
    files,
  };
  writeFileSync(
    join(root, "dist", markerName),
    JSON.stringify(marker, null, 2) + "\n",
    "utf8",
  );
}

/** Prüft Quellstand und sämtliche gebauten Dateien; fehlende, beschädigte oder unmarkierte Ausgaben gelten als veraltet. */
export function checkBuild(root: string): { current: boolean; reason: string } {
  try {
    const marker = JSON.parse(
      readFileSync(join(root, "dist", markerName), "utf8"),
    ) as BuildMarker;
    if (marker.version !== 1 || marker.sourceHash !== sourceFingerprint(root))
      return {
        current: false,
        reason: "Die Oberfläche gehört zu einem anderen Quellstand.",
      };
    const files = outputFiles(root);
    if (
      !files.some((entry) => entry.path === "index.html") ||
      !files.some((entry) => entry.path.startsWith("assets/")) ||
      JSON.stringify(marker.files) !== JSON.stringify(files)
    )
      return {
        current: false,
        reason: "Gebauter Inhalt fehlt oder wurde verändert.",
      };
    return {
      current: true,
      reason: "Die Oberfläche ist aktuell und vollständig.",
    };
  } catch {
    return {
      current: false,
      reason: "Ein gültiger Buildnachweis oder benötigte Dateien fehlen.",
    };
  }
}

/** Baut nur bei Bedarf mit vorhandenen lokalen Werkzeugen; installiert nichts und greift nicht auf Haushaltsdaten zu. */
export function ensureBuild(root: string, force = false): boolean {
  if (!force && checkBuild(root).current) return false;
  const commands = [
    [join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"],
    [join(root, "node_modules", "vite", "bin", "vite.js"), "build"],
  ];
  for (const args of commands) {
    if (!existsSync(args[0]))
      throw new Error(
        "Lokale Build-Werkzeuge fehlen. Bitte zuerst scripts\\Install.ps1 ausführen.",
      );
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    // Warnungen erfolgreicher Werkzeuge sind normale Buildausgabe, keine PowerShell-Fehler.
    if (result.stderr) process.stdout.write(result.stderr);
    if (result.error || result.status !== 0)
      throw new Error(
        "Der lokale Build ist fehlgeschlagen. Die App wird nicht mit einer veralteten Oberfläche gestartet.",
      );
  }
  const result = checkBuild(root);
  if (!result.current)
    throw new Error(
      `Der Build ist nicht vollständig bestätigt: ${result.reason}`,
    );
  return true;
}

// Direkte Aufrufe sind an diesen Projektordner gebunden; Tests übergeben ihren eigenen isolierten Stamm an die Funktionen.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const command = process.argv[2];
    if (command === "check") {
      const result = checkBuild(root);
      console.log(result.reason);
      process.exitCode = result.current ? 0 : 1;
    } else if (command === "ensure" || command === "build") {
      console.log(
        ensureBuild(root, command === "build")
          ? "Aktuelle Oberfläche erfolgreich gebaut."
          : "Die Oberfläche ist bereits aktuell.",
      );
    } else {
      throw new Error("Erwarteter Buildbefehl: check, ensure oder build.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
