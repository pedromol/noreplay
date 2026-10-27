---
title: NoReplay - Plan
type: feat
date: 2026-10-16
topic: youtube-watch-skip
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
deepened: 2026-10-16
---

# NoReplay - Plan

## Goal Capsule

- **Objective:** YouTube videos you've already watched are skipped on opening with a 5-second grace period to rewatch — and this behavior applies on any device where you're logged in.
- **Means:** Firefox extension that detects, warns, and skips; Go backend that stores the catalog per account and syncs it across devices (KTD3, KTD6, KTD8).
- **Product authority:** Personal request from the user — personal-use tool, single account, scope defined in this document.
- **Execution profile:** code.
- **Open blockers:** none.

## Product Contract

### Summary

Firefox extension + Go backend. The extension detects on the video page that the content has already been watched, displays a 5-second popup, and if no click occurs, advances to the next suggested video — if clicked, it lets the video play. The catalog starts local and syncs per personal account to work across all of the user's devices. The backend is delivered with a Dockerfile and Kubernetes manifests.

### Problem Frame

Ending up on an already-watched video today means manually clicking the skip/next button or choosing another suggestion from the sidebar. The cost is small per video, but it repeats every session: nothing remembers what's been seen, and discarding it is always manual.

### Users & Jobs To Be Done

- **Primary user (owner):** Wants to avoid rewatching videos already seen, with a quick way to override when desired.
- **Job:** "When I open an already-watched YouTube video, skip it automatically but give me 5 seconds to change my mind."

### Scope

**In scope:**
- Firefox MV3 extension (content scripts + background + options)
- Catalog with watched state and "never skip" exceptions
- 5-second skip countdown overlay
- Local-first operation (offline capable)
- Account-based sync to Go backend
- Shorts support (as per later plan)
- Hide watched videos (as per later plan)
- History import (as per later plan)

**Out of scope:**
- Other browsers
- Multi-account support
- Sharing catalogs between users
- YouTube account integration beyond reading page state
- Modifying YouTube's own history

### Non-functional requirements

- **Offline-first:** Detection, countdown, and exceptions must work without network.
- **Security:** Tokens only in `Authorization: Bearer` over TLS; signup restricted by allowlist (fail-closed).
- **Sync:** Monotonic merge (KTD6) — OR for flags, `max` for timestamps, clamped to server time.
- **Performance:** Minimal DOM impact, no blocking of YouTube page load.
- **Persistence:** Local catalog survives logout (session only cleared).

## Architecture

See AGENTS.md for invariants. Key points:
- Background owns `browser.storage.local` (catalog + session token)
- Content scripts handle DOM/page signals only
- Pure logic in `lib/` and `storage/`
- Backend: Go + SQLite (WAL), argon2id passwords, 256-bit tokens hashed (SHA-256), 30-day TTL

## Plan

Implementation details covered in codebase; this plan captures product/architecture decisions.
