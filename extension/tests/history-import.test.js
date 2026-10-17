import test from "node:test";
import assert from "node:assert/strict";

import { createBackground } from "../lib/background.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

test("start-history-import creates history tab and registers active session", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  const res = await browser.runtime.onMessage.fire(
    { type: "start-history-import", targetCount: 50 },
    {}
  );

  const startRes = res[0];
  assert.equal(startRes.ok, true);
  assert.ok(startRes.tabId);

  const createdTab = await browser.tabs.get(startRes.tabId);
  assert.equal(createdTab.url, "https://www.youtube.com/feed/history");

  // Check history-import-ready from that tab
  const readyRes = await browser.runtime.onMessage.fire(
    { type: "history-import-ready" },
    { tab: { id: startRes.tabId } }
  );
  assert.deepEqual(readyRes[0], { active: true, targetCount: 50 });

  // From an unrelated tab, ready returns active: false
  const unrelatedRes = await browser.runtime.onMessage.fire(
    { type: "history-import-ready" },
    { tab: { id: 999 } }
  );
  assert.deepEqual(unrelatedRes[0], { active: false });
});

test("history-import-batch rejects unauthorized tabs and invalid URLs", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  const bg = createBackground({ browser });
  await bg.ready;

  // Start import on tab 1
  const startRes = (await browser.runtime.onMessage.fire(
    { type: "start-history-import", targetCount: 100 },
    {}
  ))[0];

  // Attempt batch from an unauthorized tab
  const unauthBatch = (await browser.runtime.onMessage.fire(
    { type: "history-import-batch", videoIds: ["dQw4w9WgXcQ"] },
    { tab: { id: 999 } }
  ))[0];
  assert.equal(unauthBatch.ok, false);
  assert.equal(await bg.catalog.get("dQw4w9WgXcQ"), null);

  // Alter URL of tab 1 to non-history URL
  browser.setTab(startRes.tabId, { id: startRes.tabId, url: "https://www.youtube.com/watch?v=123" });
  const wrongUrlBatch = (await browser.runtime.onMessage.fire(
    { type: "history-import-batch", videoIds: ["dQw4w9WgXcQ"] },
    { tab: { id: startRes.tabId } }
  ))[0];
  assert.equal(wrongUrlBatch.ok, false);
  assert.equal(await bg.catalog.get("dQw4w9WgXcQ"), null);
});

test("history-import-batch records valid IDs and finish triggers sync", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  let syncTriggered = false;

  const bg = createBackground({ browser, now: () => 5000 });
  await bg.ready;
  bg.syncEngine.trigger = async () => {
    syncTriggered = true;
    return { ok: true };
  };

  const startRes = (await browser.runtime.onMessage.fire(
    { type: "start-history-import", targetCount: 100 },
    {}
  ))[0];

  const batchRes = (await browser.runtime.onMessage.fire(
    {
      type: "history-import-batch",
      videoIds: ["dQw4w9WgXcQ", "abc_12-3456", "invalid-id", "dQw4w9WgXcQ"],
    },
    { tab: { id: startRes.tabId } }
  ))[0];

  assert.equal(batchRes.ok, true);
  assert.equal(batchRes.importedCount, 2);

  const r1 = await bg.catalog.get("dQw4w9WgXcQ");
  assert.equal(r1.watched, true);
  assert.equal(r1.watchedAt, 5000);

  const r2 = await bg.catalog.get("abc_12-3456");
  assert.equal(r2.watched, true);

  const finishRes = (await browser.runtime.onMessage.fire(
    { type: "history-import-finish" },
    { tab: { id: startRes.tabId } }
  ))[0];

  assert.equal(finishRes.ok, true);
  assert.equal(syncTriggered, true);

  // Close tab message removes the tab
  await browser.runtime.onMessage.fire(
    { type: "close-tab" },
    { tab: { id: startRes.tabId } }
  );
  await assert.rejects(browser.tabs.get(startRes.tabId));
});
