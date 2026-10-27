---
title: "Hiding Already-Watched Videos on YouTube Pages"
date: 2026-10-17
type: feat
status: draft
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Hiding Already-Watched Videos on YouTube Pages

## Goal Capsule

- **Objective:** Eliminate visual clutter and cognitive rework when browsing YouTube by completely hiding cards of already-watched videos in all listings and recommendations, while keeping navigation smooth and natural grid reflow.
- **Means:** Apply hiding via CSS (`display: none`) to video card containers through a content script integrated with NoReplay's local catalog.
- **Product Authority:** This document specifies display behavior on YouTube pages based on the NoReplay catalog. It does not alter YouTube account watch history data, nor modify backend sync rules or player skip flow.
- **Open Blockers:** None.

## Product Contract

### Summary

Automatically hide already-watched videos in all YouTube listings (Home, Subscriptions, Search, Channels, and player sidebar). Cards for watched videos are collapsed entirely via CSS (`display: none`), allowing YouTube's native grid to reorganize without empty gaps. Exceptions marked with "Never skip" are preserved. A toggle switch is available in the extension options to enable/disable this feature.

### Problem Frame

Browsing YouTube shows many videos the user has already watched, creating visual noise and requiring extra scrolling/cognitive effort to find unwatched content. Hiding them improves navigation efficiency.

### Users & Jobs To Be Done

- **Primary user:** Wants to focus on unwatched content without distraction from already-seen videos.
- **Job:** "Hide videos I've already watched from YouTube recommendations and listings."

### Scope

**In scope:**
- Hide watched videos on Home, Subscriptions, Search results, Channel pages, Trending, player sidebar recommendations
- Preserve videos marked "never skip" (exceptions)
- Toggle in Options page (on by default)
- CSS-based hiding for smooth reflow
- Works offline using local catalog

**Out of scope:**
- Hiding on Shorts shelf (handled in Shorts support plan)
- Modifying YouTube's history
- Server-side changes
- Custom hiding rules per page type

### Requirements

- **R1:** Content script hides watched video cards via `display: none`
- **R2:** Exceptions (neverSkip) are not hidden
- **R3:** Toggle in Options: "Hide watched videos" (default enabled)
- **R4:** Works across all major YouTube listing pages
- **R5:** Grid reflow naturally without layout breaks
- **R6:** Respects catalog state from local storage
- **R7:** Updates dynamically as catalog changes

### Implementation Notes

- Use CSS injection or inline styles
- Identify video card containers by YouTube's DOM structure
- Match by video ID extracted from links/attributes
- Observe DOM mutations for dynamically loaded content
- Integrate with hide-watched-core logic

## Verification

- [ ] Watched videos hidden on Home
- [ ] Watched videos hidden on Subscriptions
- [ ] Watched videos hidden in Search results
- [ ] Never-skip videos remain visible
- [ ] Toggle in Options works
- [ ] Grid reflows correctly
- [ ] Works offline
- [ ] Dynamic loading handled
