(function (root) {
  const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

  const CONTAINER_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-shorts-lockup-view-model",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
  ];

  const SHELF_SELECTORS = ["ytd-rich-shelf-renderer", "ytd-reel-shelf-renderer"];

  const VIDEO_LINK_SELECTOR = 'a[href*="/watch"], a[href*="/shorts/"]';

  function extractVideoIdFromHref(href) {
    if (!href || typeof href !== "string") return null;
    try {
      const url = new URL(href, "https://www.youtube.com");
      if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        return id && VIDEO_ID_REGEX.test(id) ? id : null;
      }
      const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)$/);
      if (shortsMatch) {
        const id = shortsMatch[1];
        return VIDEO_ID_REGEX.test(id) ? id : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  function extractVideoIdFromElement(container) {
    if (!container || typeof container.querySelector !== "function") return null;
    const link = container.querySelector(VIDEO_LINK_SELECTOR);
    if (!link) return null;
    const rawHref =
      (typeof link.getAttribute === "function" && link.getAttribute("href")) || link.href;
    return extractVideoIdFromHref(rawHref);
  }

  function shouldHideVideo(record, isFeatureEnabled) {
    if (!isFeatureEnabled) return false;
    if (!record || typeof record !== "object") return false;
    if (record.neverSkip) return false;
    return Boolean(record.watched);
  }

  function shouldHideShelf(shelf, isFeatureEnabled, catalog) {
    if (!isFeatureEnabled) return false;
    if (!shelf || typeof shelf.querySelectorAll !== "function") return false;
    const items = shelf.querySelectorAll(CONTAINER_SELECTORS.join(", "));
    let seen = 0;
    for (const item of items) {
      const videoId = extractVideoIdFromElement(item);
      if (!videoId) continue;
      seen += 1;
      const record = catalog && typeof catalog[videoId] === "object" ? catalog[videoId] : null;
      if (!shouldHideVideo(record, true)) return false;
    }
    return seen > 0;
  }

  root.NoReplayHideWatched = {
    CONTAINER_SELECTORS,
    SHELF_SELECTORS,
    VIDEO_LINK_SELECTOR,
    extractVideoIdFromHref,
    extractVideoIdFromElement,
    shouldHideVideo,
    shouldHideShelf,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
