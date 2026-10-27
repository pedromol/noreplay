import test from "node:test";
import assert from "node:assert/strict";

import { createBackground } from "../lib/background.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";
import {
  loadHideWatchedSetting,
  saveHideWatchedSetting,
  HIDE_WATCHED_KEY,
} from "../options/options.js";

test("background message contract used by the options page", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000 });
  await bg.ready;

  const res = await browser.runtime.onMessage.fire({ type: "start-history-import", targetCount: 100 });
  assert.equal(res[0].ok, true);
  assert.equal(res[0].targetCount, 100);
});

test("hide-watched setting defaults to true and persists boolean changes", async () => {
  const storage = createMemoryStorage();

  // TS3.1: Defaults to true when unset
  const initial = await loadHideWatchedSetting(storage);
  assert.equal(initial, true);

  // TS3.3: Saves false
  await saveHideWatchedSetting(storage, false);
  const stored = await storage.get(HIDE_WATCHED_KEY);
  assert.equal(stored[HIDE_WATCHED_KEY], false);

  // TS3.2: Loads false when stored
  const loadedFalse = await loadHideWatchedSetting(storage);
  assert.equal(loadedFalse, false);

  // Saves true again
  await saveHideWatchedSetting(storage, true);
  const loadedTrue = await loadHideWatchedSetting(storage);
  assert.equal(loadedTrue, true);
});

test("offline catalog management message contracts", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000 });
  await bg.ready;

  // 1. Initial stats (empty)
  let statsRes = await browser.runtime.onMessage.fire({ type: "catalog-stats" });
  assert.deepEqual(statsRes[0], { total: 0, watched: 0, neverSkip: 0 });

  // 2. Import records
  const importRes = await browser.runtime.onMessage.fire({
    type: "catalog-import",
    records: [
      { videoId: "abcdefghijk", watched: true, watchedAt: 500 },
      { videoId: "lmnopqrstuv", watched: false, neverSkip: true, neverSkipAt: 600 },
    ],
  });
  assert.equal(importRes[0].imported, 2);
  assert.equal(importRes[0].total, 2);

  // 3. Updated stats
  statsRes = await browser.runtime.onMessage.fire({ type: "catalog-stats" });
  assert.deepEqual(statsRes[0], { total: 2, watched: 1, neverSkip: 1 });

  // 4. Export records
  const exportRes = await browser.runtime.onMessage.fire({ type: "catalog-export" });
  assert.equal(exportRes[0].records.length, 2);

  // 5. Clear catalog
  const clearRes = await browser.runtime.onMessage.fire({ type: "catalog-clear" });
  assert.equal(clearRes[0].ok, true);
  statsRes = await browser.runtime.onMessage.fire({ type: "catalog-stats" });
  assert.deepEqual(statsRes[0], { total: 0, watched: 0, neverSkip: 0 });
});

test("admin and options messages are rejected when sent from web page tabs", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const tabId = 99;
  browser.setTab(tabId, { id: tabId, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  const webSender = { tab: { id: tabId } };

  const clearRes = await browser.runtime.onMessage.fire({ type: "catalog-clear" }, webSender);
  assert.deepEqual(clearRes[0], { ok: false, error: "unauthorized" });

  const exportRes = await browser.runtime.onMessage.fire({ type: "catalog-export" }, webSender);
  assert.deepEqual(exportRes[0], { ok: false, error: "unauthorized" });
});
