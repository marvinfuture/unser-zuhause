import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { filesBelow, sourceFingerprint } from "./build-state.ts";

/** Kennzeichnet den ausführbaren Stand einschließlich Backend, Startskripten und Oberfläche, auch ohne Git. */
export function runtimeVersion(root: string): string {
  const hash = createHash("sha256").update(sourceFingerprint(root));
  const paths = [...filesBelow(root, "server"), ...filesBelow(root, "scripts")].sort();
  for (const path of paths) {
    hash.update(path).update("\0");
    hash.update(
      createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest(),
    );
  }
  return hash.digest("hex");
}

// Der Starter vergleicht diesen Stand mit der Kennung des laufenden Prozesses.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== "version") throw new Error("Erwarteter Befehl: version");
  console.log(runtimeVersion(resolve(dirname(fileURLToPath(import.meta.url)), "..")));
}
