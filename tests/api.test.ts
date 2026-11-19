import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createApp, type AppOptions } from "../server/app.js";
import { Store } from "../server/db.js";
import type { Session, Photo } from "../shared/types.js";

class Client {
  cookie = "";
  csrf = "";
  profileVersion = 0;
  /** Bindet diesen unabhängigen Testbrowser an die Adresse der temporären Testinstallation. */
  constructor(readonly base: string) {}
  /** Sendet eine API-Anfrage, merkt sich Sitzung und Profilversion und erlaubt gezielte Sicherheitsfehler im Test. */
  async send(
    method: string,
    path: string,
    body?: unknown,
    extra: {
      csrf?: boolean;
      origin?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    const response = await fetch(this.base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(extra.csrf !== false && this.csrf
          ? { "X-CSRF-Token": this.csrf }
          : {}),
        Origin: extra.origin ?? this.base,
        ...extra.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    const result = (await response.json()) as any;
    if (typeof result.csrfToken === "string") {
      const session = result as Session;
      this.csrf = session.csrfToken ?? "";
      this.profileVersion = session.profileVersion;
    }
    return { status: response.status, body: result, headers: response.headers };
  }
  /** Legt einen Datensatz mit aktueller Profilversion und wiederholbarer Anfragenkennung an. */
  create(
    collection: string,
    fields: Record<string, unknown>,
    requestId = randomUUID(),
  ) {
    return this.send("POST", `/api/${collection}`, {
      ...fields,
      requestId,
      profileVersion: this.profileVersion,
    });
  }
  /** Ändert gezielt den angegebenen Versionsstand, damit Tests konkurrierende Bearbeitungen erkennen können. */
  patch(
    collection: string,
    record: { id: string; version: number },
    fields: Record<string, unknown>,
  ) {
    return this.send("PATCH", `/api/${collection}/${record.id}`, {
      ...fields,
      version: record.version,
      profileVersion: this.profileVersion,
    });
  }
  /** Wechselt das Personenprofil ausschließlich für diesen Testbrowser. */
  choose(profileId: "karla" | "marvin") {
    return this.send("POST", "/api/profile", {
      profileId,
      profileVersion: this.profileVersion,
    });
  }
}
/** Startet eine isolierte Testinstallation und registriert das anschließende Schließen und Entfernen ihrer temporären Daten. */
async function fixture(
  t: TestContext,
  chooseProfile = true,
  options: Partial<AppOptions> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "unser-zuhause-api-"));
  const ctx = createApp({ dataDir: dir, secureCookies: false, ...options });
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new Client(`http://127.0.0.1:${address.port}`);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  if (chooseProfile) {
    assert.equal((await client.send("GET", "/api/session")).status, 200);
    assert.equal((await client.choose("karla")).status, 200);
  }
  return {
    ctx,
    client,
    dir,
    /** Erzeugt einen weiteren Browser-Client ohne die Sitzung des ersten Clients zu übernehmen. */
    newClient: () => new Client(client.base),
  };
}

/** Sendet eine Anfrage mit ausdrücklich gesetztem Host-Header, um freigegebene LAN-Adressen und DNS-Rebinding isoliert zu prüfen. */
async function hostRequest(base: string, headers: Record<string, string>) {
  return new Promise<{ status: number; body: any; cookie?: string }>(
    (done, fail) => {
      const outgoing = request(
        base + "/api/session",
        { headers },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () =>
            done({
              status: response.statusCode!,
              body: JSON.parse(text),
              cookie: response.headers["set-cookie"]?.[0],
            }),
          );
        },
      );
      outgoing.on("error", fail);
      outgoing.end();
    },
  );
}

test("password-free entry creates a protected device session and preserves origin and CSRF checks", async (t) => {
  const { ctx, client } = await fixture(t, false);
  const privateState = await client.send("GET", "/api/state");
  assert.equal(privateState.status, 401);
  assert.equal(privateState.headers.get("cache-control"), "no-store");
  const rebind = await hostRequest(client.base, { Host: "rebinding.example" });
  assert.equal(rebind.status, 403);
  assert.equal(rebind.body.code, "HOST_NOT_ALLOWED");
  assert.equal(
    (
      await client.send("GET", "/api/session", undefined, {
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await client.send("GET", "/api/session", undefined, {
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      ctx.db.raw.prepare("SELECT count(*) n FROM sessions").get() as {
        n: number;
      }
    ).n,
    0,
  );
  const initial = await client.send("GET", "/api/session");
  assert.equal(initial.status, 200);
  assert.deepEqual(Object.keys(initial.body).sort(), [
    "csrfToken",
    "profileId",
    "profileVersion",
    "profiles",
  ]);
  assert.equal(initial.body.profileId, null);
  assert.equal(initial.body.profileVersion, 0);
  assert.match(initial.body.csrfToken, /^[a-f0-9]{64}$/);
  assert.match(initial.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(initial.headers.get("set-cookie") ?? "", /SameSite=Strict/);
  assert.equal((await client.send("GET", "/api/state")).status, 200);
  assert.equal(
    (await client.create("rooms", { title: "Küche" })).body.code,
    "PROFILE_REQUIRED",
  );
  assert.equal(
    (
      await client.send(
        "POST",
        "/api/profile",
        { profileId: "karla", profileVersion: 0 },
        { csrf: false },
      )
    ).status,
    403,
  );
  assert.equal((await client.choose("karla")).status, 200);
  assert.equal(
    (
      await client.send(
        "POST",
        "/api/rooms",
        { title: "Küche", requestId: randomUUID(), profileVersion: 1 },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const repeated = await client.send("GET", "/api/session");
  assert.equal(repeated.body.csrfToken, initial.body.csrfToken);
  assert.equal(repeated.body.profileId, "karla");
  assert.equal(repeated.headers.get("set-cookie"), null);
  assert.equal(
    (
      ctx.db.raw.prepare("SELECT count(*) n FROM sessions").get() as {
        n: number;
      }
    ).n,
    1,
  );
  for (const endpoint of ["setup", "login", "password", "logout"])
    assert.equal(
      (await client.send("POST", `/api/${endpoint}`, {})).status,
      404,
    );
});

test("configured LAN entry supports secure cookies while foreign origins remain blocked", async (t) => {
  const { client } = await fixture(t, false, {
    origin: "https://zuhause.home.arpa",
    secureCookies: true,
  });
  const response = await hostRequest(client.base, {
    Host: "zuhause.home.arpa",
    Origin: "https://zuhause.home.arpa",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.profileId, null);
  assert.match(response.cookie ?? "", /Secure/);
  assert.equal(
    (
      await hostRequest(client.base, {
        Host: "zuhause.home.arpa",
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
});

test("two devices retain attribution; profile and record conflicts never silently overwrite", async (t) => {
  const { client: karla, newClient } = await fixture(t);
  const marvin = newClient();
  await marvin.send("GET", "/api/session");
  await marvin.choose("marvin");
  const room = (await karla.create("rooms", { title: "Wohnzimmer" })).body;
  const project = (
    await karla.create("projects", {
      title: "Wände streichen",
      roomId: room.id,
      priority: "high",
    })
  ).body;
  const task = (
    await karla.create("tasks", {
      title: "Abkleben",
      projectId: project.id,
      roomId: room.id,
      assignees: ["marvin"],
      priority: "urgent",
      dueDate: "2026-12-12",
    })
  ).body;
  assert.equal(task.createdBy, "karla");
  const completed = await marvin.patch("tasks", task, { status: "done" });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.createdBy, "karla");
  assert.equal(completed.body.updatedBy, "marvin");
  assert.equal(completed.body.completedBy, "marvin");
  assert.equal(completed.body.projectId, project.id);
  assert.equal(completed.body.priority, "urgent");
  assert.equal(completed.body.dueDate, "2026-12-12");
  assert.deepEqual(completed.body.assignees, ["marvin"]);
  const stale = await karla.patch("tasks", task, { title: "Alter Entwurf" });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "VERSION_CONFLICT");
  assert.equal(stale.body.record.status, "done");
  const oldVersion = karla.profileVersion;
  await karla.choose("marvin");
  const switched = await karla.send("POST", "/api/rooms", {
    title: "Falsche Zuordnung",
    requestId: randomUUID(),
    profileVersion: oldVersion,
  });
  assert.equal(switched.status, 409);
  assert.equal(switched.body.code, "PROFILE_CHANGED");
  assert.equal(
    (await marvin.send("GET", "/api/session")).body.profileId,
    "marvin",
  );
  const state = (await marvin.send("GET", "/api/state")).body;
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].title, "Abkleben");
  assert.ok(
    state.notes.some(
      (note: any) =>
        note.body.includes("erledigt") && note.createdBy === "marvin",
    ),
  );
});

test("validation rejects forged authors, invalid references, quantities and impossible dates", async (t) => {
  const { client } = await fixture(t);
  assert.equal(
    (await client.create("rooms", { title: "Bad", createdBy: "marvin" }))
      .status,
    400,
  );
  assert.equal(
    (await client.create("tasks", { title: "A", priority: "super" })).status,
    400,
  );
  assert.equal(
    (await client.create("tasks", { title: "A", projectId: randomUUID() })).body
      .code,
    "INVALID_REFERENCE",
  );
  assert.equal(
    (await client.create("tasks", { title: "A", dueDate: "2026-02-30" }))
      .status,
    400,
  );
  assert.equal(
    (
      await client.create("tasks", {
        title: "A",
        startDate: "2026-12-12",
        dueDate: "2026-12-10",
      })
    ).status,
    400,
  );
  assert.equal(
    (await client.create("shopping", { title: "Farbe", quantity: -1 })).status,
    400,
  );
  assert.equal(
    (await client.create("shopping", { title: "Farbe", unitPriceCents: 1.5 }))
      .status,
    400,
  );
  const item = (
    await client.create("shopping", {
      title: "Farbe",
      quantity: 2,
      unit: "Liter",
    })
  ).body;
  assert.equal(item.unitPriceCents, null);
  const purchased = (await client.patch("shopping", item, { purchased: true }))
    .body;
  assert.equal(purchased.quantity, 2);
  assert.equal(purchased.unit, "Liter");
  assert.equal(purchased.purchasedBy, "karla");
  const undone = (
    await client.patch("shopping", purchased, { purchased: false })
  ).body;
  assert.equal(undone.purchasedBy, null);
  const archived = (
    await client.patch("shopping", undone, {
      archivedAt: new Date().toISOString(),
    })
  ).body;
  assert.ok(archived.archivedAt);
  const restored = (
    await client.patch("shopping", archived, { archivedAt: null })
  ).body;
  assert.equal(restored.archivedAt, null);
});

test("retries create one entity and one activity; reused request IDs cannot change content", async (t) => {
  const { client } = await fixture(t);
  const requestId = randomUUID();
  const [first, second] = await Promise.all([
    client.create("projects", { title: "Küche" }, requestId),
    client.create("projects", { title: "Küche" }, requestId),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  assert.equal(first.body.id, second.body.id);
  const state = (await client.send("GET", "/api/state")).body;
  assert.equal(state.projects.length, 1);
  assert.equal(state.notes.length, 1);
  const reused = await client.create(
    "projects",
    { title: "Badezimmer" },
    requestId,
  );
  assert.equal(reused.status, 409);
  assert.equal(reused.body.code, "IDEMPOTENCY_CONFLICT");
  const event = state.notes[0];
  assert.equal(
    (await client.patch("notes", event, { body: "Erfunden" })).body.code,
    "READ_ONLY",
  );
});

test("comparisons accept only available different photos from the same project", async (t) => {
  const { ctx, client } = await fixture(t);
  const project = (await client.create("projects", { title: "Boden" })).body;
  const otherProject = (await client.create("projects", { title: "Bad" })).body;
  /** Erstellt einen Foto-Datensatz für das angegebene Projekt, optional bereits als gelöscht markiert. */
  const photo = (
    projectId: string,
    deletedAt: string | null = null,
  ): Photo => ({
    id: randomUUID(),
    projectId,
    defectId: null,
    title: "Bild",
    category: "before",
    width: 100,
    height: 100,
    bytes: 100,
    mime: "image/jpeg",
    deletedAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "karla",
    updatedBy: "karla",
    version: 1,
    archivedAt: null,
  });
  const before = photo(project.id),
    after = photo(project.id),
    wrong = photo(otherProject.id),
    trashed = photo(project.id, new Date().toISOString());
  for (const p of [before, after, wrong, trashed]) ctx.db.put("photos", p);
  const fields = {
    projectId: project.id,
    title: "Vorher / Nachher",
    beforeId: before.id,
    afterId: after.id,
  };
  assert.equal(
    (await client.create("comparisons", { ...fields, afterId: wrong.id }))
      .status,
    400,
  );
  assert.equal(
    (await client.create("comparisons", { ...fields, afterId: trashed.id }))
      .status,
    400,
  );
  assert.equal(
    (await client.create("comparisons", { ...fields, afterId: before.id }))
      .status,
    400,
  );
  assert.equal(
    (await client.create("comparisons", { ...fields, beforeZoom: 10 })).status,
    400,
  );
  const valid = await client.create("comparisons", fields);
  assert.equal(valid.status, 201);
  assert.equal(valid.body.beforeX, 50);
  assert.equal(valid.body.afterZoom, 1);
});

test("reset replaces only this device session; expired and previous cookies cannot write", async (t) => {
  const { ctx, client, newClient } = await fixture(t);
  const other = newClient();
  await other.send("GET", "/api/session");
  await other.choose("marvin");
  const oldCookie = client.cookie;
  const oldCsrf = client.csrf;
  assert.equal(
    (await client.send("DELETE", "/api/session", undefined, { csrf: false }))
      .status,
    403,
  );
  const changed = await client.send("DELETE", "/api/session");
  assert.equal(changed.status, 200);
  assert.notEqual(client.cookie, oldCookie);
  assert.notEqual(client.csrf, oldCsrf);
  assert.equal(changed.body.profileId, null);
  assert.equal(changed.body.profileVersion, 0);
  const stale = newClient();
  stale.cookie = oldCookie;
  stale.csrf = oldCsrf;
  assert.equal((await stale.send("GET", "/api/state")).status, 401);
  assert.equal(
    (await stale.create("rooms", { title: "Veraltete Sitzung" })).status,
    401,
  );
  assert.equal(
    (await other.send("GET", "/api/session")).body.profileId,
    "marvin",
  );
  assert.equal(
    (await client.create("rooms", { title: "Noch ohne Profil" })).body.code,
    "PROFILE_REQUIRED",
  );
  ctx.db.raw
    .prepare("UPDATE sessions SET expires_at=0 WHERE csrf_token=?")
    .run(client.csrf);
  assert.equal((await client.send("GET", "/api/state")).status, 401);
  const expiredCookie = client.cookie;
  const renewed = await client.send("GET", "/api/session");
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.profileId, null);
  assert.notEqual(client.cookie, expiredCookie);
  assert.equal((await other.send("GET", "/api/state")).status, 200);
});

test("database and migration survive reopening without seed data or resets", async (t) => {
  const { ctx, client, dir } = await fixture(t);
  const room = (await client.create("rooms", { title: "Garten" })).body;
  const second = createApp({ dataDir: dir });
  try {
    assert.equal(second.db.get("rooms", room.id)?.id, room.id);
    assert.equal(second.db.list("rooms").length, 1);
    assert.equal(second.db.getSetting("passwordHash"), undefined);
    assert.equal(
      (
        ctx.db.raw.prepare("SELECT count(*) n FROM migrations").get() as {
          n: number;
        }
      ).n,
      3,
    );
    assert.equal(
      (await client.send("GET", "/api/session")).body.profileId,
      "karla",
    );
  } finally {
    second.db.close();
  }
});

test("legacy migrations remove only app credentials and add task defaults without losing household data", async (t) => {
  for (const schemaVersion of [1, 2]) {
    const dir = await mkdtemp(join(tmpdir(), "uz-legacy-migration-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const raw = new DatabaseSync(join(dir, "home.sqlite"));
    raw.exec(`
      CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE records(kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)), version INTEGER NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, profile_id TEXT, profile_version INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE idempotency(key TEXT PRIMARY KEY, response TEXT NOT NULL, created_at INTEGER NOT NULL);
    `);
    for (let version = 1; version <= schemaVersion; version++)
      raw
        .prepare("INSERT INTO migrations VALUES(?,?)")
        .run(version, "2026-11-16T10:00:00.000Z");
    if (schemaVersion === 1)
      raw
        .prepare("INSERT INTO settings VALUES(?,?)")
        .run("passwordHash", JSON.stringify("synthetic-old-password-hash"));
    raw
      .prepare("INSERT INTO settings VALUES(?,?)")
      .run(
        "backupSettings",
        JSON.stringify({ directory: "synthetic-backup-directory" }),
      );
    raw
      .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)")
      .run(
        "synthetic-token",
        "synthetic-csrf",
        "karla",
        4,
        Date.now() + 100_000,
        Date.now(),
      );
    const task = {
      id: randomUUID(),
      title: "Vorhandene Aufgabe",
      description: "Bleibt vollständig erhalten",
      projectId: null,
      roomId: null,
      defectId: null,
      priority: "high",
      status: "done",
      assignees: ["marvin"],
      startDate: null,
      dueDate: "2026-12-15",
      completedBy: "marvin",
      createdAt: "2026-11-15T09:00:00.000Z",
      updatedAt: "2026-11-16T09:00:00.000Z",
      createdBy: "karla",
      updatedBy: "marvin",
      version: 7,
      archivedAt: null,
    };
    const photo = {
      id: randomUUID(),
      title: "Vorhandenes Foto",
      version: 2,
      relativeFile: "media/synthetic-original.jpg",
    };
    for (const [kind, record] of [
      ["tasks", task],
      ["photos", photo],
    ] as const)
      raw
        .prepare("INSERT INTO records VALUES(?,?,?,?)")
        .run(kind, record.id, JSON.stringify(record), record.version);
    raw.close();
    const migrated = new Store(dir);
    try {
      assert.deepEqual(migrated.get("tasks", task.id), {
        ...task,
        predecessorIds: [],
        phase: "preparation",
      });
      assert.deepEqual(migrated.get("photos", photo.id), photo);
      assert.equal(migrated.getSetting("passwordHash"), undefined);
      assert.deepEqual(migrated.getSetting("backupSettings"), {
        directory: "synthetic-backup-directory",
      });
      assert.deepEqual(
        migrated.raw
          .prepare("SELECT version FROM migrations ORDER BY version")
          .all()
          .map((row) => row.version),
        [1, 2, 3],
      );
      assert.equal(
        (
          migrated.raw.prepare("SELECT count(*) n FROM sessions").get() as {
            n: number;
          }
        ).n,
        schemaVersion === 1 ? 0 : 1,
      );
    } finally {
      migrated.close();
    }
  }
});

test("multiple predecessors permit planning but require every predecessor before starting or completing", async (t) => {
  const { client } = await fixture(t);
  const project = (await client.create("projects", { title: "Bad renovieren" }))
    .body;
  let first = (
    await client.create("tasks", {
      title: "Material besorgen",
      projectId: project.id,
      phase: "planning",
    })
  ).body;
  let second = (
    await client.create("tasks", {
      title: "Fläche vorbereiten",
      projectId: project.id,
    })
  ).body;
  let successor = (
    await client.create("tasks", {
      title: "Fliesen legen",
      projectId: project.id,
      predecessorIds: [first.id, second.id],
      phase: "execution",
      assignees: ["marvin"],
      dueDate: "2026-12-20",
    })
  ).body;
  assert.equal(first.phase, "planning");
  assert.equal(second.phase, "preparation");
  assert.deepEqual(second.predecessorIds, []);
  assert.equal(successor.status, "open");
  assert.deepEqual(successor.assignees, ["marvin"]);
  const early = await client.patch("tasks", successor, { status: "active" });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, "TASK_NOT_READY");
  assert.match(early.body.message, /Material besorgen/);
  assert.match(early.body.message, /Fläche vorbereiten/);
  first = (await client.patch("tasks", first, { status: "done" })).body;
  const stillWaiting = await client.patch("tasks", successor, {
    status: "done",
  });
  assert.equal(stillWaiting.body.code, "TASK_NOT_READY");
  assert.match(stillWaiting.body.message, /Fläche vorbereiten/);
  assert.doesNotMatch(stillWaiting.body.message, /Material besorgen/);
  successor = (await client.patch("tasks", successor, { status: "blocked" }))
    .body;
  second = (await client.patch("tasks", second, { status: "done" })).body;
  assert.equal(
    (await client.send("GET", "/api/state")).body.tasks.find(
      (task: any) => task.id === successor.id,
    ).status,
    "blocked",
  );
  const started = await client.patch("tasks", successor, { status: "active" });
  assert.equal(started.status, 200);
  assert.equal(started.body.phase, "execution");
  assert.deepEqual(started.body.predecessorIds, [first.id, second.id]);
  const completed = await client.patch("tasks", started.body, {
    status: "done",
    phase: "finishing",
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.completedBy, "karla");
  assert.equal(
    (
      await client.create("tasks", {
        title: "Ungültige Phase",
        phase: "unknown",
      })
    ).status,
    400,
  );
});

test("dependencies reject missing, duplicate, self, cyclic and cross-project references", async (t) => {
  const { client } = await fixture(t);
  const project = (await client.create("projects", { title: "Küche" })).body;
  const other = (await client.create("projects", { title: "Flur" })).body;
  const a = (
    await client.create("tasks", { title: "A", projectId: project.id })
  ).body;
  const b = (
    await client.create("tasks", {
      title: "B",
      projectId: project.id,
      predecessorIds: [a.id],
    })
  ).body;
  const c = (
    await client.create("tasks", {
      title: "C",
      projectId: project.id,
      predecessorIds: [b.id],
    })
  ).body;
  assert.equal(
    (await client.patch("tasks", a, { predecessorIds: [a.id] })).body.code,
    "INVALID_DEPENDENCY",
  );
  assert.equal(
    (await client.patch("tasks", a, { predecessorIds: [c.id] })).body.code,
    "DEPENDENCY_CYCLE",
  );
  assert.equal(
    (await client.patch("tasks", b, { predecessorIds: [a.id, a.id] })).status,
    400,
  );
  assert.equal(
    (
      await client.create("tasks", {
        title: "Fehlt",
        projectId: project.id,
        predecessorIds: [randomUUID()],
      })
    ).body.code,
    "INVALID_DEPENDENCY",
  );
  assert.equal(
    (
      await client.create("tasks", {
        title: "Anderes Projekt",
        projectId: other.id,
        predecessorIds: [a.id],
      })
    ).body.code,
    "INVALID_DEPENDENCY",
  );
  assert.equal(
    (
      await client.create("tasks", {
        title: "Ohne Projekt",
        predecessorIds: [a.id],
      })
    ).body.code,
    "INVALID_DEPENDENCY",
  );
  assert.equal(
    (
      await client.create("tasks", {
        title: "Zu früh erledigt",
        projectId: project.id,
        predecessorIds: [a.id],
        status: "done",
      })
    ).body.code,
    "TASK_NOT_READY",
  );
  assert.equal((await client.send("GET", "/api/state")).body.tasks.length, 3);
});

test("dependency changes explicitly reopen started tasks and predecessor edits protect live successors", async (t) => {
  const { client } = await fixture(t);
  const project = (await client.create("projects", { title: "Wohnzimmer" }))
    .body;
  const other = (await client.create("projects", { title: "Gästezimmer" }))
    .body;
  let a = (
    await client.create("tasks", {
      title: "Abkleben",
      projectId: project.id,
      status: "done",
    })
  ).body;
  const b = (
    await client.create("tasks", {
      title: "Farbe mischen",
      projectId: project.id,
      status: "done",
    })
  ).body;
  let successor = (
    await client.create("tasks", {
      title: "Streichen",
      projectId: project.id,
      predecessorIds: [a.id, b.id],
      status: "active",
    })
  ).body;
  const reordered = await client.patch("tasks", successor, {
    predecessorIds: [b.id, a.id],
  });
  assert.equal(reordered.status, 200);
  successor = reordered.body;
  for (const fields of [
    { predecessorIds: [a.id] },
    { predecessorIds: [a.id], status: "blocked" },
  ])
    assert.equal(
      (await client.patch("tasks", successor, fields)).body.code,
      "TASK_DEPENDENCY_CONFLICT",
    );
  for (const fields of [
    { status: "open" },
    { archivedAt: new Date().toISOString() },
    { projectId: other.id },
  ]) {
    const rejected = await client.patch("tasks", a, fields);
    assert.equal(rejected.body.code, "TASK_DEPENDENCY_CONFLICT");
    assert.match(rejected.body.message, /Streichen/);
  }
  successor = (
    await client.patch("tasks", successor, {
      predecessorIds: [a.id],
      status: "open",
    })
  ).body;
  const reopened = await client.patch("tasks", a, { status: "open" });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.completedBy, null);
  a = reopened.body;
  assert.equal(
    (await client.patch("tasks", successor, { status: "active" })).body.code,
    "TASK_NOT_READY",
  );
  assert.equal(
    (await client.patch("tasks", a, { archivedAt: new Date().toISOString() }))
      .body.code,
    "TASK_DEPENDENCY_CONFLICT",
  );
  assert.equal(
    (await client.patch("tasks", a, { projectId: other.id })).body.code,
    "TASK_DEPENDENCY_CONFLICT",
  );
  successor = (
    await client.patch("tasks", successor, {
      archivedAt: new Date().toISOString(),
    })
  ).body;
  const archived = await client.patch("tasks", a, {
    archivedAt: new Date().toISOString(),
  });
  assert.equal(archived.status, 200);
  a = archived.body;
  assert.equal(
    (await client.patch("tasks", successor, { archivedAt: null })).body.code,
    "TASK_DEPENDENCY_CONFLICT",
  );
  assert.equal(
    (
      await client.create("tasks", {
        title: "Archiv ist nicht erledigt",
        projectId: project.id,
        predecessorIds: [a.id],
      })
    ).body.code,
    "TASK_DEPENDENCY_CONFLICT",
  );
  a = (await client.patch("tasks", a, { archivedAt: null })).body;
  assert.equal(
    (await client.patch("tasks", successor, { archivedAt: null })).status,
    200,
  );
});

test("two devices validate fresh dependency state and preserve optimistic record conflicts", async (t) => {
  const { client: karla, newClient } = await fixture(t);
  const marvin = newClient();
  await marvin.send("GET", "/api/session");
  await marvin.choose("marvin");
  const project = (await karla.create("projects", { title: "Boden" })).body;
  let predecessor = (
    await karla.create("tasks", {
      title: "Untergrund",
      projectId: project.id,
      status: "done",
    })
  ).body;
  let successor = (
    await karla.create("tasks", {
      title: "Parkett legen",
      projectId: project.id,
      predecessorIds: [predecessor.id],
    })
  ).body;
  predecessor = (await marvin.patch("tasks", predecessor, { status: "open" }))
    .body;
  assert.equal(
    (await karla.patch("tasks", successor, { status: "active" })).body.code,
    "TASK_NOT_READY",
  );
  predecessor = (await marvin.patch("tasks", predecessor, { status: "done" }))
    .body;
  const staleSuccessor = successor;
  successor = (await karla.patch("tasks", successor, { status: "done" })).body;
  assert.equal(successor.completedBy, "karla");
  const stale = await marvin.patch("tasks", staleSuccessor, {
    predecessorIds: [],
    status: "open",
  });
  assert.equal(stale.body.code, "VERSION_CONFLICT");
  assert.equal(stale.body.record.status, "done");
  const reopen = await marvin.patch("tasks", predecessor, { status: "open" });
  assert.equal(reopen.body.code, "TASK_DEPENDENCY_CONFLICT");
  assert.match(reopen.body.message, /Parkett legen/);
  assert.equal(
    (await marvin.patch("tasks", successor, { predecessorIds: [] })).body.code,
    "TASK_DEPENDENCY_CONFLICT",
  );
  const explicitlyReopened = await marvin.patch("tasks", successor, {
    predecessorIds: [],
    status: "open",
  });
  assert.equal(explicitlyReopened.status, 200);
  assert.equal(explicitlyReopened.body.completedBy, null);
  assert.equal(explicitlyReopened.body.updatedBy, "marvin");
});

test("project moves resolve equal and adjacent floating-point ranks atomically without changing excluded projects", async (t) => {
  const { ctx, client: karla, newClient } = await fixture(t);
  const marvin = newClient();
  await marvin.send("GET", "/api/session");
  await marvin.choose("marvin");
  const first = (
    await karla.create("projects", { title: "Küche", status: "idea" })
  ).body;
  const second = (await karla.create("projects", { title: "Bad" })).body;
  const third = (await karla.create("projects", { title: "Flur" })).body;
  const underway = (
    await karla.create("projects", {
      title: "Schon in Arbeit",
      status: "active",
    })
  ).body;
  const archived = (await karla.create("projects", { title: "Archiviert" }))
    .body;
  const archivedRecord = (
    await karla.patch("projects", archived, {
      archivedAt: new Date().toISOString(),
    })
  ).body;
  const originalOrder = [first.id, second.id, third.id];
  const moved = await marvin.send("POST", `/api/projects/${third.id}/move`, {
    direction: "up",
    version: third.version,
    profileVersion: marvin.profileVersion,
    expectedOrder: originalOrder,
  });
  assert.equal(moved.status, 200);
  assert.deepEqual(
    moved.body.map((project: any) => project.id),
    [first.id, third.id, second.id],
  );
  assert.deepEqual(
    moved.body.map((project: any) => project.rank),
    [1024, 2048, 3072],
  );
  for (const project of moved.body) {
    assert.equal(project.createdBy, "karla");
    assert.equal(project.updatedBy, "marvin");
    assert.equal(project.version, 2);
  }
  assert.deepEqual(ctx.db.get("projects", underway.id), underway);
  assert.deepEqual(ctx.db.get("projects", archived.id), archivedRecord);
  const stale = await karla.send("POST", `/api/projects/${second.id}/move`, {
    direction: "up",
    version: second.version,
    profileVersion: karla.profileVersion,
    expectedOrder: originalOrder,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "VERSION_CONFLICT");
  assert.equal(stale.body.record.version, 2);

  // Drei aufeinanderfolgende darstellbare Zahlen lassen keinen weiteren Mittelwert dazwischen zu.
  const compressed = [];
  for (const [index, project] of moved.body.entries()) {
    const patched = await marvin.patch("projects", project, {
      rank: 1 + index * Number.EPSILON,
    });
    assert.equal(patched.status, 200);
    compressed.push(patched.body);
  }
  const normalized = await marvin.send(
    "POST",
    `/api/projects/${compressed[2].id}/move`,
    {
      direction: "up",
      version: compressed[2].version,
      profileVersion: marvin.profileVersion,
      expectedOrder: compressed.map((project) => project.id),
    },
  );
  assert.equal(normalized.status, 200);
  assert.deepEqual(
    normalized.body.map((project: any) => project.id),
    [first.id, second.id, third.id],
  );
  assert.deepEqual(
    normalized.body.map((project: any) => project.rank),
    [1024, 2048, 3072],
  );
  const boundary = await marvin.send(
    "POST",
    `/api/projects/${normalized.body[0].id}/move`,
    {
      direction: "up",
      version: normalized.body[0].version,
      profileVersion: marvin.profileVersion,
      expectedOrder: originalOrder,
    },
  );
  assert.equal(boundary.status, 200);
  assert.deepEqual(boundary.body, normalized.body);

  const tiedThird = (
    await karla.patch("projects", normalized.body[2], {
      rank: normalized.body[1].rank,
    })
  ).body;
  const sameNumericRank = await marvin.send(
    "POST",
    `/api/projects/${tiedThird.id}/move`,
    {
      direction: "up",
      version: tiedThird.version,
      profileVersion: marvin.profileVersion,
      expectedOrder: originalOrder,
    },
  );
  assert.equal(sameNumericRank.status, 200);
  const movedTarget = sameNumericRank.body.find(
    (entry: any) => entry.id === tiedThird.id,
  );
  assert.equal(movedTarget.rank, tiedThird.rank);
  assert.equal(movedTarget.version, tiedThird.version + 1);
  assert.equal(movedTarget.updatedBy, "marvin");
  assert.deepEqual(ctx.db.get("projects", tiedThird.id), movedTarget);
});

test("concurrent project moves, new projects and stale form versions cannot silently replace the shared order", async (t) => {
  const { client, newClient } = await fixture(t);
  const other = newClient();
  await other.send("GET", "/api/session");
  await other.choose("marvin");
  const projects = [];
  for (const title of [
    "Erstes Vorhaben",
    "Zweites Vorhaben",
    "Drittes Vorhaben",
  ])
    projects.push((await client.create("projects", { title })).body);
  const expectedOrder = projects.map((project) => project.id);
  const results = await Promise.all([
    client.send("POST", `/api/projects/${projects[0].id}/move`, {
      direction: "down",
      version: projects[0].version,
      profileVersion: client.profileVersion,
      expectedOrder,
    }),
    other.send("POST", `/api/projects/${projects[2].id}/move`, {
      direction: "up",
      version: projects[2].version,
      profileVersion: other.profileVersion,
      expectedOrder,
    }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    results.find((result) => result.status === 409)!.body.code,
    "VERSION_CONFLICT",
  );
  const latest = results.find((result) => result.status === 200)!.body;
  assert.equal(
    (
      await client.patch("projects", projects[0], {
        title: "Alter Formularstand",
      })
    ).body.code,
    "VERSION_CONFLICT",
  );
  await other.create("projects", { title: "Zwischenzeitlich ergänzt" });
  const changedMembership = await client.send(
    "POST",
    `/api/projects/${latest[0].id}/move`,
    {
      direction: "down",
      version: latest[0].version,
      profileVersion: client.profileVersion,
      expectedOrder: latest.map((project: any) => project.id),
    },
  );
  assert.equal(changedMembership.body.code, "VERSION_CONFLICT");
  assert.equal(
    (await client.send("GET", "/api/state")).body.projects.length,
    4,
  );
  assert.equal(
    (
      await client.send(
        "POST",
        `/api/projects/${latest[0].id}/move`,
        {
          direction: "down",
          version: latest[0].version,
          profileVersion: client.profileVersion,
          expectedOrder: latest.map((project: any) => project.id),
        },
        { csrf: false },
      )
    ).body.code,
    "CSRF",
  );
  assert.equal(
    (
      await client.send("POST", `/api/projects/${latest[0].id}/move`, {
        direction: "down",
        version: latest[0].version,
        profileVersion: client.profileVersion - 1,
        expectedOrder: latest.map((project: any) => project.id),
      })
    ).body.code,
    "PROFILE_CHANGED",
  );
});

test("project room changes protect live and archived references and provide a workable resolution", async (t) => {
  const { client } = await fixture(t);
  const oldRoom = (await client.create("rooms", { title: "Alter Raum" })).body;
  const newRoom = (await client.create("rooms", { title: "Neuer Raum" })).body;
  let project = (
    await client.create("projects", { title: "Vorhaben", roomId: oldRoom.id })
  ).body;
  let task = (
    await client.create("tasks", {
      title: "Vorbereitung",
      roomId: oldRoom.id,
      projectId: project.id,
    })
  ).body;
  let defect = (
    await client.create("defects", {
      title: "Alter Befund",
      roomId: oldRoom.id,
      projectId: project.id,
    })
  ).body;
  defect = (
    await client.patch("defects", defect, {
      archivedAt: new Date().toISOString(),
    })
  ).body;
  const rejected = await client.patch("projects", project, {
    roomId: newRoom.id,
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "PROJECT_ROOM_CONFLICT");
  assert.match(rejected.body.message, /Vorbereitung/);
  assert.match(rejected.body.message, /Alter Befund.*archiviert/);
  assert.match(rejected.body.message, /Allgemein im Haus/);
  const completed = await client.patch("tasks", task, { status: "done" });
  assert.equal(
    completed.status,
    200,
    "Der abgelehnte Raumwechsel darf die Aufgabe nicht beschädigen.",
  );
  task = completed.body;
  project = (await client.patch("projects", project, { roomId: null })).body;
  assert.equal(
    (await client.patch("projects", project, { roomId: newRoom.id })).body.code,
    "PROJECT_ROOM_CONFLICT",
  );
  task = (await client.patch("tasks", task, { roomId: null })).body;
  defect = (await client.patch("defects", defect, { roomId: null })).body;
  const moved = await client.patch("projects", project, { roomId: newRoom.id });
  assert.equal(moved.status, 200);
  assert.equal(task.projectId, project.id);
  assert.equal(defect.projectId, project.id);
  const restored = await client.patch("defects", defect, {
    archivedAt: null,
    roomId: newRoom.id,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.projectId, project.id);
  assert.equal(restored.body.status, "open");
});

test("room and project archives preserve household tasks, purchases, defects and manual notes", async (t) => {
  const { client: karla, newClient } = await fixture(t);
  const marvin = newClient();
  await marvin.send("GET", "/api/session");
  await marvin.choose("marvin");
  const room = (await karla.create("rooms", { title: "Werkstatt" })).body;
  let project = (
    await karla.create("projects", {
      title: "Werkstatt ordnen",
      roomId: room.id,
    })
  ).body;
  const defect = (
    await karla.create("defects", {
      title: "Lockeres Regal",
      roomId: room.id,
      projectId: project.id,
      assignees: ["karla", "marvin"],
    })
  ).body;
  const task = (
    await karla.create("tasks", {
      title: "Regal befestigen",
      roomId: room.id,
      projectId: project.id,
      defectId: defect.id,
    })
  ).body;
  const householdTask = (
    await marvin.create("tasks", { title: "Allgemeine Hausarbeit" })
  ).body;
  const purchase = (
    await karla.create("shopping", {
      title: "Dübel",
      projectId: project.id,
      quantity: 4,
      unit: "Stück",
      unitPriceCents: 25,
    })
  ).body;
  let note = (
    await karla.create("notes", {
      projectId: project.id,
      body: "Passende Dübel prüfen",
    })
  ).body;
  note = (
    await marvin.patch("notes", note, {
      body: "Dübel für die vorhandene Wand auswählen",
    })
  ).body;
  const completed = (await marvin.patch("tasks", task, { status: "done" }))
    .body;
  const bought = (await marvin.patch("shopping", purchase, { purchased: true }))
    .body;
  assert.equal(completed.completedBy, "marvin");
  assert.equal(completed.createdBy, "karla");
  assert.equal(bought.purchasedBy, "marvin");
  assert.equal(note.createdBy, "karla");
  assert.equal(note.updatedBy, "marvin");
  const archivedRoom = (
    await karla.patch("rooms", room, { archivedAt: new Date().toISOString() })
  ).body;
  project = (
    await karla.patch("projects", project, {
      archivedAt: new Date().toISOString(),
    })
  ).body;
  const state = (await marvin.send("GET", "/api/state")).body;
  assert.equal(state.tasks.length, 2);
  assert.equal(
    state.tasks.find((entry: any) => entry.id === householdTask.id).projectId,
    null,
  );
  assert.equal(
    state.tasks.find((entry: any) => entry.id === task.id).archivedAt,
    null,
  );
  assert.equal(
    state.defects.find((entry: any) => entry.id === defect.id).status,
    "open",
    "Die erledigte Herkunftsaufgabe behebt den Mangel nicht automatisch.",
  );
  assert.equal(
    state.shopping.find((entry: any) => entry.id === purchase.id).purchasedBy,
    "marvin",
  );
  assert.equal(
    state.notes.find((entry: any) => entry.id === note.id).body,
    note.body,
  );
  const restoredRoom = await marvin.patch("rooms", archivedRoom, {
    archivedAt: null,
  });
  const restoredProject = await marvin.patch("projects", project, {
    archivedAt: null,
  });
  assert.equal(restoredRoom.status, 200);
  assert.equal(restoredProject.status, 200);
  assert.equal(restoredProject.body.roomId, room.id);
  assert.equal(restoredProject.body.createdBy, "karla");
  assert.equal(restoredProject.body.updatedBy, "marvin");
});
