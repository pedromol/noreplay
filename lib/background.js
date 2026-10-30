import { createSyncCatalog } from "../storage/sync-catalog.js";
import { createNavigationController } from "./navigation.js";
import { createProgressTracker } from "./progress.js";
import { extractVideoId, parseUrl } from "./video.js";
import { isValidVideoId, parseTargetCount, isHistoryUrl } from "./history-core.js";

export const HISTORY_FILTER = {
  url: [{ hostEquals: "www.youtube.com" }, { hostEquals: "m.youtube.com" }],
};
export function createBackground({ browser, now = () => Date.now() } = {}) {
  const catalog = createSyncCatalog({ browser });
  const progress = createProgressTracker({
    catalog,
    storage: browser.storage.local,
    now,
  });

  let activeImport = null;

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
      if (tab && typeof tab.url === "string") return tab.url;
    } catch {
      /* tab may be gone or url unreadable */
    }
    return null;
  }

  async function resolveVideoIdFromTab(tabId) {
    const url = await resolveTabUrl(tabId);
    return extractVideoId(url);
  }
  function isTvUrl(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url) return false;
    return url.pathname === "/tv" || url.pathname === "/tv/";
  }

  // Resolved tab urls can arrive out of order: a stale event's tabs.get may
  // settle after the next navigation already observed its video. Run these
  // decisions one at a time so a late event cannot clear a newer observation.
  let historyChain = Promise.resolve();

  function onHistoryStateUpdated(details) {
    const run = () => handleHistoryStateUpdated(details);
    const pending = historyChain.then(run, run);
    historyChain = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  async function handleHistoryStateUpdated(details) {
    if (!details || typeof details.tabId !== "number") return;
    if (typeof details.frameId === "number" && details.frameId !== 0) {
      return;
    }
    // TV routes live in the hash, which pushState-based history events do not
    // always report, so an event's url can lag the tab's committed url by one
    // update. Always resolve the tab's current url before deciding; a stale
    // event then re-observes the live id instead of clearing it.
    const tabUrl = await resolveTabUrl(details.tabId);
    const eventUrl = typeof details.url === "string" ? details.url : null;
    const videoId = (tabUrl ? extractVideoId(tabUrl) : null) || extractVideoId(eventUrl);
    if (videoId) {
      navigation.observe(details.tabId, tabUrl || eventUrl);
      return;
    }
    // A TV shell navigating to a non-video screen keeps its player mounted,
    // so keep the observed id rather than re-emitting it after a later event.
    if (isTvUrl(tabUrl) || isTvUrl(details.url)) return;
    navigation.forget(details.tabId);
  }

  function isWebPageSender(sender) {
    const tab = sender && sender.tab ? sender.tab : null;
    if (!tab) return false;
    let url = typeof tab.url === "string" ? tab.url : "";
    if (!url && typeof tab.id === "number") {
      if (browser.tabs && browser.tabs._tabs && browser.tabs._tabs[tab.id]) {
        url = browser.tabs._tabs[tab.id].url || "";
      } else if (browser._tabs && browser._tabs[tab.id]) {
        url = browser._tabs[tab.id].url || "";
      }
    }
    if (!url) return false;
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "www.youtube.com" || parsed.hostname === "m.youtube.com" || parsed.hostname === "youtube.com") {
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }
  async function triggerSync() {
    // Catalog is written to both storage.sync and storage.local by writeAll;
    // Firefox sync propagates changes to other devices automatically.
    return { ok: true };
  }

  async function onRuntimeMessage(message, sender) {
    if (!message || typeof message !== "object") return undefined;

    if (message.type === "progress" || message.type === "playback") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (typeof tabId !== "number") return undefined;
      const url = await resolveTabUrl(tabId);
      const videoId = extractVideoId(url);
      if (!videoId) return undefined;
      const deltaSeconds =
        typeof message.deltaSeconds === "number" && Number.isFinite(message.deltaSeconds)
          ? message.deltaSeconds
          : null;
      const durationSeconds =
        typeof message.durationSeconds === "number" && Number.isFinite(message.durationSeconds)
          ? message.durationSeconds
        : typeof message.duration === "number" && Number.isFinite(message.duration)
          ? message.duration
          : null;
      const result = await progress.record({ videoId, deltaSeconds, durationSeconds });
      if (result && result.marked) {
        void triggerSync();
      }
      return result;
    }

    if (message.type === "mark-never-skip") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (typeof tabId !== "number") return undefined;
      const videoId = await resolveVideoIdFromTab(tabId);
      if (!videoId) return { videoId: null };
      await catalog.markNeverSkip(videoId, now());
      notifyVideoState(tabId, videoId);
      void triggerSync();
      return { videoId };
    }

    if (message.type === "video-signal") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (typeof tabId !== "number") return { videoId: null };
      const tabUrl = await resolveTabUrl(tabId);
      const videoId =
        extractVideoId(tabUrl) ||
        extractVideoId(
          sender && sender.tab && typeof sender.tab.url === "string" ? sender.tab.url : ""
        );
      if (!videoId) {
        navigation.forget(tabId);
        return { videoId: null };
      }
      navigation.observe(tabId, tabUrl);
      void triggerSync();
      return { videoId };
    }

    if (message.type === "get-video-state" || message.type === "video-state-request") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (typeof tabId !== "number") return undefined;
      const videoId = await resolveVideoIdFromTab(tabId);
      return await videoState(videoId);
    }

    if (message.type === "catalog-list") {
      return await catalog.list();
    }

    if (message.type === "catalog-stats") {
      return await catalog.stats();
    }
    if (message.type === "catalog-export") {
      if (isWebPageSender(sender)) {
        return { ok: false, error: "unauthorized" };
      }
      const records = await catalog.list();
      return { records };
    }
    if (message.type === "catalog-import") {
      if (isWebPageSender(sender)) {
        return { ok: false, error: "unauthorized" };
      }
      const records = Array.isArray(message.records) ? message.records : [];
      const res = await catalog.importCatalog(records, now());
      void triggerSync();
      return res;
    }
    if (message.type === "catalog-clear") {
      if (isWebPageSender(sender)) {
        return { ok: false, error: "unauthorized" };
      }
      await catalog.clear();
      return { ok: true };
    }

    if (message.type === "start-history-import") {
      const targetCount = parseTargetCount(message.targetCount);
      const createdTab = await browser.tabs.create({ url: "https://www.youtube.com/feed/history" });
      activeImport = {
        tabId: createdTab.id,
        targetCount,
        importedIds: new Set(),
      };
      return { ok: true, tabId: createdTab.id, targetCount };
    }

    if (message.type === "history-import-ready") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (activeImport && activeImport.tabId === tabId) {
        return { active: true, targetCount: activeImport.targetCount };
      }
      return { active: false };
    }

    if (message.type === "history-import-batch") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (!activeImport || activeImport.tabId !== tabId) {
        return { ok: false };
      }
      const tabUrl = await resolveTabUrl(tabId);
      if (!tabUrl || !isHistoryUrl(tabUrl)) {
        return { ok: false };
      }
      const videoIds = Array.isArray(message.videoIds) ? message.videoIds : [];
      const remaining =
        activeImport.targetCount && activeImport.targetCount > activeImport.importedIds.size
          ? activeImport.targetCount - activeImport.importedIds.size
          : 0;
      const ids = [];
      for (const videoId of videoIds) {
        if (!isValidVideoId(videoId)) continue;
        if (activeImport.importedIds.has(videoId)) continue;
        if (ids.length >= remaining) break;
        ids.push(videoId);
        activeImport.importedIds.add(videoId);
      }
      const importedCount = ids.length;
      const batchCount = importedCount;
      if (ids.length > 0) {
        await catalog.bulkMarkWatched(ids, now());
      }
      if (activeImport.targetCount && activeImport.importedIds.size >= activeImport.targetCount) {
        try {
          await browser.tabs.remove(tabId);
        } catch {}
        activeImport = null;
        return { ok: true, importedCount, batchCount, done: true };
      }
      return { ok: true, importedCount, batchCount };
    }

    if (message.type === "history-import-finish") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (activeImport && activeImport.tabId === tabId) {
        activeImport = null;
        try {
          await triggerSync();
        } catch {}
      }
      return { ok: true };
    }

    if (message.type === "close-tab") {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (typeof tabId === "number") {
        try {
          await browser.tabs.remove(tabId);
        } catch {}
      }
      return { ok: true };
    }

    if (message.type === "history-import-complete") {
      return { ok: false };
    }

    return undefined;
  }

  function onTabRemoved(tabId) {
    navigation.forget(tabId);
    if (activeImport && activeImport.tabId === tabId) {
      const hadVideos = activeImport.importedIds.size > 0;
      activeImport = null;
      if (hadVideos) {
        void triggerSync();
      }
    }
  }

  browser.webNavigation.onHistoryStateUpdated.addListener(onHistoryStateUpdated, HISTORY_FILTER);
  if (browser.tabs && browser.tabs.onRemoved) {
    browser.tabs.onRemoved.addListener(onTabRemoved);
  }
  if (browser.action && browser.action.onClicked) {
    browser.action.onClicked.addListener(() => {
      if (browser.runtime && browser.runtime.openOptionsPage) {
        browser.runtime.openOptionsPage();
      }
    });
  }

  browser.runtime.onMessage.addListener(onRuntimeMessage);

  return {
    catalog,
    navigation,
    progress,
    now,
    resolveTabUrl,
    onHistoryStateUpdated,
    onRuntimeMessage,
    onTabRemoved,
    ready: Promise.resolve(),
    triggerSync,
  };
}
