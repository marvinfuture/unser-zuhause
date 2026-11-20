import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  readdir,
  access,
} from "node:fs/promises";
import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import {
  registerMedia,
  mediaUsage,
  cleanupMedia,
  type MediaMetadata,
} from "../server/media.js";
import {
  createBackup,
  restoreBackup,
  isBackupRunning,
} from "../server/backup.js";
import type { Photo, Comparison } from "../shared/types.js";

/** Stellt einen isolierten Medienserver samt Testhaushalt bereit; Speichergrenzen können gezielt verkleinert werden. */
async function fixture(t: TestContext, limitBytes?: number) {
  const dir = await mkdtemp(join(tmpdir(), "uz-media-test-"));
  const ctx = createApp({
    dataDir: dir,
    /** Registriert Medienrouten mit den für diesen Test vorgesehenen Speichergrenzen. */
    registerExtras: (ctx) =>
      registerMedia(ctx, { minFreeBytes: 0, limitBytes }),
  });
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = "",
    csrf = "",
    version = 0;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    ctx.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  /** Sendet JSON mit der aktuellen Testsitzung und übernimmt erneuerte Sicherheits- und Profilkennungen. */
  const json = async (
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: base,
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      ...(body
        ? {
            body: JSON.stringify({ profileVersion: version, ...body }),
          }
        : {}),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0];
    const data = (await response.json()) as any;
    if (data.csrfToken) csrf = data.csrfToken;
    if (data.profileVersion !== undefined) version = data.profileVersion;
    return { status: response.status, data };
  };
  assert.equal((await json("GET", "/session")).status, 200);
  await json("POST", "/profile", { profileId: "karla" });
  const project = (
    await json("POST", "/projects", {
      title: "Foto-Test",
      requestId: randomUUID(),
    })
  ).data;
  /** Lädt künstliche Bildbytes mit wählbaren Formularwerten hoch; kann für Zugriffstests die Gerätesitzung weglassen. */
  const upload = async (
    buffer: Buffer,
    fields: Record<string, string> = {},
    authorized = true,
  ) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({
      projectId: project.id,
      profileVersion: String(version),
      title: "Unser Bild",
      category: "before",
      requestId: randomUUID(),
      ...fields,
    }))
      form.append(k, String(v));
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)]),
      "beliebiger-name.jpg",
    );
    const response = await fetch(base + "/api/photos", {
      method: "POST",
      headers: {
        Origin: base,
        ...(authorized ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
      },
      body: form,
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  return {
    ctx,
    server,
    dir,
    base,
    json,
    project,
    upload,
    /** Liefert das aktuelle Sitzungscookie für direkte Abrufe der geschützten Bilddateien. */
    headers: () => ({ Cookie: cookie }),
  };
}

test("photos validate content, preserve originals, orient previews and protect every file", async (t) => {
  const f = await fixture(t);
  const input = await sharp({
    create: { width: 400, height: 200, channels: 3, background: "#aabbcc" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  assert.equal((await f.upload(input, {}, false)).status, 401);
  const created = await f.upload(input);
  assert.equal(created.status, 201);
  assert.equal(created.data.createdBy, "karla");
  assert.equal(created.data.width, 200);
  assert.equal(created.data.height, 400);
  assert.ok(mediaUsage(f.ctx) > input.length);
  for (const variant of ["display", "thumb", "original"]) {
    assert.equal(
      (
        await fetch(
          `${f.base}/api/photos/${created.data.id}/file?variant=${variant}`,
        )
      ).status,
      401,
    );
    const response = await fetch(
      `${f.base}/api/photos/${created.data.id}/file?variant=${variant}`,
      { headers: f.headers() },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = Buffer.from(await response.arrayBuffer());
    if (variant === "original") assert.deepEqual(data, input);
    else {
      const meta = await sharp(data).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(meta.exif, undefined);
      assert.equal(meta.orientation, undefined);
    }
  }
  assert.equal(
    (
      await f.upload(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      )
    ).status,
    422,
  );
  assert.equal((await f.upload(Buffer.from("not an image"))).status, 422);
  assert.equal(f.ctx.db.list("photos").length, 1);
});

test("Abbruch während der Übertragung und nach vollständigem Empfang lässt gespeicherte Fotos und den nächsten Upload intakt", async (t) => {
  const f = await fixture(t);
  const input = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const saved = await f.upload(input);
  assert.equal(saved.status, 201);
  const tmp = join(f.dir, "media", "tmp");
  const session = (await f.json("GET", "/session")).data;
  const boundary = "Foto-" + randomUUID();
  const partial = request(f.base + "/api/photos", {
    method: "POST",
    headers: {
      ...f.headers(),
      Origin: f.base,
      "X-CSRF-Token": session.csrfToken,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
  });
  const disconnected = new Promise<void>((done) => partial.on("close", done));
  // Der Test trennt die Verbindung absichtlich nach dem ersten Teil eines synthetischen Bildes.
  partial.on("error", () => {});
  t.after(() => partial.destroy());
  partial.write(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  partial.write(input);
  const deadline = Date.now() + 5000;
  while (!(await readdir(tmp)).length) {
    assert.ok(
      Date.now() < deadline,
      "Der Server muss das Teilbild empfangen haben.",
    );
    await delay(10);
  }
  partial.destroy();
  await disconnected;

  /** Wartet auf die Freigabe der begrenzten Verarbeitung und bestätigt einen neuen regulären Upload. */
  async function nextPhoto() {
    const until = Date.now() + 5000;
    let result = await f.upload(input);
    while (result.data.code === "UPLOAD_BUSY") {
      assert.ok(
        Date.now() < until,
        "Der Uploadplatz muss nach dem Abbruch wieder frei sein.",
      );
      await delay(15);
      result = await f.upload(input);
    }
    assert.equal(result.status, 201);
    assert.deepEqual(await readdir(tmp), []);
  }
  await nextPhoto();

  // Alle Bytes sind eingetroffen, der Browser trennt aber vor der Antwort und der Datenbankbestätigung.
  f.server.prependOnceListener("request", (req) => {
    req.once("end", () => req.socket.destroy());
  });
  await assert.rejects(f.upload(input));
  await nextPhoto();
  assert.ok(f.ctx.db.get("photos", saved.data.id));
  assert.equal(f.ctx.db.list("photos").length, 3);
  for (const kind of ["originals", "display", "thumb"]) {
    assert.equal((await readdir(join(f.dir, "media", kind))).length, 3);
  }
});

test("photo retries are idempotent and referenced images cannot disappear from comparisons", async (t) => {
  const f = await fixture(t);
  const input = await sharp({
    create: { width: 30, height: 20, channels: 3, background: "#abcdef" },
  })
    .png()
    .toBuffer();
  const requestId = randomUUID();
  const a = await f.upload(input, { requestId });
  const again = await f.upload(input, { requestId });
  assert.equal(again.data.id, a.data.id);
  assert.equal(f.ctx.db.list("photos").length, 1);
  assert.equal(
    (await f.upload(input, { requestId, title: "Andere Bedeutung" })).status,
    409,
  );
  const b = await f.upload(input, { category: "after" });
  const pair = await f.json("POST", "/comparisons", {
    projectId: f.project.id,
    title: "Vorher und Nachher",
    beforeId: a.data.id,
    afterId: b.data.id,
    requestId: randomUUID(),
  });
  assert.equal(pair.status, 201);
  const rejected = await f.json("PATCH", `/photos/${a.data.id}`, {
    version: a.data.version,
    deletedAt: new Date().toISOString(),
  });
  assert.equal(rejected.status, 409);
  await f.json("PATCH", `/comparisons/${pair.data.id}`, {
    version: pair.data.version,
    archivedAt: new Date().toISOString(),
  });
  const trashed = await f.json("PATCH", `/photos/${a.data.id}`, {
    version: a.data.version,
    deletedAt: new Date().toISOString(),
  });
  assert.equal(trashed.status, 200);
  assert.equal(
    (
      await fetch(`${f.base}/api/photos/${a.data.id}/file`, {
        headers: f.headers(),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.json("PATCH", `/photos/${a.data.id}`, {
        version: a.data.version,
        title: "veralteter Stand",
      })
    ).status,
    409,
  );
  const restored = await f.json("PATCH", `/photos/${a.data.id}`, {
    version: trashed.data.version,
    deletedAt: null,
  });
  assert.equal(restored.status, 200);
  assert.equal(
    (
      await fetch(`${f.base}/api/photos/${a.data.id}/file`, {
        headers: f.headers(),
      })
    ).status,
    200,
  );
});

test("media budget is enforced before writing a valid image record", async (t) => {
  const f = await fixture(t, 100);
  const input = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  assert.equal((await f.upload(input)).status, 507);
  assert.equal(f.ctx.db.list("photos").length, 0);
});

test("small photos use their actual storage instead of reserving the maximum upload size", async (t) => {
  const f = await fixture(t, 4096);
  const input = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const uploaded = await f.upload(input);
  assert.equal(uploaded.status, 201);
  assert.ok(mediaUsage(f.ctx) > input.length && mediaUsage(f.ctx) < 4096);
});

test("trash cleanup preserves referenced photos and only expires unreferenced photos after 30 days", async (t) => {
  const f = await fixture(t);
  const input = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const first = (await f.upload(input)).data as Photo;
  const second = (await f.upload(input, { category: "after" })).data as Photo;
  const free = (await f.upload(input)).data as Photo;
  const pair = await f.json("POST", "/comparisons", {
    requestId: randomUUID(),
    projectId: f.project.id,
    title: "Geschütztes Paar",
    beforeId: first.id,
    afterId: second.id,
  });
  await f.json("PATCH", `/comparisons/${pair.data.id}`, {
    version: pair.data.version,
    archivedAt: new Date().toISOString(),
  });
  const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
  f.ctx.db.put("photos", { ...first, deletedAt: old } as Photo);
  f.ctx.db.put("photos", {
    ...free,
    deletedAt: new Date(Date.now() - 29 * 86_400_000).toISOString(),
  } as Photo);
  await cleanupMedia(f.ctx);
  assert.ok(
    f.ctx.db.get("photos", first.id),
    "archived comparisons retain their originals",
  );
  assert.ok(
    f.ctx.db.get("photos", free.id),
    "29 days is within the recovery period",
  );
  f.ctx.db.put("photos", { ...free, deletedAt: old } as Photo);
  const metadata = f.ctx.db.getSetting<MediaMetadata>(`media:${free.id}`)!;
  await cleanupMedia(f.ctx);
  assert.equal(f.ctx.db.get("photos", free.id), undefined);
  assert.equal(f.ctx.db.getSetting(`media:${free.id}`), undefined);
  for (const path of [metadata.original, metadata.display, metadata.thumb])
    await assert.rejects(access(join(f.dir, path)));
  const retained = f.ctx.db.getSetting<MediaMetadata>(`media:${first.id}`)!;
  await access(join(f.dir, retained.original));
});

test("a photo restored while trash cleanup awaits another file is retained", async (t) => {
  const f = await fixture(t);
  const input = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const first = (await f.upload(input)).data as Photo;
  const second = (await f.upload(input)).data as Photo;
  const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
  f.ctx.db.put("photos", { ...first, deletedAt: old } as Photo);
  f.ctx.db.put("photos", { ...second, deletedAt: old } as Photo);
  const cleanup = cleanupMedia(f.ctx);
  // Die erste Datei wird bereits asynchron gelöscht; die zweite kann in diesem Moment wiederhergestellt werden.
  assert.equal(f.ctx.db.get("photos", first.id), undefined);
  f.ctx.db.put("photos", {
    ...second,
    deletedAt: null,
    version: second.version + 1,
  } as Photo);
  await cleanup;
  assert.ok(
    f.ctx.db.get("photos", second.id),
    "a confirmed restoration must survive the running cleanup",
  );
  const metadata = f.ctx.db.getSetting<MediaMetadata>(`media:${second.id}`)!;
  for (const path of [metadata.original, metadata.display, metadata.thumb])
    await access(join(f.dir, path));
});

test("complete application backup restores photos, crop/zoom, defect links and revokes old sessions", async (t) => {
  const f = await fixture(t);
  const qaRoot = resolve(".qa");
  await mkdir(qaRoot, { recursive: true });
  const work = await mkdtemp(join(qaRoot, "media-restore-"));
  const target = join(work, "restored");
  let restored: ReturnType<typeof createApp> | undefined;
  let server:
    | ReturnType<ReturnType<typeof createApp>["app"]["listen"]>
    | undefined;
  try {
    const original = await sharp({
      create: { width: 80, height: 40, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    const after = await sharp({
      create: { width: 40, height: 80, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const beforePhoto = (await f.upload(original)).data as Photo;
    const afterPhoto = (await f.upload(after, { category: "after" }))
      .data as Photo;
    const defect = (
      await f.json("POST", "/defects", {
        requestId: randomUUID(),
        title: "Testmangel",
      })
    ).data;
    const defectPhoto = (
      await f.upload(after, { projectId: "", defectId: defect.id })
    ).data as Photo;
    const pair = (
      await f.json("POST", "/comparisons", {
        requestId: randomUUID(),
        projectId: f.project.id,
        title: "Ausschnitt behalten",
        beforeId: beforePhoto.id,
        afterId: afterPhoto.id,
        beforeX: 20,
        beforeY: 70,
        beforeZoom: 1.6,
        afterX: 80,
        afterY: 30,
        afterZoom: 2.2,
      })
    ).data as Comparison;
    const run = createBackup({
      dataDir: f.dir,
      repositoryDir: join(work, "archive"),
      passphrase: "Nur-Testpassphrase-2026",
      database: f.ctx.db.raw,
    });
    assert.equal(isBackupRunning(f.dir), true);
    await cleanupMedia(f.ctx);
    assert.equal(f.ctx.db.list("photos").length, 3);
    const snapshot = await run;
    await restoreBackup({
      repositoryDir: join(work, "archive"),
      targetDir: target,
      snapshotId: snapshot.id,
      passphrase: "Nur-Testpassphrase-2026",
    });
    restored = createApp({
      dataDir: target,
      registerExtras: (ctx) => registerMedia(ctx, { minFreeBytes: 0 }),
    });
    assert.deepEqual(restored.db.get("comparisons", pair.id), pair);
    assert.deepEqual(restored.db.get("photos", defectPhoto.id), defectPhoto);
    assert.equal(
      restored.db.raw.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n,
      0,
    );
    assert.equal(
      restored.db.raw.prepare("SELECT COUNT(*) AS n FROM idempotency").get()!.n,
      0,
    );
    server = restored.app.listen(0, "127.0.0.1");
    await new Promise<void>((done) => server!.once("listening", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal(
      (
        await fetch(`${base}/api/photos/${beforePhoto.id}/file`, {
          headers: f.headers(),
        })
      ).status,
      401,
    );
    const sessionResponse = await fetch(`${base}/api/session`);
    const session = (await sessionResponse.json()) as any;
    assert.equal(session.profileId, null);
    const cookie = sessionResponse.headers.get("set-cookie")!.split(";")[0];
    const choice = await fetch(`${base}/api/profile`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: base,
        "X-CSRF-Token": session.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profileId: "marvin",
        profileVersion: session.profileVersion,
      }),
    });
    assert.equal(choice.status, 200);
    for (const photo of [beforePhoto, afterPhoto, defectPhoto]) {
      for (const variant of ["original", "display", "thumb"]) {
        const response = await fetch(
          `${base}/api/photos/${photo.id}/file?variant=${variant}`,
          { headers: { Cookie: cookie } },
        );
        assert.equal(
          response.status,
          200,
          `${photo.id}/${variant}: ${response.status === 200 ? "" : await response.text()}`,
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        if (variant === "original")
          assert.deepEqual(
            bytes,
            photo.id === beforePhoto.id ? original : after,
          );
        else assert.equal((await sharp(bytes).metadata()).format, "webp");
      }
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((done) => server!.close(() => done()));
    }
    restored?.db.close();
    const path = relative(qaRoot, work);
    assert(
      path.startsWith("media-restore-") &&
        !isAbsolute(path) &&
        !path.includes(sep),
    );
    await rm(work, { recursive: true, force: true });
  }
});

test("HEIC sample decodes through the isolated worker when the optional local QA fixture is present", async (t) => {
  let input: Buffer;
  try {
    input = await readFile(join(process.cwd(), ".qa", "example.heic"));
  } catch {
    t.skip(
      "Optional public libheif sample not downloaded; no network access during tests.",
    );
    return;
  }
  const f = await fixture(t);
  const result = await f.upload(input);
  assert.equal(result.status, 201);
  assert.equal(result.data.mime, "image/heic");
  assert.ok(result.data.width > 0);
});
