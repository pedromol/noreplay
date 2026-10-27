import test from "node:test";
import assert from "node:assert/strict";

import { createBackground } from "../lib/background.js";
import { createSyncCatalog } from "../storage/sync-catalog.js";
import { CATALOG_KEY } from "../storage/catalog.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";
import { createEventHook } from "./helpers/fake-browser.js";
const flush = () => new Promise((r) => setTimeout(r, 30));

function makeStorage() {
  const local = createMemoryStorage();
  const sync = createMemoryStorage();
  const onChanged = createEventHook();
  const browser = createFakeBrowser();
  browser.storage.local = local;
  browser.storage.sync = sync;
  browser.storage.onChanged = onChanged;
  return { browser, local, sync, onChanged };
}

test("triggerSync is a no-op returning ok", async () => {
  const { browser } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;
  const res = await bg.triggerSync();
  assert.deepEqual(res, { ok: true });
});

test("catalog writes to both sync and local storage", async () => {
  const { browser, local, sync } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  await bg.catalog.markWatched("vid1", 1000);
  await bg.catalog.markNeverSkip("vid2", 2000);

  const localData = await local.get(CATALOG_KEY);
  const syncData = await sync.get(CATALOG_KEY);

  assert.equal(localData[CATALOG_KEY].vid1.watched, true);
  assert.equal(localData[CATALOG_KEY].vid1.watchedAt, 1000);
  assert.equal(localData[CATALOG_KEY].vid2.neverSkip, true);
  assert.equal(localData[CATALOG_KEY].vid2.neverSkipAt, 2000);

  assert.equal(syncData[CATALOG_KEY].vid1.watched, true);
  assert.equal(syncData[CATALOG_KEY].vid2.neverSkip, true);
});

test("catalog readAll prefers sync storage", async () => {
  const { browser, local, sync } = makeStorage();
  const catalog = createSyncCatalog({ browser, localStorage: local, syncStorage: sync });
  await catalog.markWatched("vid1", 1000);

  const all = await catalog.list();
  const loaded = Object.fromEntries(all.map(r=>[r.videoId,r]));
  assert.equal(loaded.vid1.watched, true);
});

test("catalog falls back to local when sync is missing", async () => {
  const { browser, local } = makeStorage();
  delete browser.storage.sync;
  const catalog = createSyncCatalog({ browser, localStorage: local });
  await catalog.markWatched("vid1", 1000);
  const all = await catalog.list();
  const loaded = Object.fromEntries(all.map(r=>[r.videoId,r]));
  assert.equal(loaded.vid1.watched, true);
});

test("storage.onChanged sync listener merges remote watched state monotonic OR", async () => {
  const { browser, onChanged } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  await bg.catalog.markWatched("vid1", 1000);

  const remoteCatalog = {
    vid1: { watched: true, watchedAt: 2000 },
    vid2: { watched: true, watchedAt: 1500 },
  };

  const listener = onChanged.listeners[0].listener;
  await listener({ [CATALOG_KEY]: { newValue: remoteCatalog } }, "sync");
  await flush();

  const all = await bg.catalog.list();
  const merged = Object.fromEntries(all.map(r=>[r.videoId,r]));
  assert.equal(merged.vid1.watched, true);
  assert.equal(merged.vid1.watchedAt, 2000); // max(1000, 2000)
  assert.equal(merged.vid2.watched, true);
  assert.equal(merged.vid2.watchedAt, 1500);
});

test("storage.onChanged sync listener merges remote neverSkip monotonic OR", async () => {
  const { browser, onChanged } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const remoteCatalog = {
    vid1: { neverSkip: true, neverSkipAt: 3000 },
  };

  const listener = onChanged.listeners[0].listener;
  await listener({ [CATALOG_KEY]: { newValue: remoteCatalog } }, "sync");
  await flush();

  const all = await bg.catalog.list();
  const merged = Object.fromEntries(all.map(r=>[r.videoId,r]));
  assert.equal(merged.vid1.neverSkip, true);
  assert.equal(merged.vid1.neverSkipAt, 3000);
});
test("storage.onChanged ignores changes from local area", async () => {
  const { browser, onChanged } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const remoteCatalog = { vid1: { watched: true } };

  const listener = onChanged.listeners[0].listener;
  await listener({ [CATALOG_KEY]: { newValue: remoteCatalog } }, "local");
  await flush();

  const all = await bg.catalog.list();
  const merged = Object.fromEntries(all.map(r=>[r.videoId,r]));
  assert.equal(merged.vid1, undefined);
});

test("account handlers are sync-disabled stubs", async () => {
  const { browser } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const status = (await browser.runtime.onMessage.fire({ type: "account-status" }))[0];
  assert.deepEqual(status, { sessionActive: false, expired: false });

  const login = (await browser.runtime.onMessage.fire({
    type: "account-login",
    email: "a@b.c",
    password: "password123",
  }))[0];
  assert.equal(login.ok, false);
  assert.equal(login.status, 403);
  assert.equal(login.code, "sync_disabled");

  const signup = (await browser.runtime.onMessage.fire({
    type: "account-signup",
    email: "a@b.c",
    password: "password123",
  }))[0];
  assert.equal(signup.ok, false);
  assert.equal(signup.status, 403);
  assert.equal(signup.code, "sync_disabled");

  const logout = (await browser.runtime.onMessage.fire({ type: "account-logout" }))[0];
  assert.equal(logout.ok, true);
});

test("get-sync-config reports fixed default URL, no token", async () => {
  const { browser } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const config = (await browser.runtime.onMessage.fire({ type: "get-sync-config" }))[0];
  assert.equal(config.baseUrl, "https://noreplay.local/");
  assert.equal(config.hasToken, false);
});

test("set-server-url returns ok but always default URL", async () => {
  const { browser } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const set = (await browser.runtime.onMessage.fire({
    type: "set-server-url",
    baseUrl: "https://my-server.example.com",
  }))[0];
  assert.equal(set.ok, true);
  assert.equal(set.baseUrl, "https://noreplay.local/");

  const config = (await browser.runtime.onMessage.fire({ type: "get-sync-config" }))[0];
  assert.equal(config.baseUrl, "https://noreplay.local/");
});

test("catalog CRUD methods work offline", async () => {
  const { browser } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  assert.equal(await bg.catalog.get("missing"), null);

  await bg.catalog.markWatched("vid1", 1000);
  assert.equal((await bg.catalog.get("vid1")).watched, true);
  assert.equal((await bg.catalog.get("vid1")).watchedAt, 1000);

  await bg.catalog.markNeverSkip("vid2", 2000);
  assert.equal((await bg.catalog.get("vid2")).neverSkip, true);

  await bg.catalog.clear();
  assert.equal(await bg.catalog.get("vid1"), null);
  assert.equal(await bg.catalog.get("vid2"), null);
});

test("message handlers work without any account/sync state", async () => {
  const { browser } = makeStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const start = (await browser.runtime.onMessage.fire({
    type: "start-history-import",
    targetCount: 10,
  }))[0];
  assert.equal(start.ok, true);

  const batch = (await browser.runtime.onMessage.fire(
    {
      type: "history-import-batch",
      videoIds: ["vid1abcdefg"],
    },
    { tab: { id: start.tabId } }
  ))[0];
  assert.equal(batch.ok, true);
  assert.equal(batch.importedCount, 1);

  const finish = (await browser.runtime.onMessage.fire({
    type: "history-import-finish",
  }))[0];
  assert.equal(finish.ok, true);

  const stats = (await browser.runtime.onMessage.fire({ type: "catalog-stats" }))[0];
  assert.equal(stats.total, 1);
  assert.equal(stats.watched, 1);
});
