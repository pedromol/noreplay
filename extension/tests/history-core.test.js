import test from "node:test";
import assert from "node:assert/strict";

import {
  isHistoryUrl,
  isValidVideoId,
  extractHistoryVideoIds,
  parseTargetCount,
} from "../lib/history-core.js";

test("isHistoryUrl matches youtube feed history paths and rejects others", () => {
  assert.equal(isHistoryUrl("https://www.youtube.com/feed/history"), true);
  assert.equal(isHistoryUrl("https://m.youtube.com/feed/history"), true);
  assert.equal(isHistoryUrl("https://www.youtube.com/feed/history?query=test"), true);
  assert.equal(isHistoryUrl("https://www.youtube.com/watch?v=12345678901"), false);
  assert.equal(isHistoryUrl("https://evil.com/feed/history"), false);
  assert.equal(isHistoryUrl("not-a-url"), false);
  assert.equal(isHistoryUrl(null), false);
});

test("isValidVideoId accepts valid YouTube IDs and rejects malformed ones", () => {
  assert.equal(isValidVideoId("dQw4w9WgXcQ"), true);
  assert.equal(isValidVideoId("abc_12-3456"), true);
  assert.equal(isValidVideoId("short"), false);
  assert.equal(isValidVideoId("too_long_video_id_over_11_characters"), false);
  assert.equal(isValidVideoId("<script>"), false);
  assert.equal(isValidVideoId(null), false);
});

test("extractHistoryVideoIds extracts unique IDs from href strings and elements", () => {
  const items = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "/watch?v=dQw4w9WgXcQ", // duplicate
    "/watch?v=abc_12-3456&t=42s",
    { href: "https://www.youtube.com/watch?v=xyz12345678" },
    { getAttribute: (attr) => (attr === "href" ? "/watch?v=11122233344" : null) },
    "https://www.youtube.com/feed/history", // not a watch url
    "invalid",
  ];

  const ids = extractHistoryVideoIds(items);
  assert.deepEqual(ids, [
    "dQw4w9WgXcQ",
    "abc_12-3456",
    "xyz12345678",
    "11122233344",
  ]);
});

test("extractHistoryVideoIds extracts shorts IDs and deduplicates across formats", () => {
  const items = [
    "https://www.youtube.com/shorts/aBc_12-3456",
    "/shorts/xyz12345678",
    "/shorts/xyz12345678", // duplicate shorts
    "/watch?v=xyz12345678", // same video via watch url
    { href: "https://www.youtube.com/shorts/11122233344?si=share" },
    "/shorts/",
    "/shorts/short",
  ];

  const ids = extractHistoryVideoIds(items);
  assert.deepEqual(ids, ["aBc_12-3456", "xyz12345678", "11122233344"]);
});

test("parseTargetCount parses numbers and enforces bounds", () => {
  assert.equal(parseTargetCount(50), 50);
  assert.equal(parseTargetCount("200"), 200);
  assert.equal(parseTargetCount(0), 0);
  assert.equal(parseTargetCount("0"), 0);
  assert.equal(parseTargetCount(-10), 100);
  assert.equal(parseTargetCount("invalid"), 100);
  assert.equal(parseTargetCount(null), 100);
});
