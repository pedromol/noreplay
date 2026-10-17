export function createSyncEngine({
  catalog,
  client,
  now: _now = () => Date.now(),
  onUnauthorized = () => {},
} = {}) {
  let isSyncing = false;
  let pending = false;
  let token = null;
  let stopped = false;

  function setToken(newToken) {
    token = newToken || null;
  }

  function isActive() {
    return Boolean(token);
  }

  function toPushRecord(record) {
    return {
      videoId: record.videoId,
      watched: Boolean(record.watched),
      watchedAt: record.watchedAt ?? 0,
      neverSkip: Boolean(record.neverSkip),
      neverSkipAt: record.neverSkipAt ?? 0,
    };
  }

  async function applyServerRecord(server) {
    if (!server || !server.videoId) return Promise.resolve(null);
    return catalog.get(server.videoId).then((existing) => {
      const watched = Boolean(server.watched);
      const neverSkip = Boolean(server.neverSkip);
      const serverWatchedAt = typeof server.watchedAt === "number" ? server.watchedAt : 0;
      const serverNeverSkipAt = typeof server.neverSkipAt === "number" ? server.neverSkipAt : 0;
      const existingWatchedAt = existing && typeof existing.watchedAt === "number" ? existing.watchedAt : 0;
      const existingNeverSkipAt = existing && typeof existing.neverSkipAt === "number" ? existing.neverSkipAt : 0;
      const nextWatched = watched || (existing && existing.watched) || false;
      const nextNeverSkip = neverSkip || (existing && existing.neverSkip) || false;
      const nextWatchedAt = nextWatched ? Math.max(existingWatchedAt, serverWatchedAt) : 0;
      const nextNeverSkipAt = nextNeverSkip ? Math.max(existingNeverSkipAt, serverNeverSkipAt) : 0;
      const patch = {};
      if (nextWatched !== (existing ? existing.watched : false) || nextWatchedAt !== (existing ? existing.watchedAt : 0)) {
        patch.watched = nextWatched;
        patch.watchedAt = nextWatchedAt;
      }
      if (nextNeverSkip !== (existing ? existing.neverSkip : false) || nextNeverSkipAt !== (existing ? existing.neverSkipAt : 0)) {
        patch.neverSkip = nextNeverSkip;
        patch.neverSkipAt = nextNeverSkipAt;
      }
      if (Object.keys(patch).length === 0) return existing ? { ...existing } : null;
      return catalog.update(server.videoId, patch);
    });
  }

  async function applyPull(records) {
    if (!Array.isArray(records)) return { applied: 0 };
    let applied = 0;
    for (const rec of records) {
      const result = await applyServerRecord(rec);
      if (result) applied += 1;
    }
    return { applied };
  }

  async function runCycle(trigger = "event") {
    if (!token || stopped) return { ok: false, reason: "inactive" };
    if (isSyncing) {
      pending = true;
      return { ok: false, reason: "syncing" };
    }
    isSyncing = true;
    try {
      const local = await catalog.list();
      const pushRecords = local.map(toPushRecord);
      const BATCH_SIZE = 500;
      if (pushRecords.length === 0) {
        const pushRes = await client.push(token, []);
        if (pushRes.status === 401) {
          token = null;
          stopped = true;
          onUnauthorized();
          return { ok: false, reason: "unauthorized", status: 401 };
        }
        if (!pushRes.ok && pushRes.status !== 0) {
          return { ok: false, reason: "push_failed", status: pushRes.status };
        }
      } else {
        for (let i = 0; i < pushRecords.length; i += BATCH_SIZE) {
          const batch = pushRecords.slice(i, i + BATCH_SIZE);
          const pushRes = await client.push(token, batch);
          if (pushRes.status === 401) {
            token = null;
            stopped = true;
            onUnauthorized();
            return { ok: false, reason: "unauthorized", status: 401 };
          }
          if (!pushRes.ok && pushRes.status !== 0) {
            return { ok: false, reason: "push_failed", status: pushRes.status };
          }
        }
      }
      const pullRes = await client.pull(token);
      if (pullRes.status === 401) {
        token = null;
        stopped = true;
        onUnauthorized();
        return { ok: false, reason: "unauthorized", status: 401 };
      }
      if (!pullRes.ok && pullRes.status !== 0) {
        return { ok: false, reason: "pull_failed", status: pullRes.status };
      }
      const body = await pullRes.json();
      await applyPull(body.records);
      return { ok: true, trigger };
    } catch {
      return { ok: false, reason: "error" };
    } finally {
      isSyncing = false;
      if (pending && token && !stopped) {
        pending = false;
        runCycle("coalesced").catch(() => {});
      } else {
        pending = false;
      }
    }
  }

  function trigger() {
    if (!token || stopped) return Promise.resolve({ ok: false, reason: "inactive" });
    if (isSyncing) {
      pending = true;
      return Promise.resolve({ ok: false, reason: "syncing" });
    }
    return runCycle("event");
  }

  function start(tokenValue) {
    token = tokenValue || null;
    stopped = false;
    if (!token) return;
    runCycle("login").catch(() => {});
  }

  function stop() {
    stopped = true;
    token = null;
    pending = false;
  }

  return {
    setToken,
    start,
    stop,
    trigger,
    runCycle,
    isActive: () => isActive(),
    get token() {
      return token;
    },
  };
}
