import test from "node:test";
import assert from "node:assert/strict";

import { createBackground } from "../lib/background.js";
import {
  describeAccountResult,
  describeSessionStatus,
  ACCOUNT_STATUS,
} from "../sync/status.js";
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

  let res = await browser.runtime.onMessage.fire({ type: "account-status" });
  assert.deepEqual(res[0], { sessionActive: false, expired: false });

  res = await browser.runtime.onMessage.fire({ type: "account-login", email: "a", password: "badbadbadbad" });
  assert.equal(res[0].ok, false);
  assert.equal(res[0].status, 403);
  assert.equal(res[0].code, "sync_disabled");

  res = await browser.runtime.onMessage.fire({ type: "account-signup", email: "a", password: "badbadbadbad" });
  assert.equal(res[0].ok, false);
  assert.equal(res[0].status, 403);
  assert.equal(res[0].code, "sync_disabled");

  res = await browser.runtime.onMessage.fire({ type: "account-logout" });
  assert.equal(res[0].ok, true);

  res = await browser.runtime.onMessage.fire({ type: "start-history-import", targetCount: 100 });
  assert.equal(res[0].ok, true);
  assert.equal(res[0].targetCount, 100);
});

test("each failure maps to a DISTINCT options feedback (no silent screen)", () => {
  const invalid = describeAccountResult({ ok: false, status: 401 });
  const rate = describeAccountResult({ ok: false, status: 429, retryAfter: "30" });
  const disabled = describeAccountResult({ ok: false, status: 403, code: "signup_not_allowed" });
  const network = describeAccountResult({ error: true });
  const submitting = describeSessionStatus(ACCOUNT_STATUS.NO_SESSION);

  const statuses = [invalid.status, rate.status, disabled.status, network.status];
  assert.equal(new Set(statuses).size, statuses.length, "all outcomes distinct");
  assert.equal(invalid.status, ACCOUNT_STATUS.INVALID_CREDENTIALS);
  assert.equal(rate.status, ACCOUNT_STATUS.RATE_LIMITED);
  assert.equal(disabled.status, ACCOUNT_STATUS.SIGNUP_DISABLED);
  assert.equal(network.status, ACCOUNT_STATUS.NETWORK_ERROR);

  for (const described of [invalid, rate, disabled, network]) {
    assert.ok(described.message && described.message.length > 0, "every outcome has visible text");
  }
  assert.match(rate.message, /30/, "rate limit surfaces Retry-After");
  assert.ok(submitting.length > 0);
});

test("expired session is reported distinctly from no-session", () => {
  assert.equal(
    describeSessionStatus(ACCOUNT_STATUS.SESSION_EXPIRED),
    "Session expired. Please log in again."
  );
  assert.equal(describeSessionStatus(ACCOUNT_STATUS.NO_SESSION), "No active session");
  assert.equal(describeSessionStatus(ACCOUNT_STATUS.SESSION_ACTIVE), "Session active");
});

test("in-progress feedback exists before a result arrives", () => {
  assert.equal(ACCOUNT_STATUS.SUBMITTING, "submitting");
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

test("offline catalog management and sync configuration message contracts", async () => {
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

  // 6. Get sync config (default without token)
  let configRes = await browser.runtime.onMessage.fire({ type: "get-sync-config" });
  assert.equal(configRes[0].baseUrl, "https://noreplay.local/");
  assert.equal(configRes[0].hasToken, false);

  // 7. Set custom server URL — sync disabled, always returns default
  const setRes = await browser.runtime.onMessage.fire({
    type: "set-server-url",
    baseUrl: "https://my-server.example.com",
  });
  assert.equal(setRes[0].ok, true);
  assert.equal(setRes[0].baseUrl, "https://noreplay.local/");

  // Config always reports the fixed default URL
  configRes = await browser.runtime.onMessage.fire({ type: "get-sync-config" });
  assert.equal(configRes[0].baseUrl, "https://noreplay.local/");
  assert.equal(configRes[0].hasToken, false);
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

  const setUrlRes = await browser.runtime.onMessage.fire(
    { type: "set-server-url", baseUrl: "https://evil.com" },
    webSender
  );
  assert.deepEqual(setUrlRes[0], { ok: false, error: "unauthorized" });
});



