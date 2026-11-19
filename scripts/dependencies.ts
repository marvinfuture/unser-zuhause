import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackageInfo {
  version?: string;
  integrity?: string;
  resolved?: string;
  optional?: boolean;
  os?: string[];
  cpu?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  types?: string;
  typings?: string;
  bin?: string | Record<string, string>;
}
interface PackageLock {
  packages: Record<string, PackageInfo>;
}

/** Liest npm-Metadaten direkt über Node, damit die Startprüfung selbst keine installierten Pakete benötigt. */
function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Erkennt die für diesen Windows-PC benötigten optionalen Binärpakete neben den regulären Abhängigkeiten. */
function requiredHere(pkg: PackageInfo): boolean {
  if (!pkg.optional) return true;
  return (
    process.platform === "win32" &&
    !!pkg.os?.includes("win32") &&
    (!pkg.cpu || pkg.cpu.includes(process.arch))
  );
}

/** Meldet fehlende oder veraltete Pakete anhand beider npm-Lockdateien sowie der tatsächlichen Installation. */
function installationIssue(root: string): string | undefined {
  const manifest = json<PackageInfo>(join(root, "package.json"));
  const target = json<PackageLock>(join(root, "package-lock.json")).packages;
  const lockedRoot = target?.[""];
  if (!lockedRoot)
    throw new Error("Die festgeschriebene Paketliste ist unvollständig.");
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    const declared = manifest[group] ?? {},
      locked = lockedRoot[group] ?? {};
    if (
      Object.keys(declared).length !== Object.keys(locked).length ||
      Object.entries(declared).some(([name, range]) => locked[name] !== range)
    )
      throw new Error(
        "package.json und package-lock.json passen nicht zusammen. Bitte den vollständigen Projektstand verwenden.",
      );
  }
  const installedLock = join(root, "node_modules", ".package-lock.json");
  if (!existsSync(installedLock))
    return "Der lokale npm-Installationsnachweis fehlt.";
  const installed = json<PackageLock>(installedLock).packages;
  for (const [location, pkg] of Object.entries(target)) {
    if (location && requiredHere(pkg) && !installed[location])
      return `Ein benötigtes Paket fehlt: ${location}.`;
  }
  for (const [location, pkg] of Object.entries(installed)) {
    if (
      !location.startsWith("node_modules/") ||
      location.split(/[\\/]/).includes("..")
    )
      return "Der lokale npm-Installationsnachweis ist ungültig.";
    const expected = target[location];
    if (
      !expected ||
      expected.version !== pkg.version ||
      expected.integrity !== pkg.integrity ||
      expected.resolved !== pkg.resolved
    )
      return `Die installierte Paketversion passt nicht: ${location}.`;
    const disk = json<PackageInfo>(join(root, location, "package.json"));
    if (disk.version !== expected.version)
      return `Eine Paketdatei ist veraltet: ${location}.`;
  }
  const require = createRequire(join(root, "package.json"));
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    const packageDir = join(root, "node_modules", name);
    const pkg = json<PackageInfo>(join(packageDir, "package.json"));
    // Laufzeit- und Buildpakete müssen sich aus diesem Checkout laden lassen, Typenpakete liefern Deklarationsdateien.
    if (name.startsWith("@types/")) {
      if (
        !existsSync(join(packageDir, pkg.types ?? pkg.typings ?? "index.d.ts"))
      )
        return `Typendateien fehlen: ${name}.`;
    } else {
      const entry = relative(
        packageDir,
        require.resolve(name, { paths: [root] }),
      );
      if (entry === ".." || entry.startsWith(".." + sep) || isAbsolute(entry))
        return `Der lokale Einstiegspunkt des Pakets ${name} fehlt.`;
    }
    const commands =
      typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
    if (commands.some((command) => !existsSync(join(packageDir, command))))
      return `Ein Programm des Pakets ${name} fehlt.`;
  }
}

/** Prüft ohne Schreibzugriff oder Netzwerk, auch wenn der Server gerade läuft. */
export function checkDependencies(root: string): {
  current: boolean;
  reason: string;
} {
  if (existsSync(join(root, ".runtime", "dependencies.pending")))
    return {
      current: false,
      reason: "Die vorige Paketinstallation wurde nicht abgeschlossen.",
    };
  try {
    const issue = installationIssue(root);
    return issue
      ? { current: false, reason: issue }
      : {
          current: true,
          reason: "Die lokalen Pakete entsprechen dem Projektstand.",
        };
  } catch (err) {
    return {
      current: false,
      reason:
        err instanceof Error && !("code" in err)
          ? err.message
          : "Der lokale Paketbestand ist unvollständig.",
    };
  }
}

/** Findet die zu Node gehörende npm-Kommandozeile im portablen, globalen oder paketierten Installationslayout. */
export function bundledNpm(): string {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, "node_modules/npm/bin/npm-cli.js"),
    join(nodeDir, "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const linked = join(nodeDir, "npm");
  if (existsSync(linked) && basename(realpathSync(linked)) === "npm-cli.js")
    candidates.push(realpathSync(linked));
  const npm = candidates.find(existsSync);
  if (!npm)
    throw new Error(
      "npm fehlt bei der gewählten Node-Laufzeit. Bitte scripts\\Install.ps1 ausführen.",
    );
  return npm;
}

/** Installiert bei Bedarf die festgeschriebenen Pakete mit dem npm der gewählten Node-Laufzeit; der Aufrufer hält den Betriebslock bis zum Ende. */
export function ensureDependencies(root: string): void {
  const result = checkDependencies(root);
  console.log(result.reason);
  if (result.current) return;
  const nodeDir = dirname(process.execPath);
  const npm = bundledNpm();
  const env = { ...process.env };
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = nodeDir + delimiter + (env[pathKey] ?? "");
  const pending = join(root, ".runtime", "dependencies.pending");
  mkdirSync(dirname(pending), { recursive: true });
  writeFileSync(pending, "npm ci\n");
  console.log("Die zum Update gehörenden Pakete werden eingerichtet …");
  const install = spawnSync(
    process.execPath,
    [
      npm,
      "ci",
      "--include=dev",
      "--include=optional",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
    ],
    {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (install.error || install.status !== 0)
    throw new Error(
      "Paketinstallation fehlgeschlagen. Den oben gemeldeten npm-Fehler beheben und erneut starten.",
    );
  const issue = installationIssue(root);
  if (issue) throw new Error(`Paketinstallation noch unvollständig: ${issue}`);
  rmSync(pending);
  console.log("Die benötigten Pakete sind vollständig installiert.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    if (process.argv[2] === "ensure") ensureDependencies(root);
    else if (process.argv[2] === "check") {
      const result = checkDependencies(root);
      console.log(result.reason);
      process.exitCode = result.current ? 0 : 1;
    } else throw new Error("Erwarteter Paketbefehl: check oder ensure.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
