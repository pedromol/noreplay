# NoReplay — Firefox Extension

Automatically skips YouTube videos that have already been watched, giving you 5 seconds to rewatch before moving to the next suggested video.

## Architecture

- The **background** (MV3 event page, `background.scripts` with `type: "module"`) is the sole owner of `storage.local`: the catalog and session token. Content scripts and the options page only access this state through messages.
- **Content scripts** are classic scripts (Firefox does not support ES module content scripts) and only handle DOM interactions and page signals.
- Pure, testable logic lives in `lib/` and `storage/`, imported by the background and tests (`node --test`).

## Development

```bash
npm install          # eslint + web-ext (devDependencies)
npm test             # unit tests (node --test)
npm run lint         # eslint
npm run lint:manifest  # web-ext lint (validates MV3 manifest)
```

Manual smoke test in real Firefox:

```bash
npx web-ext run --source-dir .
```

Load YouTube, navigate to a video, watch past the threshold, reopen the video, and verify the popup appears. The full smoke checklist (AE1–AE8) is in the "Manual smoke test" section below.

## Permanent installation

Permanent installation requires signing through AMO or using Firefox Developer mode (`about:debugging` → "Load Temporary Add-on"). No infrastructure dependency is required.

## Manual smoke test (AE1–AE8)

Pending execution in Firefox with real YouTube. This is the only test of behavior against live YouTube; automation against the real site is out of scope.

- [ ] AE1 — Watched video without exception: with no interaction for 5s, the next suggested video plays.
- [ ] AE2 — Clicking the popup cancels the skip and the video plays.
- [ ] AE3 — Checking "never skip" records the exception; reopening does not show the popup.
- [ ] AE4 — Video abandoned below the threshold is not cataloged.
- [ ] AE6 — Without login, detection and skipping work.
- [ ] AE5 / AE7 / AE8 — Require two devices (or two profiles) and the backend; see `server/deploy/README.md`.
