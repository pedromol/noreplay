import test from "node:test";
import assert from "node:assert/strict";

import { createProgressTracker, thresholdSeconds, PLAYTIME_KEY } from "../lib/progress.js";
import { createCatalog } from "../storage/catalog.js";
import { createBackground } from "../lib/background.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";

function createSession(storage, clock) {
  const catalog = createCatalog(storage);
  const tracker = createProgressTracker({ catalog, storage, now: () => clock.value });
  return { catalog, tracker };
}

test("threshold is the smaller of 30s and 25% of the duration", () => {
  assert.equal(thresholdSeconds(200), 30);
  assert.equal(thresholdSeconds(100), 25);
  assert.equal(thresholdSeconds(120), 30);
  assert.equal(thresholdSeconds(20), 5);
});

test("threshold is null while the duration is unknown or invalid", () => {
  assert.equal(thresholdSeconds(0), null);
  assert.equal(thresholdSeconds(-5), null);
  assert.equal(thresholdSeconds(NaN), null);
  assert.equal(thresholdSeconds(undefined), null);
  assert.equal(thresholdSeconds("200"), null);
});

test("a 200s video is marked once playback accumulates 30s", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };
  const { catalog, tracker } = createSession(storage, clock);

  await tracker.record({ videoId: "abc123", deltaSeconds: 10, durationSeconds: 200 });
  await tracker.record({ videoId: "abc123", deltaSeconds: 10, durationSeconds: 200 });
  assert.equal(await catalog.get("abc123"), null);

  const result = await tracker.record({ videoId: "abc123", deltaSeconds: 10, durationSeconds: 200 });
  assert.equal(result.marked, true);

  const record = await catalog.get("abc123");
  assert.equal(record.watched, true);
  assert.equal(record.watchedAt, 1000);
  assert.equal(storage.snapshot()[PLAYTIME_KEY].abc123, 30);
});

test("a 20s video is marked at 5s because 25% of the duration is smaller", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };
  const { catalog, tracker } = createSession(storage, clock);

  await tracker.record({ videoId: "short01", deltaSeconds: 4, durationSeconds: 20 });
  assert.equal(await catalog.get("short01"), null);

  await tracker.record({ videoId: "short01", deltaSeconds: 1, durationSeconds: 20 });
  const record = await catalog.get("short01");
  assert.equal(record.watched, true);
  assert.equal(record.watchedAt, 1000);
});

test("accumulated playback continues across sessions", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };

  const first = createSession(storage, clock);
  await first.tracker.record({ videoId: "abc123", deltaSeconds: 20, durationSeconds: 200 });
  assert.equal(await first.catalog.get("abc123"), null);
  assert.equal(storage.snapshot()[PLAYTIME_KEY].abc123, 20);

  clock.value = 2000;
  const second = createSession(storage, clock);
  const result = await second.tracker.record({
    videoId: "abc123",
    deltaSeconds: 15,
    durationSeconds: 200,
  });

  assert.equal(result.marked, true);
  assert.equal(storage.snapshot()[PLAYTIME_KEY].abc123, 35);
  const record = await second.catalog.get("abc123");
  assert.equal(record.watched, true);
  assert.equal(record.watchedAt, 2000);
});

test("abandoning below the threshold in every session never marks the video", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };

  for (const deltaSeconds of [8, 7, 9]) {
    const session = createSession(storage, clock);
    await session.tracker.record({ videoId: "abc123", deltaSeconds, durationSeconds: 200 });
    assert.equal(await session.catalog.get("abc123"), null);
  }

  assert.equal(storage.snapshot()[PLAYTIME_KEY].abc123, 24);
  assert.deepEqual(await createCatalog(storage).list(), []);
});

test("an unknown duration fails open and records nothing", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };
  const { catalog, tracker } = createSession(storage, clock);

  for (const durationSeconds of [NaN, 0, undefined, "200", -1]) {
    const result = await tracker.record({
      videoId: "abc123",
      deltaSeconds: 30,
      durationSeconds,
    });
    assert.equal(result.marked, false);
  }

  assert.equal(await catalog.get("abc123"), null);
  assert.equal(storage.snapshot()[PLAYTIME_KEY], undefined);
});

test("opening at an advanced position does not count; only active playback does", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };
  const { catalog, tracker } = createSession(storage, clock);

  const baseline = await tracker.record({
    videoId: "abc123",
    deltaSeconds: 0,
    durationSeconds: 200,
  });
  assert.equal(baseline.marked, false);

  await tracker.record({ videoId: "abc123", deltaSeconds: 20, durationSeconds: 200 });
  assert.equal(await catalog.get("abc123"), null);

  await tracker.record({ videoId: "abc123", deltaSeconds: 10, durationSeconds: 200 });
  const record = await catalog.get("abc123");
  assert.equal(record.watched, true);
  assert.equal(record.watchedAt, 1000);
});

test("an invalid delta is ignored and never written", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };
  const { catalog, tracker } = createSession(storage, clock);

  for (const deltaSeconds of [0, -5, NaN, "10", undefined]) {
    const result = await tracker.record({
      videoId: "abc123",
      deltaSeconds,
      durationSeconds: 200,
    });
    assert.equal(result.marked, false);
  }

  assert.equal(await catalog.get("abc123"), null);
  assert.equal(storage.snapshot()[PLAYTIME_KEY], undefined);
});

test("an already marked video stays watched and skips redundant work", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };
  const { catalog, tracker } = createSession(storage, clock);

  await tracker.record({ videoId: "abc123", deltaSeconds: 30, durationSeconds: 200 });
  assert.equal((await catalog.get("abc123")).watched, true);

  clock.value = 2000;
  const again = await tracker.record({
    videoId: "abc123",
    deltaSeconds: 30,
    durationSeconds: 200,
  });

  assert.equal(again.marked, false);
  assert.equal(again.alreadyWatched, true);
  assert.equal((await catalog.get("abc123")).watchedAt, 1000);
  assert.equal(storage.snapshot()[PLAYTIME_KEY].abc123, 30);
});

test("the never-skip exception survives the watched mark", async () => {
  const storage = createMemoryStorage();
  const clock = { value: 1000 };
  const { catalog, tracker } = createSession(storage, clock);

  await catalog.markNeverSkip("abc123", 500);
  await tracker.record({ videoId: "abc123", deltaSeconds: 30, durationSeconds: 200 });

  const record = await catalog.get("abc123");
  assert.equal(record.watched, true);
  assert.equal(record.neverSkip, true);
  assert.equal(record.neverSkipAt, 500);
});

test("a playback message resolves the video id from the tab url, not the message", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  browser.setTab(7, { url: "https://www.youtube.com/watch?v=abc123&t=42s" });

  const background = createBackground({ browser, now: () => 1000 });
  await background.onRuntimeMessage(
    { type: "playback", deltaSeconds: 30, duration: 200, videoId: "forgedId" },
    { tab: { id: 7 } }
  );

  const record = await background.catalog.get("abc123");
  assert.equal(record.watched, true);
  assert.equal(record.watchedAt, 1000);
  assert.equal(await background.catalog.get("forgedId"), null);
});

test("a playback message on a non-watch tab is ignored", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  browser.setTab(7, { url: "https://www.youtube.com/results?search_query=cats" });

  const background = createBackground({ browser, now: () => 1000 });
  await background.onRuntimeMessage(
    { type: "playback", deltaSeconds: 30, duration: 200 },
    { tab: { id: 7 } }
  );

  assert.deepEqual(await background.catalog.list(), []);
  assert.equal(browser.storage.local.snapshot()[PLAYTIME_KEY], undefined);
});

test("reaching the watched threshold during active playback does not send a skip state to the playing tab", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  browser.setTab(7, { url: "https://www.youtube.com/watch?v=abc123" });

  const background = createBackground({ browser, now: () => 1000 });
  await background.onRuntimeMessage(
    { type: "playback", deltaSeconds: 30, duration: 200 },
    { tab: { id: 7 } }
  );

  const record = await background.catalog.get("abc123");
  assert.equal(record.watched, true);

  const skipMessages = browser.sentMessages.filter(
    (entry) => entry.tabId === 7 && entry.message.type === "video-state"
  );
  assert.deepEqual(skipMessages, []);
});
