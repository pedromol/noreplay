---
title: "Full Shorts Support in NoReplay"
date: 2026-10-17
type: feat
status: done
artifact_contract: ce-unified-plan/v1
product_contract_source: session-decisions
execution: code
---

# Full Shorts Support in NoReplay

## Goal Capsule

- **Objective:** Make NoReplay handle YouTube Shorts end-to-end: import Shorts from history, hide watched Shorts cards in shelves/rows (including hiding entire shelves when all are watched), and enable skip/progress tracking in the `/shorts/<id>` player.
- **Means:** Extend `extractVideoId` to support `/shorts/<id>`, recognize `/shorts/` anchors in history import and hiding logic, and add shelf evaluation (`shouldHideShelf`) in the hide-watched content script.
- **Product Authority:** Decisions recorded in session (user chose full scope: import + hide + skip; hide entire row when empty of unwatched items).
- **Open Blockers:** None.

## Product Contract

### Summary

When importing YouTube history, Shorts are also added to the catalog. When browsing, already-watched Shorts cards are hidden from shelves (e.g., the "Shorts" row on Home). When all visible Shorts in a shelf are watched (and none have "never skip" exceptions), the entire shelf—including its title—is hidden. In the Shorts player, playtime accumulates and the 5-second skip overlay appears just like for regular videos.

### Key Decisions

- **KD1: Full `/shorts/` support (import + hide + skip/progress).** *(session-settled: user-directed — chosen over limiting to import+hide: maintain a single canonical video ID source for all features.)* Governs R1, R4.
- **KD2: Hide entire shelf row when all visible Shorts are watched.** *(session-settled: user-directed — chosen over leaving empty shelf with title: avoids ghost "Shorts" shelves on Home.)* Governs R3.
- **KD3: Never hide shelf if empty, has no identifiable IDs, or has any unwatched video with/without exceptions.** Governs R3.

### Users & Jobs To Be Done

- **Primary user:** Wants consistent NoReplay behavior across regular videos and Shorts.
- **Job:** "Skip watched Shorts automatically and clean up Shorts shelves like regular video lists."

### Scope

**In scope:**
- Parse `/shorts/<id>` URLs in `extractVideoId`
- Import Shorts from YouTube history
- Hide watched Shorts cards in shelves
- Hide entire shelf when all watched
- Skip overlay and progress tracking in Shorts player
- Deduplicate between `/watch?v=` and `/shorts/`

**Out of scope:**
- Changes to Shorts UI beyond hiding/skipping
- Modifying YouTube Shorts algorithm
- Server changes

### Requirements

- **R1:** `extractVideoId` resolves Shorts URLs (`/shorts/<videoId>`)
- **R2:** History import extracts Shorts from history page
- **R3:** Hide-watched logic hides individual Shorts cards and evaluates shelves
- **R4:** Skip/progress work in Shorts player containers
- **R5:** Deduplication between watch and shorts forms

### Implementation Notes

- Extend URL parsing in `lib/video.js`
- Update history extraction to recognize shorts links
- Add `shouldHideShelf` logic in hide-watched-core
- Handle Shorts-specific DOM containers (`ytd-shorts-lockup-viewer`, `ytd-reel-item-renderer`)

## Verification

- [ ] Shorts IDs extracted correctly
- [ ] Shorts imported from history
- [ ] Watched Shorts hidden in shelves
- [ ] Empty shelves hidden entirely
- [ ] Skip overlay works in Shorts player
- [ ] Progress accumulates for Shorts
- [ ] No duplicates between watch/shorts
