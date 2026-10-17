import test from "node:test";
import assert from "node:assert/strict";

import { createBackground } from "../lib/background.js";
import { createSyncEngine } from "../sync/engine.js";
import { createCatalog } from "../storage/catalog.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function jsonResponse(status, body, headers = {}) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    retryAfter: lower["retry-after"] ?? null,
    headers: { get: (key) => lower[String(key).toLowerCase()] ?? null },
    json: async () => body ?? {},
    text: async () => JSON.stringify(body ?? {}),
  };
}

function createFetchMock(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses].filter(Boolean);
  async function fetch(url, init) {
    calls.push({ url: String(url), init });
    const next = queue.shift() || { status: 200, body: {} };
    return jsonResponse(next.status, next.body, next.headers);
  }
  return { calls, fetch };
}

function createRecordingClient(handler) {
  const calls = [];
  function record(op, token, extra) {
    calls.push({ op, token, ...extra });
  }
  return {
    calls,
    async push(token, records) {
      record("push", token, { records });
      return handler.push(records, token, calls);
    },
    async pull(token) {
      record("pull", token);
      return handler.pull(token, calls);
    },
    async logout(token) {
      record("logout", token);
      return handler.logout ? handler.logout(token, calls) : jsonResponse(204, null);
    },
    async login(creds) {
      record("login", null, { creds });
      return handler.login(creds, calls);
    },
    async signup(creds) {
      record("signup", null, { creds });
      return handler.signup(creds, calls);
    },
  };
}

test("login with local catalog -> push sends local records and server confirms", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const fetchMock = createFetchMock([
    { status: 200, body: { token: "t1" } },
    { status: 200, body: { merged: 0 } },
    { status: 200, body: { records: [] } },
  ]);
  const bg = createBackground({ browser, now: () => 1000, fetch: fetchMock.fetch });
  await bg.ready;

  await storage.set({
    catalog: { v1: { videoId: "v1", watched: true, watchedAt: 500, neverSkip: false, neverSkipAt: 0 } },
  });

  await browser.runtime.onMessage.fire({ type: "account-login", email: "test@test.com", password: "secret1234" });
  await flush();

  const pushCall = fetchMock.calls.find((c) => c.url.includes("/v1/sync/push"));
  assert.ok(pushCall, "push was sent");
  const body = JSON.parse(pushCall.init.body);
  assert.equal(body.records.length, 1);
  assert.equal(body.records[0].videoId, "v1");
  assert.equal(body.records[0].watched, true);
});

test("server returns a new video in full-state -> local catalog starts skipping it", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const fetchMock = createFetchMock([
    { status: 200, body: { token: "t1" } },
    { status: 200, body: { merged: 1 } },
    {
      status: 200,
      body: {
        records: [{ videoId: "v2", watched: true, watchedAt: 200, neverSkip: false, neverSkipAt: 0 }],
      },
    },
  ]);
  const bg = createBackground({ browser, now: () => 1000, fetch: fetchMock.fetch });
  await bg.ready;
  await browser.runtime.onMessage.fire({ type: "account-login", email: "test@test.com", password: "secret1234" });
  await flush();

  assert.equal(await bg.catalog.shouldSkip("v2"), true);
});

test("no network during sync -> local skip/record still work; next trigger recovers", async () => {
  const storage = createMemoryStorage();
  const catalog = createCatalog(storage);
  let failing = true;
  const client = createRecordingClient({
    push: () => (failing ? jsonResponse(0, {}) : jsonResponse(200, { merged: 1 })),
    pull: () =>
      failing
        ? jsonResponse(0, {})
        : jsonResponse(200, { records: [{ videoId: "v2", watched: true, watchedAt: 1, neverSkip: false, neverSkipAt: 0 }] }),
  });
  const engine = createSyncEngine({ catalog, client });

  await catalog.markWatched("v1", 5);
  engine.start("t1");
  await flush();

  assert.equal(await catalog.shouldSkip("v1"), true, "local skip intact after network failure");
  assert.equal(await catalog.get("v2"), null, "pull did not apply while offline");

  failing = false;
  await engine.trigger();
  await flush();

  assert.equal(await catalog.shouldSkip("v2"), true, "next trigger recovers");
});

test("expired/revoked token -> sync stops, no 401 loop, local behavior unchanged", async () => {
  const storage = createMemoryStorage();
  const catalog = createCatalog(storage);
  let pushCount = 0;
  const client = createRecordingClient({
    push: () => {
      pushCount += 1;
      return jsonResponse(401, {});
    },
    pull: () => jsonResponse(200, { records: [] }),
  });
  let unauthorized = 0;
  const engine = createSyncEngine({ catalog, client, onUnauthorized: () => { unauthorized += 1; } });

  await catalog.markWatched("v1", 5);
  engine.start("t1");
  await flush();
  await engine.trigger();
  await engine.trigger();
  await flush();

  assert.equal(engine.isActive(), false, "engine stops on 401");
  assert.equal(unauthorized, 1, "onUnauthorized fired once");
  assert.equal(pushCount, 1, "no 401 retry loop");
  assert.equal(await catalog.shouldSkip("v1"), true, "local behavior unchanged");
});

test("background marks the options session expired on a 401 sync", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const fetchMock = createFetchMock([
    { status: 200, body: { token: "t1" } },
    { status: 401, body: {} },
  ]);
  const bg = createBackground({ browser, now: () => 1000, fetch: fetchMock.fetch });
  await bg.ready;
  await browser.runtime.onMessage.fire({ type: "account-login", email: "test@test.com", password: "secret1234" });
  await flush();

  const status = await browser.runtime.onMessage.fire({ type: "account-status" });
  assert.equal(status[0].sessionActive, false);
  assert.equal(status[0].expired, true);
  assert.deepEqual(await storage.get("auth.token"), {}, "token cleared from storage");
});

test("wrong credential (401) -> distinct feedback, UI not stuck", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000 });
  await bg.ready;
  bg.syncClient.login = async () => jsonResponse(401, {});
  const res = await browser.runtime.onMessage.fire({ type: "account-login", email: "bad", password: "badbadbadbad" });
  assert.equal(res[0].ok, false);
  assert.equal(res[0].status, 401);
  assert.equal(res[0].code, "invalid_credentials");
});

test("rate limit (429) -> distinct feedback with retry-after", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000 });
  await bg.ready;
  bg.syncClient.login = async () => jsonResponse(429, {}, { "Retry-After": "5" });
  const res = await browser.runtime.onMessage.fire({ type: "account-login", email: "bad", password: "badbadbadbad" });
  assert.equal(res[0].status, 429);
  assert.equal(res[0].retryAfter, "5");
});

test("signup disabled (403) -> distinct feedback", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000 });
  await bg.ready;
  bg.syncClient.signup = async () => jsonResponse(403, {});
  const res = await browser.runtime.onMessage.fire({ type: "account-signup", email: "bad", password: "badbadbadbad" });
  assert.equal(res[0].status, 403);
  assert.equal(res[0].code, "signup_not_allowed");
});

test("network error on account action -> reported, no crash", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000, fetch: async () => { throw new Error("offline"); } });
  await bg.ready;
  const res = await browser.runtime.onMessage.fire({ type: "account-login", email: "a", password: "secret1234" });
  assert.equal(res[0].ok, false);
  assert.equal(res[0].status, 0);
});

test("event-page suspension between push and response -> next trigger retries and converges", async () => {
  const storage = createMemoryStorage();
  const catalog = createCatalog(storage);

  const hangingClient = createRecordingClient({
    push: () => new Promise(() => {}),
    pull: () => jsonResponse(200, { records: [] }),
  });
  const firstEngine = createSyncEngine({ catalog, client: hangingClient });
  await catalog.markWatched("v1", 5);
  firstEngine.start("t1");
  await flush();

  const recoveringClient = createRecordingClient({
    push: () => jsonResponse(200, { merged: 1 }),
    pull: () =>
      jsonResponse(200, {
        records: [{ videoId: "v1", watched: true, watchedAt: 5, neverSkip: false, neverSkipAt: 0 }],
      }),
  });
  const secondEngine = createSyncEngine({ catalog, client: recoveringClient });
  secondEngine.start("t1");
  await flush();

  assert.equal(recoveringClient.calls.filter((c) => c.op === "push").length, 1, "push resent after suspension");
  assert.equal(recoveringClient.calls.find((c) => c.op === "push").records.length, 1);
  assert.equal(await catalog.shouldSkip("v1"), true, "converged");
});

test("concurrent triggers during an in-flight cycle are coalesced", async () => {
  const storage = createMemoryStorage();
  const catalog = createCatalog(storage);
  let resolvePush;
  let pushCount = 0;
  const client = createRecordingClient({
    push: () => {
      pushCount += 1;
      if (pushCount === 1) {
        return new Promise((resolve) => {
          resolvePush = () => resolve(jsonResponse(200, { merged: 0 }));
        });
      }
      return jsonResponse(200, { merged: 0 });
    },
    pull: () => jsonResponse(200, { records: [] }),
  });
  const engine = createSyncEngine({ catalog, client });
  engine.start("t1");
  await tick();

  await engine.trigger();
  await engine.trigger();
  await engine.trigger();

  assert.equal(pushCount, 1, "still only the in-flight push");
  resolvePush();
  await flush();

  assert.equal(pushCount, 2, "exactly one coalesced follow-up cycle");
});

test("logout -> cycle stops; local records remain and still skip (AE7/R10)", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000 });
  await bg.ready;
  await bg.catalog.markWatched("v1", 1);
  bg.syncEngine.start("t1");
  assert.equal(bg.syncEngine.isActive(), true);

  await browser.runtime.onMessage.fire({ type: "account-logout" });

  assert.equal(bg.syncEngine.isActive(), false);
  assert.equal(await bg.catalog.shouldSkip("v1"), true);
  assert.equal((await storage.get("auth.token"))["auth.token"], undefined);
});

test("device with no login -> NO network call is made (AE6)", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const fetchMock = createFetchMock([]);
  const bg = createBackground({ browser, now: () => 1000, fetch: fetchMock.fetch });
  await bg.ready;

  await bg.catalog.markWatched("v1", 1);
  await bg.syncEngine.trigger();
  await bg.triggerSync();
  await flush();

  assert.equal(fetchMock.calls.length, 0);
});

test("token only travels in the Authorization header, never in a URL or a log", async () => {
  const storage = createMemoryStorage();
  const catalog = createCatalog(storage);
  const SECRET = "opaque-token-abcdef";
  const fetchMock = createFetchMock([
    { status: 200, body: { merged: 0 } },
    { status: 200, body: { records: [] } },
  ]);
  const client = createRecordingClient({
    push: () => jsonResponse(200, { merged: 0 }),
    pull: () => jsonResponse(200, { records: [] }),
  });
  const engine = createSyncEngine({ catalog, client });
  await catalog.markWatched("v1", 1);
  engine.start(SECRET);
  await flush();
  await engine.trigger();
  await flush();

  for (const call of client.calls) {
    assert.equal(call.token, SECRET, "token is passed out-of-band to the client");
  }

  const bg = createBackground({ browser: createFakeBrowser(), now: () => 1000, fetch: fetchMock.fetch });
  await bg.ready;
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  try {
    await bg.syncClient.push(SECRET, [{ videoId: "v1", watched: true, watchedAt: 1, neverSkip: false, neverSkipAt: 0 }]);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.ok(fetchMock.calls.length >= 1);
  const call = fetchMock.calls[0];
  assert.equal(call.init.headers.Authorization, `Bearer ${SECRET}`, "token travels in the header");
  assert.equal(String(call.url).includes(SECRET), false, "token not in URL");
  assert.equal(logs.some((l) => l.includes(SECRET)), false, "token not in logs");
});

test("pull merge preserves zero watchedAt for unwatched record with neverSkip", async () => {
  const storage = createMemoryStorage();
  const catalog = createCatalog(storage);
  const client = createRecordingClient({
    push: () => jsonResponse(200, { merged: 0 }),
    pull: () =>
      jsonResponse(200, {
        records: [
          {
            videoId: "v3",
            watched: false,
            watchedAt: 0,
            neverSkip: true,
            neverSkipAt: 1500,
            updatedAt: 1500,
          },
        ],
      }),
  });
  const engine = createSyncEngine({ catalog, client });
  engine.start("token-xyz");
  await flush();

  const record = await catalog.get("v3");
  assert.ok(record, "record stored");
  assert.equal(record.watched, false);
  assert.equal(record.watchedAt, 0, "watchedAt must stay 0 when watched is false");
  assert.equal(record.neverSkip, true);
  assert.equal(record.neverSkipAt, 1500);
});

test("mark-never-skip triggers sync when logged in", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const fetchMock = createFetchMock([
    { status: 200, body: { merged: 1 } },
    { status: 200, body: { records: [] } },
  ]);
  const bg = createBackground({ browser, now: () => 1000, fetch: fetchMock.fetch });
  await bg.ready;
  bg.syncEngine.setToken("valid-token");

  // Mock tab url
  browser.tabs.get = async () => ({ id: 1, url: "https://www.youtube.com/watch?v=never1" });
  await browser.runtime.onMessage.fire(
    { type: "mark-never-skip" },
    { tab: { id: 1 } }
  );
  await flush();

  assert.equal(await bg.catalog.get("never1").then((r) => r.neverSkip), true);
  assert.ok(fetchMock.calls.some((c) => c.url.includes("/v1/sync/push")), "push was triggered");
});

test("syncEngine pushes records in chunks of 500 when local catalog exceeds batch limit", async () => {
  const storage = createMemoryStorage();
  const catalog = createCatalog(storage);
  const pushBatches = [];

  const client = {
    async push(token, records) {
      pushBatches.push(records);
      return jsonResponse(200, { merged: records.length });
    },
    async pull() {
      return jsonResponse(200, { records: [] });
    },
  };

  const videoIds = Array.from({ length: 750 }, (_, i) => `vid${String(i).padStart(4, "0")}`);
  await catalog.bulkMarkWatched(videoIds, 1000);

  const engine = createSyncEngine({ catalog, client });
  engine.setToken("token-abc");

  const res = await engine.trigger();
  assert.equal(res.ok, true);
  assert.equal(pushBatches.length, 2);
  assert.equal(pushBatches[0].length, 500);
  assert.equal(pushBatches[1].length, 250);
});

