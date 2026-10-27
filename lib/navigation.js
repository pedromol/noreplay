import { extractVideoId } from "./video.js";

export function createNavigationController({ onVideoChange } = {}) {
  const currentByTab = new Map();

  function observe(tabId, rawUrl) {
    const videoId = extractVideoId(rawUrl);
    const previous = currentByTab.has(tabId) ? currentByTab.get(tabId) : null;
    if (videoId === previous) return videoId;
    currentByTab.set(tabId, videoId);
    if (videoId && typeof onVideoChange === "function") {
      onVideoChange({ tabId, videoId });
    }
    return videoId;
  }

  function current(tabId) {
    return currentByTab.has(tabId) ? currentByTab.get(tabId) : null;
  }

  function forget(tabId) {
    currentByTab.delete(tabId);
  }

  return { observe, current, forget };
}
