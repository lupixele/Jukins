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
