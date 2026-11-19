import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Prüft direkt und ohne Webcache, ob die angefragte Route innerhalb des Zeitlimits antwortet. */
function request(url: URL, ca?: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((accept, reject) => {
    const get = url.protocol === "https:" ? httpsGet : httpGet;
    const req = get(
      url,
      { ca, agent: false, signal: AbortSignal.timeout(3500) },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("error", reject);
        res.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 128_000)
            res.destroy(new Error("Unerwartet große Startantwort."));
        });
        res.on("end", () => accept({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
  });
}

/** Prüft die Versionskennung der App, damit weder ein fremder Dienst noch eine alte Instanz als bereit gilt. */
async function checkVersion(origin: string, version: string, ca?: Buffer): Promise<void> {
  const { status, body } = await request(new URL("/api/ready", origin), ca);
  if (status !== 200) throw new Error("HTTP " + status);
  const info = JSON.parse(body);
  if (info.application !== "unser-zuhause" || info.version !== version)
    throw new Error("Es antwortet ein anderer Programmstand.");
}

/** Prüft den lokalen Server und danach die konfigurierte Browseradresse einschließlich Startseite und eigener Zertifikatskette. */
export async function checkHost(
  config: { origin: string; port: number; dataDir: string },
  version: string,
) {
  const localOrigin = "http://127.0.0.1:" + config.port;
  try {
    await checkVersion(localOrigin, version);
  } catch (error) {
    return { code: 1, message: "Lokaler App-Server: " + reason(error) };
  }
  try {
    const origin = new URL(config.origin);
    const localCA = join(
      config.dataDir,
      "caddy",
      "pki",
      "authorities",
      "local",
      "root.crt",
    );
    const ca =
      origin.protocol === "https:" && existsSync(localCA)
        ? readFileSync(localCA)
        : undefined;
    if (origin.origin !== localOrigin) await checkVersion(origin.origin, version, ca);
    const page = await request(new URL("/", origin), ca);
    if (
      page.status !== 200 ||
      !page.body.includes('id="root"') ||
      !page.body.includes("/assets/")
    )
      throw new Error("Die gebaute App-Startseite fehlt (HTTP " + page.status + ").");
    return { code: 0, message: "Die konfigurierte Adresse liefert die aktuelle App." };
  } catch (error) {
    return {
      code: 2,
      message:
        "Lokaler App-Server bereit, konfigurierte Browseradresse: " + reason(error),
    };
  }
}

/** Liefert eine kurze Fehlermeldung für die lokale Startkonsole. */
function reason(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

// Das Startskript erhält einen unterscheidbaren Status für Backend und Browserzugriff.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(
      readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""),
    );
    const result = await checkHost(config, process.argv[3]);
    console.log(result.message);
    process.exitCode = result.code;
  } catch (error) {
    console.log(reason(error));
    process.exitCode = 1;
  }
}
