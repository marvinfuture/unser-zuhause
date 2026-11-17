import { restoreBackup, listBackups } from "../server/backup.ts";
const [command, repositoryDir, snapshotId, targetDir] = process.argv.slice(2);
/** Listet vorhandene Sicherungsstände oder stellt einen davon in einen leeren Ordner wieder her; das Kennwort kommt nur über stdin. */
async function main() {
  if (!repositoryDir)
    throw new Error(
      "Aufruf: backup-cli.ts list <Archiv> | restore <Archiv> <Snapshot-ID> <leeres-Ziel>",
    );
  if (command === "list") {
    for (const id of await listBackups(repositoryDir)) console.log(id);
    return;
  }
  if (command !== "restore" || !snapshotId || !targetDir)
    throw new Error("Ungültiger Aufruf.");
  // Das Sicherungskennwort wird über stdin gelesen und erscheint nicht in den Prozessargumenten.
  let passphrase = "";
  for await (const chunk of process.stdin) {
    passphrase += chunk.toString();
    if (passphrase.length > 4096) throw new Error("Eingabe zu lang.");
  }
  passphrase = passphrase.replace(/\r?\n$/, "");
  const result = await restoreBackup({
    repositoryDir,
    snapshotId,
    targetDir,
    passphrase,
  });
  console.log(JSON.stringify(result));
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Wiederherstellung fehlgeschlagen.",
  );
  process.exitCode = 1;
});
