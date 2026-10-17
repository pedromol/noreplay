import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTAINER_SELECTORS,
  extractVideoIdFromHref,
  extractVideoIdFromElement,
  shouldHideVideo,
} from "../lib/hide-watched.js";

test("CONTAINER_SELECTORS includes YouTube desktop and mobile card containers", () => {
  assert.ok(Array.isArray(CONTAINER_SELECTORS));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-rich-item-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-video-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-compact-video-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytd-grid-video-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytm-video-with-context-renderer"));
  assert.ok(CONTAINER_SELECTORS.includes("ytm-compact-video-renderer"));
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

test("extractVideoIdFromElement finds watch link inside a container element", () => {
  const fakeElement = {
    querySelector(selector) {
      if (selector === 'a[href*="/watch"]') {
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
