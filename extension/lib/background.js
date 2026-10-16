import { createCatalog } from "../storage/catalog.js";
import { createNavigationController } from "./navigation.js";
import { createProgressTracker } from "./progress.js";
import { extractVideoId } from "./video.js";

export const HISTORY_FILTER = {
  url: [{ hostEquals: "www.youtube.com" }, { hostEquals: "m.youtube.com" }],
};

export function createBackground({ browser, now = () => Date.now() } = {}) {
  const catalog = createCatalog(browser.storage.local);
  const progress = createProgressTracker({
    catalog,
    storage: browser.storage.local,
    now,
  });

  const navigation = createNavigationController({
    onVideoChange({ tabId, videoId }) {
      notifyTab(tabId, { type: "video-change", videoId });
      notifyVideoState(tabId, videoId);
    },
  });

  async function videoState(videoId) {
    if (!videoId) {
      return { type: "video-state", videoId: null, watched: false, neverSkip: false, shouldSkip: false };
    }
    let record = null;
    try {
      record = await catalog.get(videoId);
    } catch {
      record = null;
    }
    const watched = Boolean(record && record.watched);
    const neverSkip = Boolean(record && record.neverSkip);
    return {
      type: "video-state",
      videoId,
      watched,
      neverSkip,
      shouldSkip: watched && !neverSkip,
    };
  }

  function notifyVideoState(tabId, videoId) {
    videoState(videoId)
      .then((state) => notifyTab(tabId, state))
      .catch(() => {
        notifyTab(tabId, {
          type: "video-state",
          videoId: videoId ?? null,
          watched: false,
          neverSkip: false,
          shouldSkip: false,
        });
      });
  }

  function notifyTab(tabId, message) {
    try {
      const pending = browser.tabs.sendMessage(tabId, message);
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      /* tab may be gone */
    }
  }

  async function resolveTabUrl(tabId) {
    try {
      const tab = await browser.tabs.get(tabId);
      return tab ? tab.url ?? null : null;
    } catch {
      return null;
    }
  }

  function onHistoryStateUpdated(details) {
    if (!details || details.frameId !== 0) return;
    navigation.observe(details.tabId, details.url);
  }

  async function onRuntimeMessage(message, sender) {
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    if (tabId === undefined) return undefined;
    if (message && message.type === "video-signal") {
      const url = await resolveTabUrl(tabId);
      navigation.observe(tabId, url);
      return { videoId: navigation.current(tabId) };
    }
    if (message && message.type === "playback") {
      const url = await resolveTabUrl(tabId);
      const videoId = extractVideoId(url);
      if (!videoId) return undefined;
      await progress.record({
        videoId,
        deltaSeconds: message.deltaSeconds,
        durationSeconds: message.duration,
      });
      return undefined;
    }
    if (message && message.type === "mark-never-skip") {
      const url = await resolveTabUrl(tabId);
      const videoId = extractVideoId(url);
      if (!videoId) return { videoId: null };
      await catalog.markNeverSkip(videoId, now());
      return { videoId };
    }
    if (message && message.type === "video-state-request") {
      const url = await resolveTabUrl(tabId);
      return videoState(extractVideoId(url));
    }
    return undefined;
  }

  function onTabRemoved(tabId) {
    navigation.forget(tabId);
  }

  browser.webNavigation.onHistoryStateUpdated.addListener(onHistoryStateUpdated, HISTORY_FILTER);
  browser.runtime.onMessage.addListener(onRuntimeMessage);
  if (browser.tabs && browser.tabs.onRemoved) {
    browser.tabs.onRemoved.addListener(onTabRemoved);
  }

  return {
    catalog,
    navigation,
    progress,
    now,
    resolveTabUrl,
    onHistoryStateUpdated,
    onRuntimeMessage,
    onTabRemoved,
  };
}
