export const PLAYTIME_KEY = "playtimeSeconds";

const MAX_THRESHOLD_SECONDS = 30;
const THRESHOLD_FRACTION = 0.25;

export function thresholdSeconds(durationSeconds) {
  if (typeof durationSeconds !== "number") return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.min(MAX_THRESHOLD_SECONDS, durationSeconds * THRESHOLD_FRACTION);
}

export function createProgressTracker({ catalog, storage, now = () => Date.now() } = {}) {
  let queue = Promise.resolve();

  function serialize(task) {
    const result = queue.then(task, task);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function readTotals() {
    const stored = await storage.get(PLAYTIME_KEY);
    const value = stored ? stored[PLAYTIME_KEY] : undefined;
    if (!value || typeof value !== "object") return {};
    return value;
  }

  function persistedTotal(totals, videoId) {
    const value = totals[videoId];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
    return value;
  }

  function record({ videoId, deltaSeconds, durationSeconds } = {}) {
    return serialize(async () => {
      const threshold = thresholdSeconds(durationSeconds);
      const idValid = typeof videoId === "string" && videoId.length > 0;
      const deltaValid =
        typeof deltaSeconds === "number" && Number.isFinite(deltaSeconds) && deltaSeconds > 0;

      if (!idValid || !deltaValid || threshold === null) {
        return { marked: false, alreadyWatched: false, total: null, threshold };
      }

      const existing = await catalog.get(videoId);
      if (existing && existing.watched) {
        return { marked: false, alreadyWatched: true, total: null, threshold };
      }

      const totals = await readTotals();
      const total = persistedTotal(totals, videoId) + deltaSeconds;
      totals[videoId] = total;
      await storage.set({ [PLAYTIME_KEY]: totals });

      if (total >= threshold) {
        await catalog.markWatched(videoId, now());
        return { marked: true, alreadyWatched: false, total, threshold };
      }
      return { marked: false, alreadyWatched: false, total, threshold };
    });
  }

  return { record };
}
