import { parseUrl, isYouTubeHost, extractVideoId } from "./video.js";
import "./history-path-core.js";

const historyPath = globalThis.NoReplayHistoryPath;
if (!historyPath || typeof historyPath.isHistoryPath !== "function") {
  throw new Error("NoReplay history-path core is required");
}

export const CANONICAL_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isHistoryUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (!isYouTubeHost(url.hostname)) return false;
  return historyPath.isHistoryPath(url.pathname);
}

export function isValidVideoId(id) {
  if (typeof id !== "string") return false;
  return CANONICAL_ID_PATTERN.test(id);
}

function resolveHref(item) {
  if (!item) return null;
  if (typeof item === "string") return item;
  if (typeof item.href === "string") return item.href;
  if (typeof item.getAttribute === "function") {
    const attr = item.getAttribute("href");
    if (typeof attr === "string") return attr;
  }
  return null;
}

export function extractHistoryVideoIds(items) {
  if (!items || typeof items[Symbol.iterator] !== "function") return [];
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const rawHref = resolveHref(item);
    if (!rawHref) continue;
    let fullUrl = rawHref;
    if (rawHref.startsWith("/")) {
      fullUrl = `https://www.youtube.com${rawHref}`;
    }
    const videoId = extractVideoId(fullUrl);
    if (videoId && isValidVideoId(videoId) && !seen.has(videoId)) {
      seen.add(videoId);
      result.push(videoId);
    }
  }

  return result;
}

export function parseTargetCount(raw) {
  if (raw === 0 || raw === "0") return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 100;
  }
  return parsed;
}
