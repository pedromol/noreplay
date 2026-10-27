---
title: "Migrate from custom backend sync to Firefox browser.storage.sync"
type: feat
date: 2026-10-27
topic: firefox-sync-migration
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Migrate from custom backend sync to Firefox browser.storage.sync

## Goal Capsule

- **Objective:** Drop the custom Go backend and account-based sync in favor of Firefox's built-in `browser.storage.sync` tied to the user's Mozilla account, while keeping all existing functionality (skip, 5-second grace period, "never skip", playtime tracking, history import, hide watched, Shorts support) working offline-first with no backend dependency.
- **Means:** Replace the sync client/engine architecture with direct use of `browser.storage.sync` for catalog sync, remove account/auth UI and server configuration, add quota handling with local fallback, listen for cross-device changes via `storage.onChanged`, and update manifest/permissions as needed.
- **Product authority:** User request in brainstorm session.
- **Execution profile:** code.
- **Open blockers:** need to handle storage.sync quotas (102KB total, 8KB/item, 512 items) and migration of existing local catalogs.

## Product Contract

### Summary

NoReplay currently operates with local-first storage (`browser.storage.local`) plus optional account sync to a self-hosted Go backend. This migration makes Firefox Sync the transport: the watched catalog syncs automatically via the user's Mozilla account with no signup/login/server config. The extension remains fully functional offline; sync is best-effort and quota-limited.

### Problem Frame

Maintaining a separate backend (Go service, auth, DB, deployment, TLS, tokens) adds operational overhead for a personal tool. Firefox provides built-in sync for webextensions via `browser.storage.sync` using the Mozilla account - leveraging it eliminates backend complexity.

### Users & Jobs To Be Done

- **Primary user:** Wants cross-device sync of watched videos without running their own server/account system.
- **Job:** "Sync my watched catalog across Firefox profiles/devices using my Mozilla account, with no separate login."

### Scope

**In scope:**
- Replace backend sync with `browser.storage.sync` for catalog data
- Remove account authentication (login/signup/logout), token management, server URL configuration
- Keep local-first behavior - extension must work without Mozilla account signed in
- Add fallback to `browser.storage.local` on quota/errors
- Listen for `browser.storage.sync.onChanged` to react to remote changes
- Handle sync limits (quota, item count) gracefully
- Migrate existing data from local to sync where possible
- Update options UI to remove account/server sections
- Update tests

**Out of scope:**
- Syncing playtime/pending progress in real-time (playtime is per-session accumulation; catalog is the source of truth for "watched"/"never skip")
- Supporting non-Firefox browsers
- Sharing catalogs between different Mozilla accounts
- Backend server code removal (keep for now or remove - but focus on extension changes per user request)

### Key Decisions

- **KD1:** Use `browser.storage.sync` as the sync transport. Catalog is the primary thing that needs to sync across devices (watched status + neverSkip exceptions + timestamps). Local catalog remains source of truth with sync as best-effort mirror.
- **KD2:** Keep `browser.storage.local` for sensitive/large/transient data (playtimeSeconds, auth tokens during transition, any large caches). Catalog may live in sync with local fallback.
- **KD3:** Manifest must have fixed `gecko.id` (already present). Ensure `storage` permission (present). 
- **KD4:** Implement quota-aware saves with try/catch fallback to local storage.
- **KD5:** Remove account UI - options page should just work offline with sync happening automatically if available.
- **KD6:** Follow monotonic merge semantics on sync changes (respect OR for flags, max for timestamps) similar to current behavior to avoid losing state.

### Requirements

- **R1:** Extension works fully offline without Mozilla account signed in (sync silently skipped/fails gracefully)
- **R2:** When signed into Firefox Sync, catalog syncs across devices
- **R3:** Changes sync in reasonable time; listen to `onChanged` for remote updates
- **R4:** Handle quota exceeded - fallback to local, don't break functionality
- **R5:** Remove account management, server config from UI and background
- **R6:** Maintain backward compatibility / migration path for existing local catalogs
- **R7:** Update tests to reflect new architecture

### Architecture

**Current:** `browser.storage.local` stores catalog + auth token. `sync/engine.js` + `sync/client.js` sync with backend. Background manages auth flows.

**New:** Catalog stored in `browser.storage.sync` (primary sync target) with `browser.storage.local` as fallback/cache. No backend calls, no auth. Listen to `storage.onChanged` for sync events from other devices. Background simplified - no sync engine/client, no auth message handlers.

**Storage layout:**
```js
// In browser.storage.sync (or local fallback)
{
  catalog: { /* videoId -> record */ },
  // maybe version/timestamp for migration
}
```

### Implementation Notes

- Update `storage/catalog.js` to accept either storage area or try sync first with local fallback
- Remove `sync/` directory (client, engine) or deprecate
- Simplify `lib/background.js` - remove auth handlers, sync engine, server config
- Update `options/` - remove account/server sections, simplify UI
- Update manifest if needed (storage permission already there)
- Add migration logic on init to move local catalog to sync if sync available
- Respect storage.sync limits - may need to be careful about catalog size
- Add `browser.storage.sync.onChanged` listener

### Risks & Mitigations

- **Risk:** Catalog exceeds storage.sync limits (512 items / 102KB). **Mitigation:** Check size before saving, fall back to local storage only, or implement pruning/partitioning strategy. Also need to monitor.
- **Risk:** Sync not available (no Mozilla account, sync disabled, Android). **Mitigation:** Graceful fallback to local-only operation.
- **Risk:** Conflicts between local and remote changes. **Mitigation:** Use monotonic merge like before when applying remote changes.
- **Risk:** Breaking existing users' data. **Mitigation:** Migration on first run reads from local, tries to write to sync, keeps local as backup.

### Verification

- [ ] All existing unit tests pass or are updated appropriately
- [ ] Extension works offline without sync
- [ ] Catalog syncs between profiles (manual test)
- [ ] Quota exceeded falls back gracefully
- [ ] No account UI elements remain
- [ ] No network calls to backend
- [ ] Lint passes, manifest valid
