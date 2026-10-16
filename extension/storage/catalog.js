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

  function markWatched(videoId, at) {
    return update(videoId, { watched: true, watchedAt: at });
  }

  function markNeverSkip(videoId, at) {
    return update(videoId, { neverSkip: true, neverSkipAt: at });
  }

  function shouldSkip(videoId) {
    return get(videoId).then((record) => Boolean(record && record.watched && !record.neverSkip));
  }

  return { get, list, update, markWatched, markNeverSkip, shouldSkip };
}
