// Opt-in background playback support for the current classroom player only.
(() => {
  'use strict';
  let enabled = false;
  const restorations = new Map();
  function restore() {
    for (const [plugin, original] of restorations) {
      for (const [key, value] of Object.entries(original)) plugin[key] = value;
    }
    restorations.clear();
  }
  // LinkedIn exports Video.js through its AMD media-player module; the module
  // object is stable for the page, so resolve it once and reuse it.
  let cachedVjs;
  function getVjs() {
    if (cachedVjs) return cachedVjs;
    try {
      cachedVjs = window.videojs || (typeof window.require === 'function'
        ? window.require('media-player')?.videojs : null) || null;
    } catch (e) {
      cachedVjs = null;
    }
    return cachedVjs;
  }
  function allowBackground() {
    if (!enabled) return;
    try {
      const el = document.querySelector('video.vjs-tech')?.closest('.video-js');
      if (!el) return;
      const player = getVjs()?.getPlayer?.(el.id);
      if (!player || player.isDisposed?.()) return;
      for (const [name, method, replacement] of [
        ['playbackAudit', '_shouldPause', () => false],
        ['visibilityMonitor', 'checkPlayback', () => {}]
      ]) {
        if (!player.hasPlugin?.(name) || typeof player[name] !== 'function') continue;
        const plugin = player[name]();
        if (!plugin || typeof plugin[method] !== 'function' || restorations.has(plugin)) continue;
        restorations.set(plugin, { [method]: plugin[method] });
        plugin[method] = replacement;
      }
      // Do not alter playerVisibility, tracking, played ranges, or progress.
    } catch (e) {
      // Module/player may not exist yet; retry at the next configuration tick.
    }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'JUKINS_CONFIG') return;
    enabled = event.data.enabled === true;
    if (!enabled) restore();
    else allowBackground();
  });

  // Extra safety: re-apply every 3 seconds in case Video.js re-instantiates.
  // Patching is idempotent, so a covered player costs one cheap lookup.
  setInterval(() => {
    if (enabled) allowBackground();
  }, 3000);
})();

