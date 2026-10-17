import { createCatalog } from "../storage/catalog.js";
import { createNavigationController } from "./navigation.js";
import { createProgressTracker } from "./progress.js";
import { extractVideoId } from "./video.js";
import { createSyncClient, DEFAULT_BASE_URL } from "../sync/client.js";
import { createSyncEngine } from "../sync/engine.js";

export const HISTORY_FILTER = {
  url: [{ hostEquals: "www.youtube.com" }, { hostEquals: "m.youtube.com" }],
};

export const TOKEN_KEY = "auth.token";
export const BASE_URL_KEY = "sync.baseUrl";

export function createBackground({ browser, now = () => Date.now(), fetch } = {}) {
  const catalog = createCatalog(browser.storage.local);
  const progress = createProgressTracker({
    catalog,
    storage: browser.storage.local,
    now,
  });

  let syncClient = createSyncClient({ baseUrl: DEFAULT_BASE_URL, fetch });
  let sessionExpired = false;

  function makeEngine(client) {
    return createSyncEngine({
      catalog,
      client,
      now,
      onUnauthorized: () => {
        sessionExpired = true;
        Promise.resolve(browser.storage.local.remove(TOKEN_KEY)).catch(() => {});
      },
    });
  }

  let syncEngine = makeEngine(syncClient);

  const navigation = createNavigationController({
    onVideoChange({ tabId, videoId }) {
      notifyTab(tabId, { type: "video-change", videoId });
      notifyVideoState(tabId, videoId);
      triggerSync();
    },
  });

  async function getToken() {
    try {
      const stored = await browser.storage.local.get(TOKEN_KEY);
      const val = stored ? stored[TOKEN_KEY] : null;
      return val && typeof val === "string" ? val : null;
    } catch {
      return null;
    }
  }

  async function setToken(token) {
    if (token) {
      await browser.storage.local.set({ [TOKEN_KEY]: token });
      syncEngine.setToken(token);
    } else {
      await browser.storage.local.remove(TOKEN_KEY);
      syncEngine.setToken(null);
    }
  }

  async function getBaseUrl() {
    try {
      const stored = await browser.storage.local.get(BASE_URL_KEY);
      const val = stored ? stored[BASE_URL_KEY] : null;
      return val && typeof val === "string" ? val : DEFAULT_BASE_URL;
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  async function configureSync() {
    const baseUrl = await getBaseUrl();
    syncClient = createSyncClient({ baseUrl, fetch });
    syncEngine = makeEngine(syncClient);
    const token = await getToken();
    if (token) {
      sessionExpired = false;
      syncEngine.setToken(token);
    }
    return { token: token || null, baseUrl };
  }

  async function triggerSync() {
    try {
      await syncEngine.trigger();
    } catch {
      /* ignore */
    }
  }

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
    if (tabId !== undefined) {
      if (message && message.type === "video-signal") {
        const url = await resolveTabUrl(tabId);
        navigation.observe(tabId, url);
        return { videoId: navigation.current(tabId) };
      }
      if (message && message.type === "playback") {
        const url = await resolveTabUrl(tabId);
        const videoId = extractVideoId(url);
        if (!videoId) return undefined;
        const res = await progress.record({
          videoId,
          deltaSeconds: message.deltaSeconds,
          durationSeconds: message.duration,
        });
        if (res && res.marked) {
          triggerSync();
        }
        return undefined;
      }
      if (message && message.type === "mark-never-skip") {
        const url = await resolveTabUrl(tabId);
        const videoId = extractVideoId(url);
        if (!videoId) return { videoId: null };
        await catalog.markNeverSkip(videoId, now());
        triggerSync();
        return { videoId };
      }
      if (message && message.type === "video-state-request") {
        const url = await resolveTabUrl(tabId);
        return videoState(extractVideoId(url));
      }
    }

    if (
      message &&
      (message.type === "account-status" ||
        message.type === "account-signup" ||
        message.type === "account-login" ||
        message.type === "account-logout")
    ) {
      await initPromise.catch(() => {});
    }

    if (message && message.type === "account-status") {
      const token = await getToken();
      return { sessionActive: Boolean(token), expired: sessionExpired && !token };
    }
    if (message && message.type === "account-signup") {
      const res = await syncClient.signup({ email: message.email, password: message.password });
      if (res.status === 403) {
        return { ok: res.ok, status: res.status, retryAfter: res.retryAfter, code: "signup_not_allowed" };
      }
      return { ok: res.ok, status: res.status, retryAfter: res.retryAfter };
    }
    if (message && message.type === "account-login") {
      const res = await syncClient.login({ email: message.email, password: message.password });
      if (res.ok) {
        try {
          const body = await res.json();
          const token = body && body.token;
          if (token) {
            sessionExpired = false;
            await setToken(token);
            syncEngine.start(token);
          }
        } catch {
          /* ignore */
        }
        await triggerSync();
        return { ok: true, status: res.status };
      }
      if (res.status === 401) {
        await setToken(null);
        syncEngine.stop();
        return { ok: false, status: 401, code: "invalid_credentials" };
      }
      if (res.status === 429) {
        return { ok: false, status: 429, retryAfter: res.retryAfter };
      }
      if (res.status === 403) {
        return { ok: false, status: 403, code: "signup_not_allowed" };
      }
      return { ok: res.ok, status: res.status, retryAfter: res.retryAfter };
    }
    if (message && message.type === "account-logout") {
      const token = await getToken();
      if (token) {
        try {
          await syncClient.logout(token);
        } catch {
          /* ignore */
        }
      }
      await setToken(null);
      syncEngine.stop();
      sessionExpired = false;
      return { ok: true };
    }

    return undefined;
  }

  function onTabRemoved(tabId) {
    navigation.forget(tabId);
  }

  async function init() {
    await configureSync();
    const token = await getToken();
    if (token) {
      syncEngine.start(token);
    }
  }

  browser.webNavigation.onHistoryStateUpdated.addListener(onHistoryStateUpdated, HISTORY_FILTER);
  if (browser.tabs && browser.tabs.onRemoved) {
    browser.tabs.onRemoved.addListener(onTabRemoved);
  }

  const initPromise = init();
  browser.runtime.onMessage.addListener(onRuntimeMessage);

  return {
    catalog,
    navigation,
    progress,
    get syncClient() {
      return syncClient;
    },
    get syncEngine() {
      return syncEngine;
    },
    now,
    resolveTabUrl,
    onHistoryStateUpdated,
    onRuntimeMessage,
    onTabRemoved,
    configureSync,
    triggerSync,
    ready: initPromise,
  };
}
