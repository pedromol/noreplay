const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com"]);

export function parseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export function isYouTubeHost(hostname) {
  if (typeof hostname !== "string" || hostname.length === 0) return false;
  return YOUTUBE_HOSTS.has(hostname.replace(/^www\./, ""));
}

export function extractVideoId(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return null;
  if (!isYouTubeHost(url.hostname)) return null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v");
    if (!id || !VIDEO_ID_PATTERN.test(id)) return null;
    return id;
  }
  const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)$/);
  if (shortsMatch) {
    const id = shortsMatch[1];
    if (!VIDEO_ID_PATTERN.test(id)) return null;
    return id;
  }
  return null;
}
