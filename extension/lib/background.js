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
    },
  });

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
