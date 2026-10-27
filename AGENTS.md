# AGENTS.md — NoReplay Guidelines

NoReplay is a personal tool that skips already-watched YouTube videos upon opening, offering a 5-second countdown grace period to rewatch if desired, with catalog synchronization across devices via Firefox Sync (Mozilla account).

The system consists of:
1. **Firefox Extension (MV3)**: Detects playback on YouTube watch and shorts pages, displays the skip overlay, tracks progress, hides watched videos, imports history, and manages local and Firefox Sync catalog storage. No custom backend server is needed.

---

## Critical Commands

All commands run directly from the repository root:

```bash
npm test                 # Run node:test test suite
npm run lint             # Run ESLint across extension files
npm run lint:manifest    # Validate Manifest V3 via web-ext lint
npm run build            # Package extension via web-ext build
npx web-ext run          # Launch extension in a clean Firefox profile
```

---

## Core Architecture & Invariants

### 1. Security & Page Trust Boundary
- **Page events are triggers, not data**: Video IDs sent from content scripts (`navigator.js`, `progress.js`, `skip.js`) must never be trusted blindly. The background worker always resolves the canonical video ID from the browser-verified tab URL (`browser.tabs.get`).
- **Sender Boundary**: Options and administrative messages (`catalog-clear`, `catalog-export`, `catalog-import`) sent directly from web tabs are rejected as unauthorized (`{ ok: false, error: "unauthorized" }`).
- **Minimal Host Permissions**: The extension only requires host access to YouTube (`https://www.youtube.com/*`, `https://m.youtube.com/*`). No remote server or backend hosts are accessed.

### 2. Extension Lifecycle & Storage
- **Firefox MV3 Architecture**: Uses `background.scripts` with ES modules (not service workers).
- **Local-First (Offline Operation)**: The extension operates completely without a Mozilla account using `browser.storage.local`. Detection, skip countdown, progress accumulation, hide watched videos, and never-skip exceptions function offline.
- **Threshold Rule**: Videos are marked watched when active playback accumulates the smaller of 30 seconds and 25% of duration. Playtime accumulates across sessions; seeking/skipping does not count.
- **Countdown Grace Period**: 5-second overlay appears on watched videos without exceptions. Clicking anywhere cancels skip and lets the video play; checking "never skip" marks an exception and allows the video to play.

### 3. Monotonic Catalog Synchronization via Firefox Sync
- **Built-in Mozilla Account Transport**: Uses `browser.storage.sync` with `browser.storage.local` cache/fallback. When the user is logged into their Mozilla account, Firefox automatically synchronizes catalog changes across devices.
- **Monotonic Merge (`storage.onChanged`)**:
  - `watched` flag: boolean OR (once watched, stays watched).
  - `neverSkip` flag: boolean OR (exception always wins over watch state).
  - Timestamps (`watchedAt`, `neverSkipAt`): keep `max(stored, incoming)`, clamped to client clock (`now`), with negative values clamped to 0. Timestamps are reset to 0 if their respective flag is false.
- **Quota Resilience**: Changes under the quota threshold (90KB) write to both `storage.sync` and `storage.local`. If the quota is exceeded or sync fails, storage falls back gracefully to `storage.local` without breaking functionality.

---

## Development & Review Rules

- **Preserve Existing Documentation**: Keep existing comments, tests, and plan documents (`docs/plans/`) intact.
- **Verification Before Commit**: Never commit without running `npm test`, `npm run lint`, and `npm run lint:manifest`.
- **Conventional Commits**: Format commit messages as `type(scope): description`, e.g., `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`.
