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
  function allowBackground() {
    if (!enabled) return;
    try {
      const el = document.querySelector('video.vjs-tech')?.closest('.video-js');
      if (!el) return;
      // LinkedIn exports Video.js through its AMD media-player module.
      const vjs = window.videojs || (typeof window.require === 'function'
        ? window.require('media-player').videojs : null);
      const player = vjs?.getPlayer?.(el.id);
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

  // Extra safety: re-apply every 2 seconds in case Video.js re-instantiates
  setInterval(() => {
    if (enabled) allowBackground();
  }, 2000);
})();

