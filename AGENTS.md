# AGENTS.md — NoReplay Guidelines

NoReplay is a personal tool that skips already-watched YouTube videos upon opening, offering a 5-second countdown grace period to rewatch if desired, with catalog synchronization across devices.

The system consists of:
1. **Firefox Extension (MV3)**: Detects playback on YouTube watch and shorts pages, displays the skip overlay, tracks progress, and manages local/synced catalog storage.
2. **Go Backend Service**: Stores user accounts, sessions, and consolidated watch catalogs in SQLite, with Dockerfile and Kubernetes manifests.

---

## Critical Commands

### Extension (`extension/`)
```bash
cd extension
npm test                 # Run node:test test suite
npm run lint             # Run ESLint across extension files
npm run lint:manifest    # Validate Manifest V3 via web-ext lint
npx web-ext run          # Launch extension in a clean Firefox profile
```

### Server (`server/`)
```bash
cd server
go test ./...            # Run all unit/integration tests
go vet ./...             # Run Go static analysis
go run ./cmd/server      # Run server locally (ADDR=:8080, DATABASE_PATH=./data/noreplay.db)
```

### Deploy & Packaging
```bash
docker build -t noreplay:latest server
kubectl apply --dry-run=client -f server/deploy/k8s/deployment.yaml
```

---

## Core Architecture & Invariants

### 1. Security & Page Trust Boundary
- **Page events are triggers, not data**: Video IDs sent from content scripts (`navigator.js`, `progress.js`, `skip.js`) must never be trusted blindly. The background worker always resolves the canonical video ID from the browser-verified tab URL (`browser.tabs.get`).
- **Bearer Token Security**: Tokens are passed exclusively in the `Authorization: Bearer <token>` header over TLS/HTTPS. Tokens must never appear in URLs, query parameters, error bodies, or console logs.
- **Fail-Closed Signup**: Account registration is restricted to the single email configured in `SIGNUP_EMAIL`. If empty or unset, registration is completely disabled (`403 Forbidden`).
- **Pre-Auth Rate Limiting**: `/v1/signup` and `/v1/login` enforce 5 attempts per minute keyed on normalized email, returning `429 Too Many Requests` with a `Retry-After` header.

### 2. Extension Lifecycle & Storage
- **Firefox MV3 Architecture**: Uses `background.scripts` with ES modules (not service workers).
- **Local-First (Offline Operation)**: The extension operates completely without an account using `browser.storage.local`. Detection, skip countdown, progress accumulation, and never-skip exceptions function offline.
- **Threshold Rule**: Videos are marked watched when active playback accumulates the smaller of 30 seconds and 25% of duration. Playtime accumulates across sessions; seeking/skipping does not count.
- **Countdown Grace Period**: 5-second overlay appears on watched videos without exceptions. Clicking anywhere cancels skip and lets the video play; checking "never skip" marks an exception and allows the video to play.

### 3. Monotonic Catalog Synchronization (KTD6)
- **Monotonic Merge**:
  - `watched` flag: boolean OR (once watched, stays watched).
  - `neverSkip` flag: boolean OR (exception always wins over watch state).
  - Timestamps (`watchedAt`, `neverSkipAt`): keep `max(stored, incoming)`, clamped to the server clock (`now`), with negative values clamped to 0. Timestamps are reset to 0 if their respective flag is false.
- **Event-Driven Sync**: Sync triggers on login, video navigation, when a video crosses the watch threshold, and when "never skip" is toggled. Consecutive calls within an active sync cycle are coalesced.
- **Logout Isolation**: Logging out stops sync and clears the session token from `storage.local`, but keeps the local catalog intact.

### 4. Database & Backend
- **SQLite Engine**: Powered by `modernc.org/sqlite` (pure Go, CGO-free). Runs in WAL mode with `busy_timeout(5000)` and `foreign_keys(1)`.
- **Passkeys & Passwords**: Passwords hashed with `argon2id` (min length: 12 chars). Tokens are 256-bit CSPRNG, stored only as SHA-256 hashes with 30-day TTL.
- **RFC Standards**: Protected routes return HTTP 401 with `WWW-Authenticate: Bearer` on missing, expired, or invalid tokens.

---

## Development & Review Rules

- **Preserve Existing Documentation**: Keep existing comments, tests, and plan documents (`docs/plans/`) intact.
- **Verification Before Commit**: Never commit without running `npm test`, `npm run lint`, `npm run lint:manifest` in `extension/`, and `go test ./...`, `go vet ./...` in `server/`.
- **Conventional Commits**: Format commit messages as `type(scope): description`, e.g., `feat(extension): ...`, `feat(server): ...`, `fix: ...`, `chore: ...`.
