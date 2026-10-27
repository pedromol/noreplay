# NoReplay

Firefox MV3 extension + Go service that skips already-watched YouTube videos, with a local catalog, monotonic synchronization (KTD6), and Shorts support.

## Structure

```
.
├── AGENTS.md          # Development guidelines and invariants
├── extension/         # Firefox extension (MV3, ES modules, background scripts)
│   ├── content/       # Content scripts (skip, progress, history, hide-watched, navigator)
│   ├── lib/           # Shared modules (video.js, background.js, navigation.js, hide-watched-core.js, ...)
│   ├── sync/          # Client/sync engine with server
│   ├── storage/       # Local catalog (browser.storage.local)
│   ├── options/       # Options page
│   ├── tests/         # node:test (lint + lint:manifest + build via web-ext)
│   └── manifest.json  # MV3, tab/storage permissions; no service worker
├── server/            # Go HTTP (net/http, modernc.org/sqlite, CGO-free, WAL)
│   ├── cmd/server/    # Entry point
│   ├── internal/      # httpapi, store, auth (argon2id, SHA-256 tokens 30d)
│   ├── deploy/        # Dockerfile + Kubernetes (deployment.yaml, k8s/)
│   └── README.md      # Local execution (make run / check / build)
└── docs/
    └── plans/         # Preserved project plans
```

## Goals

- **Offline-first**: The extension operates without an account via `browser.storage.local`. Detection, 5-second countdown, playtime accumulation, and "never skip" exceptions all work offline.
- **Watch threshold**: A video is marked as watched when active playtime reaches the smaller of 30 seconds or 25% of its duration. Seeking/skipping does not count toward playtime; playtime accumulates across sessions.
- **Graceful counting**: The overlay appears on watched videos without exceptions. Clicking anywhere cancels the skip and lets the video play. Checking "never skip" marks an exception and allows the video to play.
- **Monotonic synchronization (KTD6)**: Merge uses boolean OR for `watched`/`neverSkip`, keeps `max(stored, incoming)` for timestamps (clamped to the server clock), resets timestamps to 0 if flags are false. Coalesces consecutive sync calls within an active sync cycle. Logout isolates the session (does not erase the local catalog).
- **Shorts support**: `extractVideoId` resolves `/shorts/<id>`. Containers `ytd-shorts-lockup-viewer`/`ytd-reel-item-renderer` are hidden. History and progress handle deduplication between `/watch?v=` and `/shorts/`.
- **Security**: Tokens are passed only in the `Authorization: Bearer` header over TLS. Signup is restricted to `SIGNUP_EMAIL` (fail-closed). Rate limiting of 5 requests/minute on `/v1/signup` and `/v1/login`.

## Related docs and references

- `AGENTS.md`: Architectural invariants (trust boundary, monotonic merge, passkeys, rate limiting, SQLite WAL/foreign_keys, fail-closed). Do not edit without re-reading it.
- `extension/README.md`: Build instructions (`npm test`, `npm run lint`, `npm run lint:manifest`, `npm run build` via web-ext) and manifest details.
- `server/README.md` / `Makefile`: Local execution (`make run`/`check`/`build`; static binary `bin/noreplay`); environment variables `ADDR`, `DATABASE_PATH`, `SIGNUP_EMAIL`.
- `docs/plans/`: Preserved project plans as per documentation rules.
- `extension/manifest.json`: MV3 (`background.scripts`, no service workers). Requires tab/URL permissions for `browser.tabs.get` (canonical video ID resolution).

## Quick verification

```sh
# Extension
cd extension && npm test && npm run lint && npm run lint:manifest

# Server
cd server && go test ./... && go vet ./... && make check
```

---
*Created 2026-10-22. Based on AGENTS.md and existing code; does not replace plans in `docs/plans/` or existing tests.*
