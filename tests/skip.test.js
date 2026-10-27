import test from "node:test";
import assert from "node:assert/strict";

import { SKIP_GRACE_MS, createSkipCountdown, createSkipSession } from "../lib/skip.js";
import { createBackground } from "../lib/background.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";

function createFakeClock(startMs = 0) {
  let nowMs = startMs;
  let nextId = 0;
  const scheduled = new Map();

  const timer = {
    schedule(fn, ms) {
      const id = ++nextId;
      scheduled.set(id, { fn, at: nowMs + ms });
      return id;
    },
    cancel(id) {
      scheduled.delete(id);
    },
  };

  function advance(ms) {
    const target = nowMs + ms;
    for (;;) {
      let next = null;
      for (const [id, entry] of scheduled) {
        if (entry.at <= target && (next === null || entry.at < next.entry.at)) {
          next = { id, entry };
        }
      }
      if (next === null) break;
      nowMs = next.entry.at;
      scheduled.delete(next.id);
      next.entry.fn();
    }
    nowMs = target;
  }

  return { timer, advance, now: () => nowMs };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function stateMessages(browser) {
  const result = [];
  for (const entry of browser.sentMessages) {
    if (entry.message.type === "video-state") result.push(entry);
  }
  return result;
}

function watchedCatalog(videoId, overrides = {}) {
  return {
    catalog: {
      [videoId]: {
        videoId,
        watched: true,
        watchedAt: 1,
        neverSkip: false,
        neverSkipAt: 0,
        ...overrides,
      },
    },
  };
}

test("the grace period is five seconds", () => {
  assert.equal(SKIP_GRACE_MS, 5000);
});

test("counts the full grace period down to zero and expires exactly once", () => {
  const clock = createFakeClock();
  const ticks = [];
  let expirations = 0;
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    onTick: (remaining) => ticks.push(remaining),
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();
  clock.advance(SKIP_GRACE_MS);
  clock.advance(10000);

  assert.deepEqual(ticks, [5000, 4000, 3000, 2000, 1000, 0]);
  assert.equal(expirations, 1);
  assert.equal(countdown.isRunning(), false);
  assert.equal(countdown.remainingMs(), 0);
});

test("tick values never increase", () => {
  const clock = createFakeClock();
  const ticks = [];
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    onTick: (remaining) => ticks.push(remaining),
  });

  countdown.start();
  clock.advance(SKIP_GRACE_MS);

  for (let i = 1; i < ticks.length; i += 1) {
    assert.ok(ticks[i] <= ticks[i - 1], `tick ${i} must not increase`);
  }
  assert.equal(ticks[ticks.length - 1], 0);
});

test("cancelling before the deadline never expires", () => {
  const clock = createFakeClock();
  let expirations = 0;
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();
  clock.advance(2000);
  countdown.cancel();
  clock.advance(10000);

  assert.equal(expirations, 0);
  assert.equal(countdown.isRunning(), false);
});

test("cancelling then resuming does not revive the countdown", () => {
  const clock = createFakeClock();
  let expirations = 0;
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();
  clock.advance(1000);
  countdown.cancel();
  countdown.resume();
  clock.advance(10000);

  assert.equal(expirations, 0);
});

test("pausing freezes the remaining time and resuming continues from it", () => {
  const clock = createFakeClock();
  let expirations = 0;
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();
  clock.advance(2000);
  assert.equal(countdown.remainingMs(), 3000);

  countdown.pause();
  assert.equal(countdown.isRunning(), false);
  clock.advance(10000);
  assert.equal(countdown.remainingMs(), 3000);
  assert.equal(expirations, 0);

  countdown.resume();
  assert.equal(countdown.isRunning(), true);
  clock.advance(3000);

  assert.equal(expirations, 1);
  assert.equal(countdown.remainingMs(), 0);
});

test("pausing never expires the countdown", () => {
  const clock = createFakeClock();
  let expirations = 0;
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();
  countdown.pause();
  clock.advance(10000);

  assert.equal(expirations, 0);
});

test("a tick that arrives while hidden does not advance the countdown", () => {
  const clock = createFakeClock();
  let visible = true;
  const ticks = [];
  let expirations = 0;
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    isVisible: () => visible,
    onTick: (remaining) => ticks.push(remaining),
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();
  clock.advance(2000);
  assert.deepEqual(ticks, [5000, 4000, 3000]);

  visible = false;
  clock.advance(5000);
  assert.equal(expirations, 0);
  assert.equal(countdown.isRunning(), false);
  assert.equal(countdown.remainingMs(), 3000);

  visible = true;
  countdown.resume();
  clock.advance(3000);

  assert.equal(expirations, 1);
});

test("restarting resets the countdown and expires again", () => {
  const clock = createFakeClock();
  let expirations = 0;
  const countdown = createSkipCountdown({
    now: clock.now,
    timer: clock.timer,
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();
  clock.advance(2000);
  countdown.start();
  clock.advance(2000);
  assert.equal(expirations, 0);

  clock.advance(3000);
  assert.equal(expirations, 1);

  countdown.start();
  clock.advance(SKIP_GRACE_MS);
  assert.equal(expirations, 2);
});

test("a non-positive duration expires immediately", () => {
  const clock = createFakeClock();
  const ticks = [];
  let expirations = 0;
  const countdown = createSkipCountdown({
    durationMs: 0,
    now: clock.now,
    timer: clock.timer,
    onTick: (remaining) => ticks.push(remaining),
    onExpire: () => {
      expirations += 1;
    },
  });

  countdown.start();

  assert.deepEqual(ticks, [0]);
  assert.equal(expirations, 1);
});

test("an open session expires once for the video it was bound to", () => {
  const clock = createFakeClock();
  const skips = [];
  const session = createSkipSession({
    now: clock.now,
    timer: clock.timer,
    onSkip: (videoId) => skips.push(videoId),
  });

  assert.equal(session.open("abc123"), true);
  assert.equal(session.current(), "abc123");
  assert.equal(session.isActive(), true);

  clock.advance(SKIP_GRACE_MS);
  clock.advance(10000);

  assert.deepEqual(skips, ["abc123"]);
  assert.equal(session.isActive(), false);
});

test("an open session rejects an empty video id", () => {
  const clock = createFakeClock();
  const session = createSkipSession({ now: clock.now, timer: clock.timer });

  assert.equal(session.open(""), false);
  assert.equal(session.open(null), false);
  assert.equal(session.isActive(), false);
});

test("changing the video mid-countdown discards the popup and never skips the next video", () => {
  const clock = createFakeClock();
  const skips = [];
  const session = createSkipSession({
    now: clock.now,
    timer: clock.timer,
    onSkip: (videoId) => skips.push(videoId),
  });

  session.open("videoA");
  clock.advance(2000);

  session.close();
  clock.advance(10000);

  assert.deepEqual(skips, []);
  assert.equal(session.isActive(), false);
  assert.equal(session.current(), null);
});

test("closing a session cancels the pending countdown", () => {
  const clock = createFakeClock();
  const skips = [];
  const ticks = [];
  const session = createSkipSession({
    now: clock.now,
    timer: clock.timer,
    onTick: (remaining) => ticks.push(remaining),
    onSkip: (videoId) => skips.push(videoId),
  });

  session.open("videoA");
  clock.advance(2000);
  const tickCount = ticks.length;
  session.close();
  clock.advance(10000);

  assert.equal(ticks.length, tickCount);
  assert.deepEqual(skips, []);
});

test("the background sends the skip state after a video change", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  const background = createBackground({ browser });

  await browser.webNavigation.onHistoryStateUpdated.fire({
    tabId: 3,
    frameId: 0,
    url: "https://www.youtube.com/watch?v=abc123",
  });
  await flush();

  const states = stateMessages(browser);
  assert.deepEqual(states, [
    {
      tabId: 3,
      message: {
        type: "video-state",
        videoId: "abc123",
        watched: false,
        neverSkip: false,
        shouldSkip: false,
      },
    },
  ]);
  assert.equal(background.navigation.current(3), "abc123");
});

test("the background reports shouldSkip for a watched video without exception", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage(watchedCatalog("abc123"));
  createBackground({ browser });

  await browser.webNavigation.onHistoryStateUpdated.fire({
    tabId: 3,
    frameId: 0,
    url: "https://www.youtube.com/watch?v=abc123",
  });
  await flush();

  const state = stateMessages(browser)[0];
  assert.equal(state.message.shouldSkip, true);
  assert.equal(state.message.watched, true);
  assert.equal(state.message.neverSkip, false);
});

test("a never-skip exception suppresses shouldSkip", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage(
    watchedCatalog("abc123", { neverSkip: true, neverSkipAt: 5 })
  );
  createBackground({ browser });

  await browser.webNavigation.onHistoryStateUpdated.fire({
    tabId: 3,
    frameId: 0,
    url: "https://www.youtube.com/watch?v=abc123",
  });
  await flush();

  const state = stateMessages(browser)[0];
  assert.equal(state.message.shouldSkip, false);
  assert.equal(state.message.neverSkip, true);
});

test("mark-never-skip resolves the id from the tab url and ignores a forged id", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  browser.setTab(7, { url: "https://www.youtube.com/watch?v=abc123&t=9s" });
  const background = createBackground({ browser, now: () => 1234 });

  const reply = await background.onRuntimeMessage(
    { type: "mark-never-skip", videoId: "forgedId" },
    { tab: { id: 7 } }
  );

  assert.deepEqual(reply, { videoId: "abc123" });
  const record = await background.catalog.get("abc123");
  assert.equal(record.neverSkip, true);
  assert.equal(record.neverSkipAt, 1234);
  assert.equal(await background.catalog.get("forgedId"), null);
});

test("mark-never-skip on a non-watch tab records nothing", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  browser.setTab(7, { url: "https://www.youtube.com/results?search_query=cats" });
  const background = createBackground({ browser, now: () => 1234 });

  const reply = await background.onRuntimeMessage(
    { type: "mark-never-skip" },
    { tab: { id: 7 } }
  );

  assert.deepEqual(reply, { videoId: null });
  assert.deepEqual(await background.catalog.list(), []);
});

test("video-state-request answers from the tab url", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage(watchedCatalog("abc123"));
  browser.setTab(7, { url: "https://www.youtube.com/watch?v=abc123" });
  const background = createBackground({ browser });

  const reply = await background.onRuntimeMessage(
    { type: "video-state-request" },
    { tab: { id: 7 } }
  );

  assert.deepEqual(reply, {
    type: "video-state",
    videoId: "abc123",
    watched: true,
    neverSkip: false,
    shouldSkip: true,
  });
});

test("video-state-request fails open on a non-watch tab", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage(watchedCatalog("abc123"));
  browser.setTab(7, { url: "https://www.youtube.com/" });
  const background = createBackground({ browser });

  const reply = await background.onRuntimeMessage(
    { type: "video-state-request" },
    { tab: { id: 7 } }
  );

  assert.deepEqual(reply, {
    type: "video-state",
    videoId: null,
    watched: false,
    neverSkip: false,
    shouldSkip: false,
  });
});

test("manifest includes tabs permission for browser.tabs.get URL access", async () => {
  const fs = await import("node:fs/promises");
  const manifestRaw = await fs.readFile(new URL("../manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(manifestRaw);
  assert.ok(
    Array.isArray(manifest.permissions) && manifest.permissions.includes("tabs"),
    "manifest.json must declare 'tabs' permission so browser.tabs.get returns url"
  );
});

test("video-state-request returns no-video state when tabs.get omits url", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage({
    catalog: {
      nextVideo123: {
        videoId: "nextVideo123",
        watched: true,
        watchedAt: 100,
        neverSkip: false,
        neverSkipAt: 0,
      },
    },
  });
  // Tab without url property (simulating Firefox stripping url without tabs permission)
  browser.setTab(9, {});
  const background = createBackground({ browser });

  // History navigation previously observed nextVideo123 on tab 9
  await browser.webNavigation.onHistoryStateUpdated.fire({
    tabId: 9,
    frameId: 0,
    url: "https://www.youtube.com/watch?v=nextVideo123",
  });
  await flush();

  // Subsequent video-state-request from skip.js on yt-navigate-finish
  const reply = await background.onRuntimeMessage(
    { type: "video-state-request" },
    { tab: { id: 9 } }
  );

  // resolveTabUrl returns null when tabs.get omits url (no fabrication from stale state)
  assert.deepEqual(reply, {
    type: "video-state",
    videoId: null,
    watched: false,
    neverSkip: false,
    shouldSkip: false,
  });
});

