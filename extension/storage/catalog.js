export const CATALOG_KEY = "catalog";

export function emptyRecord(videoId) {
  return {
    videoId,
    watched: false,
    watchedAt: 0,
    neverSkip: false,
    neverSkipAt: 0,
  };
}

export function createCatalog(storageArea) {
  let queue = Promise.resolve();

  async function readAll() {
    const stored = await storageArea.get(CATALOG_KEY);
    const value = stored ? stored[CATALOG_KEY] : undefined;
    if (!value || typeof value !== "object") return {};
    return value;
  }

  function serialize(task) {
    const result = queue.then(task, task);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  function update(videoId, patch) {
    return serialize(async () => {
      const all = await readAll();
      const existing = all[videoId] ?? emptyRecord(videoId);
      const next = { ...existing, ...patch, videoId };
      all[videoId] = next;
      await storageArea.set({ [CATALOG_KEY]: all });
      return { ...next };
    });
  }

  async function get(videoId) {
    const all = await readAll();
    return all[videoId] ? { ...all[videoId] } : null;
  }

  async function list() {
    const all = await readAll();
    return Object.values(all).map((record) => ({ ...record }));
  }

  async function stats() {
    const all = await readAll();
    let watched = 0;
    let neverSkip = 0;
    const records = Object.values(all);
    for (const record of records) {
      if (record && record.watched) watched += 1;
      if (record && record.neverSkip) neverSkip += 1;
    }
    return {
      total: records.length,
      watched,
      neverSkip,
    };
  }

  function clear() {
    return serialize(async () => {
      await storageArea.remove([CATALOG_KEY, "playtimeSeconds"]);
      return true;
    });
  }

  function markWatched(videoId, at) {
    return update(videoId, { watched: true, watchedAt: at });
  }

  function bulkMarkWatched(videoIds, at) {
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return serialize(async () => []);
    }
    return serialize(async () => {
      const all = await readAll();
      const updated = [];
      for (const videoId of videoIds) {
        if (!videoId || typeof videoId !== "string") continue;
        const existing = all[videoId] ?? emptyRecord(videoId);
        const watchedAt = Math.max(existing.watchedAt ?? 0, at);
        const next = { ...existing, watched: true, watchedAt, videoId };
        all[videoId] = next;
        updated.push({ ...next });
      }
      await storageArea.set({ [CATALOG_KEY]: all });
      return updated;
    });
  }

  function markNeverSkip(videoId, at) {
    return update(videoId, { neverSkip: true, neverSkipAt: at });
  }

  function shouldSkip(videoId) {
    return get(videoId).then((record) => Boolean(record && record.watched && !record.neverSkip));
  }

  function importCatalog(records, at = Date.now()) {
    if (!Array.isArray(records) || records.length === 0) {
      return serialize(async () => {
        const currentStats = await stats();
        return { imported: 0, total: currentStats.total };
      });
    }
    return serialize(async () => {
      const all = await readAll();
      let importedCount = 0;
      for (const rec of records) {
        if (!rec || typeof rec !== "object" || !rec.videoId || typeof rec.videoId !== "string") {
          continue;
        }
        const videoId = rec.videoId.trim();
        if (!videoId) continue;
        const existing = all[videoId] ?? emptyRecord(videoId);
        const watched = Boolean(rec.watched) || Boolean(existing.watched);
        const neverSkip = Boolean(rec.neverSkip) || Boolean(existing.neverSkip);
        const rawWatchedAt = typeof rec.watchedAt === "number" ? rec.watchedAt : (rec.watched ? at : 0);
        const rawNeverSkipAt = typeof rec.neverSkipAt === "number" ? rec.neverSkipAt : (rec.neverSkip ? at : 0);
        const recWatchedAt = Math.min(Math.max(0, rawWatchedAt), at);
        const recNeverSkipAt = Math.min(Math.max(0, rawNeverSkipAt), at);
        const existingWatchedAt = existing && typeof existing.watchedAt === "number" ? Math.max(0, existing.watchedAt) : 0;
        const existingNeverSkipAt = existing && typeof existing.neverSkipAt === "number" ? Math.max(0, existing.neverSkipAt) : 0;
        const nextWatchedAt = watched ? Math.max(existingWatchedAt, recWatchedAt) : 0;
        const nextNeverSkipAt = neverSkip ? Math.max(existingNeverSkipAt, recNeverSkipAt) : 0;

        all[videoId] = {
          videoId,
          watched,
          watchedAt: nextWatchedAt,
          neverSkip,
          neverSkipAt: nextNeverSkipAt,
        };
        importedCount += 1;
      }
      await storageArea.set({ [CATALOG_KEY]: all });
      return { imported: importedCount, total: Object.keys(all).length };
    });
  }

  return {
    get,
    list,
    stats,
    clear,
    update,
    markWatched,
    bulkMarkWatched,
    markNeverSkip,
    shouldSkip,
    importCatalog,
  };
}
