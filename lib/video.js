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

const FRAGMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function validId(id) {
  return typeof id === "string" && FRAGMENT_ID_PATTERN.test(id) && VIDEO_ID_PATTERN.test(id) ? id : null;
}

// YouTube TV (/tv) keeps the video in the fragment: #/watch?v=<id>,
// #/shorts/<id>, or the legacy leading-"!" form.
function extractVideoIdFromHash(hash) {
  if (typeof hash !== "string" || hash.length < 2) return null;
  const route = hash.replace(/^#!?/, "");
  if (route.startsWith("/watch")) {
    const queryIndex = route.indexOf("?");
    if (queryIndex === -1) return null;
    // Parse only the fragment query up to a nested "#" so a malformed route
    // cannot smuggle parameters from a later segment.
    const query = route.slice(queryIndex + 1).split("#")[0];
    return validId(new URLSearchParams(query).get("v"));
  }
  const shortsMatch = route.match(/^\/shorts\/([^/?#]+)$/);
  if (shortsMatch) return validId(shortsMatch[1]);
  return null;
}

export function extractVideoId(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return null;
  if (!isYouTubeHost(url.hostname)) return null;

  if (url.pathname === "/watch") {
    return validId(url.searchParams.get("v"));
  }
  if (url.pathname === "/tv" || url.pathname === "/tv/") {
    return extractVideoIdFromHash(url.hash);
  }
  const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)$/);
  if (shortsMatch) {
    return validId(shortsMatch[1]);
  }
  return null;
}
