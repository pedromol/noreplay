import test from "node:test";
import assert from "node:assert/strict";

import { createCatalog, CATALOG_KEY, emptyRecord } from "../storage/catalog.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";

test("stores and reads back a watched mark with its exception flag", async () => {
  const catalog = createCatalog(createMemoryStorage());

  await catalog.markWatched("abc123", 1000);
  await catalog.markNeverSkip("abc123", 2000);

  const record = await catalog.get("abc123");
  assert.deepEqual(record, {
    videoId: "abc123",
    watched: true,
    watchedAt: 1000,
    neverSkip: true,
    neverSkipAt: 2000,
  });
});

test("unknown videos return null", async () => {
  const catalog = createCatalog(createMemoryStorage());
  assert.equal(await catalog.get("missing"), null);
});

test("a new record starts from the empty shape", async () => {
  const catalog = createCatalog(createMemoryStorage());
  const record = await catalog.update("abc123", {});
  assert.deepEqual(record, emptyRecord("abc123"));
});

test("shouldSkip is true only when watched and not excepted", async () => {
  const catalog = createCatalog(createMemoryStorage());

  assert.equal(await catalog.shouldSkip("abc123"), false);
  await catalog.markWatched("abc123", 1);
  assert.equal(await catalog.shouldSkip("abc123"), true);
  await catalog.markNeverSkip("abc123", 2);
  assert.equal(await catalog.shouldSkip("abc123"), false);
});

test("markWatched never clears an existing exception", async () => {
  const catalog = createCatalog(createMemoryStorage());
  await catalog.markNeverSkip("abc123", 1);
  await catalog.markWatched("abc123", 2);

  const record = await catalog.get("abc123");
  assert.equal(record.watched, true);
  assert.equal(record.neverSkip, true);
});

test("concurrent writers from two tabs do not lose updates", async () => {
  const catalog = createCatalog(createMemoryStorage());

  await Promise.all([
    catalog.markWatched("aaa111", 1),
    catalog.markWatched("bbb222", 2),
    catalog.markWatched("ccc333", 3),
    catalog.markNeverSkip("aaa111", 4),
  ]);

  assert.equal((await catalog.get("aaa111")).neverSkip, true);
  assert.equal((await catalog.get("bbb222")).watched, true);
  assert.equal((await catalog.get("ccc333")).watched, true);
  assert.equal((await catalog.list()).length, 3);
});

test("a falsy stored catalog is treated as empty", async () => {
  const catalog = createCatalog(createMemoryStorage({ [CATALOG_KEY]: null }));
  assert.deepEqual(await catalog.list(), []);
});

test("bulkMarkWatched marks multiple videos as watched while preserving existing exceptions", async () => {
  const catalog = createCatalog(createMemoryStorage());

  await catalog.markNeverSkip("vid2", 500);

  const updated = await catalog.bulkMarkWatched(["vid1", "vid2", "vid3"], 1000);
  assert.equal(updated.length, 3);

  const vid1 = await catalog.get("vid1");
  assert.equal(vid1.watched, true);
  assert.equal(vid1.watchedAt, 1000);
  assert.equal(vid1.neverSkip, false);

  const vid2 = await catalog.get("vid2");
  assert.equal(vid2.watched, true);
  assert.equal(vid2.watchedAt, 1000);
  assert.equal(vid2.neverSkip, true);
  assert.equal(vid2.neverSkipAt, 500);

  const vid3 = await catalog.get("vid3");
  assert.equal(vid3.watched, true);

  const empty = await catalog.bulkMarkWatched([], 2000);
  assert.deepEqual(empty, []);
});

test("stats returns correct counts for empty and populated catalog", async () => {
  const catalog = createCatalog(createMemoryStorage());

  const emptyStats = await catalog.stats();
  assert.deepEqual(emptyStats, { total: 0, watched: 0, neverSkip: 0 });

  await catalog.markWatched("v1", 100);
  await catalog.markNeverSkip("v2", 200);
  await catalog.markWatched("v2", 300);

  const stats = await catalog.stats();
  assert.deepEqual(stats, { total: 2, watched: 2, neverSkip: 1 });
});

test("clear removes all records from storage", async () => {
  const storage = createMemoryStorage({ playtimeSeconds: { v1: 25 } });
  const catalog = createCatalog(storage);

  await catalog.markWatched("v1", 100);
  assert.equal((await catalog.list()).length, 1);

  const cleared = await catalog.clear();
  assert.equal(cleared, true);
  assert.equal((await catalog.list()).length, 0);
  assert.deepEqual(await storage.get(CATALOG_KEY), {});
  assert.deepEqual(await storage.get("playtimeSeconds"), {});
});

test("importCatalog performs monotonic merge and preserves existing exceptions", async () => {
  const catalog = createCatalog(createMemoryStorage());

  await catalog.markWatched("v1", 1000);
  await catalog.markNeverSkip("v2", 500);

  const res = await catalog.importCatalog([
    { videoId: "v1", watched: true, watchedAt: 2000, neverSkip: false },
    { videoId: "v2", watched: true, watchedAt: 1500, neverSkip: false },
    { videoId: "v3", watched: false, neverSkip: true, neverSkipAt: 3000 },
  ]);

  assert.equal(res.imported, 3);
  assert.equal(res.total, 3);

  const v1 = await catalog.get("v1");
  assert.equal(v1.watched, true);
  assert.equal(v1.watchedAt, 2000);

  const v2 = await catalog.get("v2");
  assert.equal(v2.watched, true);
  assert.equal(v2.watchedAt, 1500);
  assert.equal(v2.neverSkip, true);
  assert.equal(v2.neverSkipAt, 500);

  const v3 = await catalog.get("v3");
  assert.equal(v3.watched, false);
  assert.equal(v3.neverSkip, true);
  assert.equal(v3.neverSkipAt, 3000);
});

test("importCatalog skips malformed records gracefully", async () => {
  const catalog = createCatalog(createMemoryStorage());

  const res = await catalog.importCatalog([
    null,
    "not-an-object",
    {},
    { videoId: "" },
    { videoId: "  " },
    { videoId: "valid1", watched: true },
  ]);

  assert.equal(res.imported, 1);
  assert.equal(res.total, 1);
  assert.equal((await catalog.get("valid1")).watched, true);
});

test("importCatalog clamps negative timestamps to 0 and future timestamps to now", async () => {
  const catalog = createCatalog(createMemoryStorage());

  await catalog.importCatalog(
    [
      { videoId: "v_neg", watched: true, watchedAt: -500, neverSkip: true, neverSkipAt: -100 },
      { videoId: "v_future", watched: true, watchedAt: 50000, neverSkip: true, neverSkipAt: 60000 },
    ],
    1000
  );

  const vNeg = await catalog.get("v_neg");
  assert.equal(vNeg.watchedAt, 0);
  assert.equal(vNeg.neverSkipAt, 0);

  const vFuture = await catalog.get("v_future");
  assert.equal(vFuture.watchedAt, 1000);
  assert.equal(vFuture.neverSkipAt, 1000);
});


