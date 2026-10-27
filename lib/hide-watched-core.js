(function (root) {
  const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

  const CONTAINER_SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-shorts-lockup-view-model",
    "ytm-video-with-context-renderer",
  ];

  const SHELF_SELECTORS = ["ytd-rich-shelf-renderer", "ytd-reel-shelf-renderer"];

  const VIDEO_LINK_SELECTOR = 'a[href*="/watch"], a[href*="/shorts/"]';
  const PROGRESS_SELECTORS = [
    "ytd-thumbnail-overlay-resume-playback-renderer #progress",
    "ytm-thumbnail-overlay-resume-playback-renderer #progress",
    "yt-thumbnail-overlay-progress-bar-view-model .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
    "yt-lockup-view-model .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
    ".ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
  ];
  const PROGRESS_SELECTOR = PROGRESS_SELECTORS.join(", ");
  const RESUME_PROGRESS_HIDE_PERCENT = 25;
  const PERCENT_WIDTH_REGEX = /^[\d.]+%$/;

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

  function extractProgressPercentFromElement(container) {
    if (!container || typeof container.querySelector !== "function") return null;
    const bar = container.querySelector(PROGRESS_SELECTOR);
    if (!bar || !bar.style || typeof bar.style.width !== "string") return null;

    const width = bar.style.width.trim();
    if (!PERCENT_WIDTH_REGEX.test(width)) return null;

    const value = Number.parseFloat(width);
    if (!Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, value));
  }

  function shouldHideByProgress(progressPercent) {
    if (typeof progressPercent !== "number" || !Number.isFinite(progressPercent)) return false;
    return progressPercent >= RESUME_PROGRESS_HIDE_PERCENT;
  }

  function recordDecision(record) {
    if (!record || typeof record !== "object") return null;
    if (record.neverSkip) return false;
    if (record.watched) return true;
    return null;
  }

  function shouldHideVideo(record, isFeatureEnabled, progressPercent) {
    if (!isFeatureEnabled) return false;
    const decision = recordDecision(record);
    if (decision !== null) return decision;
    return shouldHideByProgress(progressPercent);
  }

  function shouldHideItem(container, record, isFeatureEnabled) {
    if (!isFeatureEnabled) return false;
    const decided = recordDecision(record) !== null;
    const progressPercent = decided
      ? null
      : extractProgressPercentFromElement(container);
    return shouldHideVideo(record, isFeatureEnabled, progressPercent);
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
      const record =
        catalog && typeof catalog[videoId] === "object" ? catalog[videoId] : null;
      if (!shouldHideItem(item, record, true)) return false;
    }
    return seen > 0;
  }

  root.NoReplayHideWatched = {
    CONTAINER_SELECTORS,
    SHELF_SELECTORS,
    VIDEO_LINK_SELECTOR,
    PROGRESS_SELECTORS,
    PROGRESS_SELECTOR,
    RESUME_PROGRESS_HIDE_PERCENT,
    extractVideoIdFromHref,
    extractVideoIdFromElement,
    extractProgressPercentFromElement,
    shouldHideByProgress,
    shouldHideVideo,
    shouldHideItem,
    shouldHideShelf,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
