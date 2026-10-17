(function (root) {
  const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

  const CONTAINER_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
  ];

  function extractVideoIdFromHref(href) {
    if (!href || typeof href !== "string") return null;
    try {
      const url = new URL(href, "https://www.youtube.com");
      if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
      if (url.pathname !== "/watch") return null;
      const id = url.searchParams.get("v");
      return id && VIDEO_ID_REGEX.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function extractVideoIdFromElement(container) {
    if (!container || typeof container.querySelector !== "function") return null;
    const link = container.querySelector('a[href*="/watch"]');
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

  root.NoReplayHideWatched = {
    CONTAINER_SELECTORS,
    extractVideoIdFromHref,
    extractVideoIdFromElement,
    shouldHideVideo,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
