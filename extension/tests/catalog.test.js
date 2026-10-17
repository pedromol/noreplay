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
