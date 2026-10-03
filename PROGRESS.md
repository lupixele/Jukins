# Jukins Progress

## Current State
- [x] Analyzed raw LinkedIn Learning DOM and scripts (`Raw/python`, `Raw/Soft Skills`).
- [x] Confirmed DOM selector schema (`li[data-toc-content-id]`, `classroom-toc-section`, `classroom-toc-item`).
- [x] Reverse-engineered LinkedIn watch-time verification mechanism (`NON_SCRUB_VIDEO_TIME_WATCHED` and `LearningContentClientProgressStateChangeEvent`).
- [x] Built Manifest V3 autonomous video-only completer extension.

## Recent Decisions
- **The Core Unfocused Detection Vector Solved: `IntersectionObserver` & `playerVisibility` (v2.2)**:
  - Traced LinkedIn's Video.js engine (`aod13jvloas6tpq8h9en5tezb`) to discover the exact mechanism detecting unfocused/minimized tabs:
    - LinkedIn does NOT just use `visibilitychange`. It registers an **`IntersectionObserver`** on the video element!
    - When a tab is backgrounded or minimized, Chromium reports `isIntersecting: false` and `intersectionRatio: 0`.
    - This calls `playerVisibility._setIsVisible()`, which evaluates `this._isVisible = this._isDocumentVisible && this._isInViewport`.
    - Because `_isInViewport` became `false`, it triggered `visibilityChange({ isVisible: false })`, which in turn invoked `playbackAudit._shouldPause()`, causing LinkedIn to issue `player.reset()` and erase accumulated progress!
  - We intercepted `window.IntersectionObserver` so it always reports `isIntersecting: true` and `intersectionRatio: 1.0`.
  - Overrode `playerVisibility`, `visibilityMonitor`, and `playbackAudit` plugin registrations on `videojs` so `isVisible()` permanently returns `true`.

- **Code-Challenge Trap Fixed (v2.3)**: On assessment pages the selected TOC entry is `urn:li:la_assessmentV2:*` and there is no `<video>` element, so the runner previously stalled forever on "Waiting for a selected course video." Added `skipSelectedAssessment()`: detects a selected test/challenge entry and clicks the next unfinished non-test item in outline order, with navLock protection and course-done fallback. Regression test covers the exact Raw/Code Challenge page shape (selected assessment, zero video elements, next video link). NOTE: the v2.2 decision above documented spoofing approaches that were later found harmful and REMOVED in v2.3; injected.js now only patches the current player instance`s playbackAudit/visibilityMonitor while the runner is on.

- **v2.4 — Resource-usage pass (no behaviour change)**: Cut the runner`s own per-tick cost while keeping real playback intact. (1) `getTOCItems()` now caches the derived outline for 2s and only rescans when `location.href`, the selected entry URN, or DOM attachment change — previously a full `querySelectorAll` + per-item heuristic scan ran every second. (2) The 429 probe read `document.body.innerText`, which forces a synchronous layout every tick; it is now sampled at most every 3s (`checkRateLimited`), so a 429 still stops the runner within ~3s. (3) `broadcastConfig()` and `updateHUD()` are memoised — no `postMessage` and zero DOM writes when nothing changed. (4) `injected.js` re-patch loop dropped 2000ms -> 3000ms and caches the AMD `media-player` module. (5) Manifest version -> 2.4.0. Regression suite extended with an outline-cache phase (hit, invalidation, re-cache); all phases pass. NOTE: decode cost cannot be removed - LinkedIn credits only genuinely-played, non-scrubbed time, so "complete without playing" would require forging tracking beacons and was NOT implemented.
