import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { api, hasSameAuthorContext } from "../src/api.js";
import { profiles, type Session } from "../shared/types.js";

test("author context requires the same device session, profile and profile version", () => {
  const opened: Session = {
    csrfToken: "synthetic-session-a",
    profileId: "karla",
    profileVersion: 1,
    profiles,
  };
  assert.equal(hasSameAuthorContext(opened, { ...opened }), true);
  assert.equal(
    hasSameAuthorContext(opened, {
      ...opened,
      csrfToken: "synthetic-session-b",
    }),
    false,
  );
  assert.equal(
    hasSameAuthorContext(opened, { ...opened, profileVersion: 2 }),
    false,
  );
  assert.equal(
    hasSameAuthorContext(opened, { ...opened, profileId: "marvin" }),
    false,
  );
  assert.equal(
    hasSameAuthorContext(opened, { ...opened, profileId: null }),
    false,
  );
});

test("real session resets cannot reuse a form author even when the profile version repeats", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "uz-frontend-session-"));
  const ctx = createApp({ dataDir: dir, secureCookies: false });
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const nativeFetch = globalThis.fetch;
  let cookie = "";
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  /** Ergänzt ausschließlich Browsertransport: relative App-Adresse, Herkunft und aktuelles Sitzungscookie. Die produktive API- und Kontextprüfung laufen unverändert. */
  const browserFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", base);
    if (cookie) headers.set("Cookie", cookie);
    const response = await nativeFetch(new URL(String(input), base), {
      ...init,
      headers,
    });
    const nextCookie = response.headers.get("set-cookie");
    if (nextCookie) cookie = nextCookie.split(";")[0];
    return response;
  };
  t.mock.method(globalThis, "fetch", browserFetch);

  const entry = await api<Session>("/session");
  const opened = await api<Session>("/profile", {
    method: "POST",
    session: entry,
    body: { profileId: "karla", profileVersion: entry.profileVersion },
  });
  assert.equal(
    hasSameAuthorContext(opened, await api<Session>("/session")),
    true,
  );

  const reset = await api<Session>("/session", {
    method: "DELETE",
    session: opened,
  });
  const switched = await api<Session>("/profile", {
    method: "POST",
    session: reset,
    body: { profileId: "marvin", profileVersion: reset.profileVersion },
  });
  assert.equal(switched.profileVersion, opened.profileVersion);
  assert.notEqual(switched.csrfToken, opened.csrfToken);
  assert.equal(hasSameAuthorContext(opened, switched), false);

  const resetAgain = await api<Session>("/session", {
    method: "DELETE",
    session: switched,
  });
  const samePerson = await api<Session>("/profile", {
    method: "POST",
    session: resetAgain,
    body: { profileId: "karla", profileVersion: resetAgain.profileVersion },
  });
  assert.equal(samePerson.profileId, opened.profileId);
  assert.equal(samePerson.profileVersion, opened.profileVersion);
  assert.equal(hasSameAuthorContext(opened, samePerson), false);

  const samePersonChosenAgain = await api<Session>("/profile", {
    method: "POST",
    session: samePerson,
    body: { profileId: "karla", profileVersion: samePerson.profileVersion },
  });
  assert.equal(samePersonChosenAgain.csrfToken, samePerson.csrfToken);
  assert.equal(hasSameAuthorContext(samePerson, samePersonChosenAgain), false);
});
