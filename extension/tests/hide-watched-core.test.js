import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTAINER_SELECTORS,
  SHELF_SELECTORS,
  extractVideoIdFromHref,
  extractVideoIdFromElement,
  shouldHideVideo,
  shouldHideShelf,
} from "../lib/hide-watched.js";

test("CONTAINER_SELECTORS includes YouTube desktop and mobile card containers", () => {
  assert.ok(Array.isArray(CONTAINER_SELECTORS));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-rich-item-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-video-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-compact-video-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-grid-video-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-reel-item-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-shorts-lockup-view-model"));
  assert.ok(CONTAINER_SELECTORS.includes("ytm-video-with-context-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytm-compact-video-renderer"));
});

test("SHELF_SELECTORS includes YouTube shelf containers", () => {
  assert.ok(Array.isArray(SHELF_SELECTORS));
  assert.ok(SHELF_SELECTORS.includes("ytd-rich-shelf-renderer"));
  assert.ok(SHELF_SELECTORS.includes("ytd-reel-shelf-renderer"));
});

test("extractVideoIdFromHref parses valid watch URLs and rejects invalid ones", () => {
  assert.equal(
    extractVideoIdFromHref("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
  assert.equal(
    extractVideoIdFromHref("/watch?v=abc_12-3456&t=10s"),
    "abc_12-3456"
  );
  assert.equal(
    extractVideoIdFromHref("https://m.youtube.com/watch?v=12345678901"),
    "12345678901"
  );
  assert.equal(extractVideoIdFromHref("/channel/UC12345678"), null);
  assert.equal(extractVideoIdFromHref("/watch?v=short"), null);
  assert.equal(extractVideoIdFromHref("https://evil.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractVideoIdFromHref(null), null);
});

test("extractVideoIdFromHref parses shorts URLs and rejects invalid ones", () => {
  assert.equal(
    extractVideoIdFromHref("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
  assert.equal(extractVideoIdFromHref("/shorts/abc_12-3456"), "abc_12-3456");
  assert.equal(extractVideoIdFromHref("/shorts/"), null);
  assert.equal(extractVideoIdFromHref("/shorts/abc/extra"), null);
  assert.equal(extractVideoIdFromHref("/shorts/short"), null);
  assert.equal(extractVideoIdFromHref("https://evil.com/shorts/dQw4w9WgXcQ"), null);
});

test("extractVideoIdFromElement finds watch link inside a container element", () => {
  const fakeElement = {
    querySelector(selector) {
      if (selector.includes('a[href*="/watch"]')) {
        return {
          getAttribute(attr) {
            return attr === "href" ? "/watch?v=xyz12345678" : null;
          },
          href: "https://www.youtube.com/watch?v=xyz12345678",
        };
      }
      return null;
    },
  };

  assert.equal(extractVideoIdFromElement(fakeElement), "xyz12345678");

  const emptyElement = {
    querySelector() {
      return null;
    },
  };
  assert.equal(extractVideoIdFromElement(emptyElement), null);
  assert.equal(extractVideoIdFromElement(null), null);
});

test("extractVideoIdFromElement finds shorts link inside a container element", () => {
  const fakeElement = {
    querySelector(selector) {
      if (selector.includes('a[href*="/shorts/"]')) {
        return {
          getAttribute(attr) {
            return attr === "href" ? "/shorts/xyz12345678" : null;
          },
          href: "https://www.youtube.com/shorts/xyz12345678",
        };
      }
      return null;
    },
  };

  assert.equal(extractVideoIdFromElement(fakeElement), "xyz12345678");
});

test("shouldHideVideo evaluates watched and neverSkip rules", () => {
  // TS1.1: Feature enabled, watched, not neverSkip -> true
  assert.equal(
    shouldHideVideo({ videoId: "v1", watched: true, neverSkip: false }, true),
    true
  );

  // TS1.2: neverSkip: true overrides watched: true -> false
  assert.equal(
    shouldHideVideo({ videoId: "v1", watched: true, neverSkip: true }, true),
    false
  );

  // TS1.3: not watched or null record -> false
  assert.equal(
    shouldHideVideo({ videoId: "v1", watched: false, neverSkip: false }, true),
    false
  );
  assert.equal(shouldHideVideo(null, true), false);
  assert.equal(shouldHideVideo(undefined, true), false);

  // TS1.4: feature disabled -> false regardless of record
  assert.equal(
    shouldHideVideo({ videoId: "v1", watched: true, neverSkip: false }, false),
    false
  );
});

function makeShelf(items) {
  return {
    querySelectorAll() {
      return items;
    },
  };
}

function makeItem(videoId) {
  return {
    querySelector() {
      if (!videoId) return null;
      return {
        getAttribute(attr) {
          return attr === "href" ? `/shorts/${videoId}` : null;
        },
        href: `https://www.youtube.com/shorts/${videoId}`,
      };
    },
  };
}

test("shouldHideShelf hides a shelf when every video is watched", () => {
  const catalog = {
    aaa111bbb22: { watched: true, neverSkip: false },
    ccc333ddd44: { watched: true, neverSkip: false },
  };
  const shelf = makeShelf([makeItem("aaa111bbb22"), makeItem("ccc333ddd44")]);
  assert.equal(shouldHideShelf(shelf, true, catalog), true);
});

test("shouldHideShelf keeps the shelf visible when any video is unwatched", () => {
  const catalog = {
    aaa111bbb22: { watched: true, neverSkip: false },
    ccc333ddd44: { watched: false, neverSkip: false },
  };
  const shelf = makeShelf([makeItem("aaa111bbb22"), makeItem("ccc333ddd44")]);
  assert.equal(shouldHideShelf(shelf, true, catalog), false);
});

test("shouldHideShelf keeps the shelf visible when any video has neverSkip", () => {
  const catalog = {
    aaa111bbb22: { watched: true, neverSkip: false },
    ccc333ddd44: { watched: true, neverSkip: true },
  };
  const shelf = makeShelf([makeItem("aaa111bbb22"), makeItem("ccc333ddd44")]);
  assert.equal(shouldHideShelf(shelf, true, catalog), false);
});

test("shouldHideShelf keeps the shelf visible when a video is missing from catalog", () => {
  const catalog = {
    aaa111bbb22: { watched: true, neverSkip: false },
  };
  const shelf = makeShelf([makeItem("aaa111bbb22"), makeItem("ccc333ddd44")]);
  assert.equal(shouldHideShelf(shelf, true, catalog), false);
});

test("shouldHideShelf keeps an empty or unidentifiable shelf visible", () => {
  const shelfEmpty = makeShelf([]);
  assert.equal(shouldHideShelf(shelfEmpty, true, {}), false);
  const shelfNoIds = makeShelf([makeItem(null)]);
  assert.equal(shouldHideShelf(shelfNoIds, true, {}), false);
  assert.equal(shouldHideShelf(null, true, {}), false);
});

test("shouldHideShelf returns false when the feature is disabled", () => {
  const catalog = {
    aaa111bbb22: { watched: true, neverSkip: false },
  };
  const shelf = makeShelf([makeItem("aaa111bbb22")]);
  assert.equal(shouldHideShelf(shelf, false, catalog), false);
});
