import test from "node:test";
import assert from "node:assert/strict";

import { extractVideoId, isYouTubeHost } from "../lib/video.js";
import { createNavigationController } from "../lib/navigation.js";
import { createBackground } from "../lib/background.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";

test("extracts the video id from a watch url", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=abc123"), "abc123");
});

test("extracts the video id when extra params are present", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/watch?v=abc123&t=42s&list=PL999"),
    "abc123"
  );
});

test("ignores non-video youtube pages", () => {
  assert.equal(extractVideoId("https://www.youtube.com/results?search_query=cats"), null);
  assert.equal(extractVideoId("https://www.youtube.com/"), null);
  assert.equal(extractVideoId("https://www.youtube.com/watch"), null);
});

test("ignores non-youtube hosts", () => {
  assert.equal(extractVideoId("https://example.com/watch?v=abc123"), null);
  assert.equal(isYouTubeHost("www.youtube.com"), true);
  assert.equal(isYouTubeHost("evil-youtube.com"), false);
});

test("home to watch navigation emits the video id once", () => {
  const events = [];
  const controller = createNavigationController({ onVideoChange: (event) => events.push(event) });

  controller.observe(1, "https://www.youtube.com/");
  controller.observe(1, "https://www.youtube.com/watch?v=abc123");
  controller.observe(1, "https://www.youtube.com/watch?v=abc123");

  assert.deepEqual(events, [{ tabId: 1, videoId: "abc123" }]);
});

test("switching videos in the same session emits the new id", () => {
  const events = [];
  const controller = createNavigationController({ onVideoChange: (event) => events.push(event) });

  controller.observe(1, "https://www.youtube.com/watch?v=abc123");
  controller.observe(1, "https://www.youtube.com/watch?v=xyz789");

  assert.deepEqual(events, [
    { tabId: 1, videoId: "abc123" },
    { tabId: 1, videoId: "xyz789" },
  ]);
});

test("navigating to a non-video page clears the current video without emitting", () => {
  const events = [];
  const controller = createNavigationController({ onVideoChange: (event) => events.push(event) });

  controller.observe(1, "https://www.youtube.com/watch?v=abc123");
  controller.observe(1, "https://www.youtube.com/results?search_query=cats");

  assert.equal(controller.current(1), null);
  assert.deepEqual(events, [{ tabId: 1, videoId: "abc123" }]);
});

test("per-tab state does not leak across tabs", () => {
  const events = [];
  const controller = createNavigationController({ onVideoChange: (event) => events.push(event) });

  controller.observe(1, "https://www.youtube.com/watch?v=aaa111");
  controller.observe(2, "https://www.youtube.com/watch?v=aaa111");

  assert.equal(events.length, 2);
  assert.equal(controller.current(1), "aaa111");
  assert.equal(controller.current(2), "aaa111");
});

test("a forged page signal with an arbitrary id does not create a catalog record", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  browser.setTab(7, { url: "https://www.youtube.com/results?search_query=cats" });

  const background = createBackground({ browser });
  const reply = await background.onRuntimeMessage(
    { type: "video-signal", videoId: "forgedId" },
    { tab: { id: 7 } }
  );

  assert.equal(reply.videoId, null);
  assert.deepEqual(await background.catalog.list(), []);
});

test("a page signal is resolved from the browser-observed tab url", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();
  browser.setTab(7, { url: "https://www.youtube.com/watch?v=abc123&t=9s" });

  const background = createBackground({ browser });
  const reply = await background.onRuntimeMessage(
    { type: "video-signal", videoId: "forgedId" },
    { tab: { id: 7 } }
  );

  assert.equal(reply.videoId, "abc123");
  assert.equal(background.navigation.current(7), "abc123");
});

test("history-state navigation is observed and notifies the tab", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();

  const background = createBackground({ browser });
  await browser.webNavigation.onHistoryStateUpdated.fire({
    tabId: 3,
    frameId: 0,
    url: "https://www.youtube.com/watch?v=abc123",
  });

  assert.equal(background.navigation.current(3), "abc123");
  assert.deepEqual(browser.sentMessages, [
    { tabId: 3, message: { type: "video-change", videoId: "abc123" } },
  ]);
});

test("subframe history events are ignored", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();

  const background = createBackground({ browser });
  await browser.webNavigation.onHistoryStateUpdated.fire({
    tabId: 3,
    frameId: 1,
    url: "https://www.youtube.com/watch?v=abc123",
  });

  assert.equal(background.navigation.current(3), null);
});

test("background activation registers navigation and message listeners at top level", () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();

  createBackground({ browser });

  assert.equal(browser.webNavigation.onHistoryStateUpdated.listeners.length, 1);
  assert.equal(browser.runtime.onMessage.listeners.length, 1);
});

test("tab removal forgets per-tab navigation state", async () => {
  const browser = createFakeBrowser();
  browser.storage.local = createMemoryStorage();

  const background = createBackground({ browser });
  background.navigation.observe(5, "https://www.youtube.com/watch?v=abc123");
  await browser.tabs.onRemoved.fire(5);

  assert.equal(background.navigation.current(5), null);
});
