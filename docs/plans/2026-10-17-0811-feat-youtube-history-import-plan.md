---
title: YouTube History Import - Plan
type: feat
date: 2026-10-17
topic: youtube-history-import
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# YouTube History Import - Plan

## Goal Capsule

- **Objective:** NoReplay users can import their YouTube watch history to the extension catalog, ensuring videos watched before installing NoReplay are automatically skipped.
- **Means:** Import button in NoReplay Options that opens YouTube history page (`https://www.youtube.com/feed/history`), performs incremental extraction via auto-scrolling with a floating visual indicator, and persists entries to the local catalog synced to the server.
- **Product authority:** Request from user recorded in collaborative brainstorm session.
- **Execution profile:** code.
- **Open blockers:** None.

## Product Contract

### Summary

A feature initiated from the NoReplay Options page that opens YouTube's watch history in a new tab, automatically scrolls the page to extract the most recent X videos (or until end of history) while displaying a floating progress banner with cancel option, saves video IDs to the local catalog as watched, triggers sync with the server, and keeps the tab open with a final summary.

### Problem Frame

Users who installed NoReplay after already watching videos on YouTube have no way to mark them as watched. Without import, those videos won't be skipped and the user must manually mark exceptions or rewatch them to build the catalog.

### Users & Jobs To Be Done

- **Primary user:** Wants previously-watched videos to be skipped without having to rewatch them all.
- **Job:** "Import my YouTube history so NoReplay knows what I've already seen."

### Scope

**In scope:**
- Import button in Options page
- Open history page in new tab
- Auto-scroll with progress indicator
- Extract video IDs from history entries
- Mark as watched in local catalog
- Trigger sync
- Cancel support
- Summary display

**Out of scope:**
- Import from YouTube API (uses page scraping)
- Importing playlists/likes/watch later
- Selective date ranges
- Background import without opening tab

### Requirements

- **R1:** Options page has "Import YouTube history" button
- **R2:** Clicking opens `https://www.youtube.com/feed/history` in new tab
- **R3:** Floating banner shows progress (count extracted) and Cancel button
- **R4:** Auto-scroll extracts video IDs incrementally until end or cancelled
- **R5:** Extracted IDs marked as watched in catalog (no exceptions)
- **R6:** Sync triggered after import
- **R7:** Tab remains open showing final summary (count imported, cancelled/complete)
- **R8:** Works with YouTube's current history page structure

### Implementation Notes

- Content script injected into history page
- Communication via messages between options/background/content
- Deduplicate against existing catalog entries
- Handle dynamic loading as user scrolls

## Verification

- [ ] Button appears in Options
- [ ] Opens history tab correctly
- [ ] Progress banner displays and updates
- [ ] Auto-scroll works
- [ ] Videos marked as watched in catalog
- [ ] Sync completes
- [ ] Cancel stops extraction
- [ ] Summary shown at end
