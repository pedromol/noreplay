import { CATALOG_KEY } from "./catalog.js";

function getTotalBytes(obj) {
  try {
    const str = JSON.stringify(obj);
    if (typeof globalThis.Blob !== "undefined") {
      return new globalThis.Blob([str]).size;
    }
    return str.length * 2;
  } catch {
    return Infinity;
  }
}

function estimateCatalogSize(catalog) {
  const data = { [CATALOG_KEY]: catalog };
  return getTotalBytes(data);
}

export function createSyncCatalog({ browser, localStorage, syncStorage } = {}) {
  const b = browser || (typeof globalThis !== "undefined" ? globalThis.browser : null);
  const local = localStorage || (b && b.storage ? b.storage.local : null);
  const sync = syncStorage || (b && b.storage ? b.storage.sync : null);

  let useSync = Boolean(sync);
  let queue = Promise.resolve();

  function serialize(task) {
    const result = queue.then(task, task);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function readAll() {
    if (useSync && sync) {
      try {
        const stored = await sync.get(CATALOG_KEY);
        const value = stored ? stored[CATALOG_KEY] : undefined;
        if (value && typeof value === "object") {
          return value;
        }
      } catch {
        useSync = false;
      }
    }
    if (local) {
      try {
        const stored = await local.get(CATALOG_KEY);
        const value = stored ? stored[CATALOG_KEY] : undefined;
        if (value && typeof value === "object") {
          return value;
        }
      } catch {}
    }
    return {};
  }

  async function writeAll(catalog) {
    const data = { [CATALOG_KEY]: catalog };
    if (useSync && sync) {
      try {
        const size = estimateCatalogSize(catalog);
        if (size < 90000) {
          await sync.set(data);
          if (local) {
            try {
              await local.set(data);
            } catch {}
          }
          return true;
        } else {
          if (local) {
            await local.set(data);
          }
          return true;
        }
      } catch {
        useSync = false;
        if (local) {
          await local.set(data);
          return true;
        }
        throw new Error("storage_failed");
      }
    }
    if (local) {
      await local.set(data);
      return true;
    }
    return false;
  }

  async function migrateFromLocal() {
    if (!local) return;
    try {
      const stored = await local.get(CATALOG_KEY);
      const localCatalogData = stored ? stored[CATALOG_KEY] : undefined;
      if (!localCatalogData || typeof localCatalogData !== "object") return;
      if (Object.keys(localCatalogData).length === 0) return;

      if (useSync && sync) {
        try {
          const syncStored = await sync.get(CATALOG_KEY);
          const syncData = syncStored ? syncStored[CATALOG_KEY] : undefined;
          if (syncData && typeof syncData === "object" && Object.keys(syncData).length > 0) {
            return;
          }
        } catch {}
      }

      if (useSync && sync) {
        try {
          const size = estimateCatalogSize(localCatalogData);
          if (size < 90000) {
            await sync.set({ [CATALOG_KEY]: localCatalogData });
            return;
          }
        } catch {}
      }
    } catch {}
  }

  migrateFromLocal().catch(() => {});

  if (b && b.storage && b.storage.onChanged && sync) {
    b.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[CATALOG_KEY]) return;
      const remote = changes[CATALOG_KEY].newValue;
      if (!remote || typeof remote !== "object") return;
      serialize(async () => {
        const now = Date.now();
        const localCatalog = await readAll();
        const merged = { ...localCatalog };
        let changed = false;
        for (const [videoId, rec] of Object.entries(remote)) {
          if (!rec || typeof rec !== "object") continue;
          const existing = merged[videoId];
          const watched = Boolean(rec.watched) || (existing && existing.watched);
          const neverSkip = Boolean(rec.neverSkip) || (existing && existing.neverSkip);
          const rawWatchedAt = typeof rec.watchedAt === "number" ? rec.watchedAt : (rec.watched ? now : 0);
          const rawNeverSkipAt =
            typeof rec.neverSkipAt === "number" ? rec.neverSkipAt : (rec.neverSkip ? now : 0);
          const watchedAt = watched ? Math.max(existing ? Math.max(0, existing.watchedAt) : 0, Math.min(Math.max(0, rawWatchedAt), now)) : 0;
          const neverSkipAt = neverSkip ? Math.max(existing ? Math.max(0, existing.neverSkipAt) : 0, Math.min(Math.max(0, rawNeverSkipAt), now)) : 0;
          const next = { videoId, watched, watchedAt, neverSkip, neverSkipAt };
          if (!existing || JSON.stringify(next) !== JSON.stringify(existing)) {
            merged[videoId] = next;
            changed = true;
          }
        }
        if (changed) {
          await writeAll(merged);
        }
      });
    });
  }

  function update(videoId, patch) {
    return serialize(async () => {
      const all = await readAll();
      const existing = all[videoId] ?? { videoId, watched: false, watchedAt: 0, neverSkip: false, neverSkipAt: 0 };
      const next = { ...existing, ...patch, videoId };
      all[videoId] = next;
      await writeAll(all);
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
      if (useSync && sync) {
        try {
          await sync.remove([CATALOG_KEY]);
        } catch {}
      }
      if (local) {
        try {
          await local.remove([CATALOG_KEY, "playtimeSeconds"]);
        } catch {}
      }
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
        const existing = all[videoId] ?? { videoId, watched: false, watchedAt: 0, neverSkip: false, neverSkipAt: 0 };
        const watchedAt = Math.max(existing.watchedAt ?? 0, at);
        const next = { ...existing, watched: true, watchedAt, videoId };
        all[videoId] = next;
        updated.push({ ...next });
      }
      await writeAll(all);
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
      const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
      for (const rec of records) {
        if (!rec || typeof rec !== "object" || !rec.videoId || typeof rec.videoId !== "string") {
          continue;
        }
        const videoId = rec.videoId.trim();
        if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) continue;
        const existing = all[videoId] ?? { videoId, watched: false, watchedAt: 0, neverSkip: false, neverSkipAt: 0 };
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
      await writeAll(all);
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

export { CATALOG_KEY };
