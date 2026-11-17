import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import sharp from "sharp";
const require = createRequire(import.meta.url);
sharp.cache(false);
sharp.concurrency(1);

/**
 * Liest und prüft JPEG, PNG, WebP oder HEIC, begrenzt die Pixelzahl und erzeugt ausgerichtete WebP-Ansichten ohne ursprüngliche Metadaten. Das Original bleibt unverändert; zurückgegeben werden Format und Ausgabemaße.
 */
async function processImage() {
  const buffer = await readFile(workerData.input);
  let source;
  let mime;
  let ext;
  const header = buffer.subarray(0, 64);
  const isHeif =
    header.subarray(4, 8).toString() === "ftyp" &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(header.toString("ascii"));
  if (isHeif) {
    const libheif = require("libheif-js/wasm-bundle");
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(buffer);
    if (!images?.length)
      throw new Error(
        "Das HEIC-Bild konnte nicht gelesen werden. Bitte als JPEG exportieren.",
      );
    const first = images.find((image) => image.is_primary?.()) ?? images[0];
    const width = first.get_width(),
      height = first.get_height();
    if (!width || !height || width * height > workerData.maxPixels)
      throw new Error(
        "Das Foto ist zu groß. Höchstens 60 Megapixel sind erlaubt.",
      );
    const pixels = await new Promise((resolve, reject) =>
      first.display(
        { data: new Uint8ClampedArray(width * height * 4), width, height },
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Das HEIC-Bild konnte nicht dekodiert werden.")),
      ),
    );
    source = sharp(Buffer.from(pixels.data), {
      raw: { width, height, channels: 4 },
      limitInputPixels: workerData.maxPixels,
    });
    mime = "image/heic";
    ext = "heic";
  } else {
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const png = header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      header.subarray(0, 4).toString() === "RIFF" &&
      header.subarray(8, 12).toString() === "WEBP";
    if (!jpeg && !png && !webp)
      throw new Error("Bitte ein JPEG-, PNG-, WebP- oder HEIC-Foto auswählen.");
    mime = jpeg ? "image/jpeg" : png ? "image/png" : "image/webp";
    ext = jpeg ? "jpg" : png ? "png" : "webp";
    source = sharp(buffer, {
      limitInputPixels: workerData.maxPixels,
      failOn: "warning",
    });
  }
  const meta = await source.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width * meta.height > workerData.maxPixels ||
    (meta.pages ?? 1) > 1
  )
    throw new Error(
      "Bitte ein einzelnes Foto mit höchstens 60 Megapixeln verwenden.",
    );
  // Vorschauen ausrichten und Metadaten entfernen; das Original niemals überschreiben.
  const display = await source
    .clone()
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 86 })
    .toFile(workerData.display);
  const thumb = await source
    .clone()
    .rotate()
    .resize({
      width: 600,
      height: 600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toFile(workerData.thumb);
  return {
    mime,
    ext,
    width: display.width,
    height: display.height,
    displayBytes: display.size,
    thumbBytes: thumb.size,
  };
}
try {
  parentPort.postMessage({ ok: true, result: await processImage() });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    message: error.message || "Das Foto konnte nicht verarbeitet werden.",
  });
}
