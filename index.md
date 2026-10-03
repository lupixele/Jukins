# Jukins - LinkedIn Learning Video Auto-Completer

Extension to autonomously iterate through LinkedIn Learning course videos, watch them at accelerated playback rate (16x/configurable) to satisfy the un-scrubbed watch time requirement, skip quizzes/code challenges/assessments, and complete the full course.

## Architecture
- Manifest V3 Chrome Extension located under `extension/`
- Scoped to `https://*.linkedin.com/learning/*` and `file://*/*` (for local HTML testing)
- Content Script with Floating Control HUD & Auto-Advancer Engine
- Injected Page Script for deep playback control and Video.js events hook
- Background Service Worker (`background.js`) for multi-tab management and background execution
- Web Worker unthrottled timer loop in content script to prevent background tab CPU sleeping

## Directory Structure
- `extension/`
  - `manifest.json` - MV3 manifest
  - `background.js` - Service worker
  - `content.js` - DOM traversal, test skipping, video completion engine
  - `injected.js` - Main-world script neutralizing visibility/blur events & driving playback rate
  - `hud.css` - Styles for floating in-page HUD
  - `popup.html` / `popup.js` - Extension popup controls
- `Raw/` - Archived course HTMLs and assets for offline reverse-engineering


## Status
- **Phase**: Initial Implementation
- **Target**: Fast sequential completion of videos while cleanly bypassing assessments.
