# NoReplay

Firefox MV3 extension that skips already-watched YouTube videos upon opening, offering a 5-second countdown grace period to rewatch if desired, with offline-first storage and cross-device synchronization via Firefox Sync (Mozilla account).

## Structure

```
.
├── AGENTS.md          # Development guidelines and invariants
├── manifest.json      # Manifest V3 (background.scripts, storage, tabs)
├── background.js      # Background script entry point
├── lib/               # Background modules (progress.js, navigation.js, video.js, history-core.js, ...)
├── storage/           # Catalog storage (browser.storage.sync with storage.local fallback)
├── content/           # Content scripts & styles (skip, progress, navigator, history, hide-watched)
├── options/           # Options page & backup management (export/import/clear)
├── tests/             # node:test suite (fake browser & storage helpers)
├── _locales/          # Localization (en, pt_BR)
└── docs/
    └── plans/         # Preserved project plans
```

## Features

- **Offline-First**: Operates completely in your browser without requiring an external server or account. Watched history is stored locally in `browser.storage.local`.
- **Firefox Sync (Mozilla Account)**: When signed into Firefox with a Mozilla account, watched status and exceptions sync seamlessly across devices using `browser.storage.sync` with monotonic merge semantics.
- **Watch Threshold**: Videos are marked as watched when active playback accumulates the smaller of 30 seconds or 25% of duration. Seeking or skipping does not count; active playtime accumulates across sessions.
- **5-Second Countdown Grace Period**: An overlay gives you 5 seconds to cancel the skip by clicking anywhere or pressing Escape. You can also mark "never skip this video" to permanently whitelist it.
- **Hide Watched Videos**: Optional display preference to automatically hide watched videos and shelves from YouTube feeds and search results.
- **YouTube History Import**: One-click import directly reads your YouTube history page in the browser and batches items into your catalog.
- **YouTube Shorts Support**: Works on both regular `/watch?v=` videos and `/shorts/<id>`.
- **YouTube TV Support**: On the leanback app (`youtube.com/tv`), the video id is read from the `#/watch?v=` fragment and the overlay is mounted on the TV player root. Watch and Shorts pages behave exactly as before.

## Development

```bash
npm install          # Install dev dependencies (eslint + web-ext)
npm test             # Run unit tests (node --test tests/)
npm run lint         # Run ESLint
npm run lint:manifest  # Validate Manifest V3 via web-ext lint
npm run build        # Build extension package via web-ext build
npm run sign         # Bump patch (+0.0.1) and sign via web-ext sign
```

### Running Locally in Firefox

```bash
npx web-ext run
```

This launches a clean Firefox profile with NoReplay loaded as a temporary add-on.

## Related Documentation

- `AGENTS.md`: Architectural invariants (trust boundary, monotonic merge, quota handling, review rules).
- `docs/plans/`: Preserved project plans and RFCs.
