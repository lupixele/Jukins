// Jukins Content Script - Hardened Autonomous LinkedIn Learning Controller
(function () {
  'use strict';

  // Per-tab runtime state (safe per-tab state: does not cross-contaminate other tabs)
  const state = {
    enabled: false,
    speed: 2.0,
    muted: true,
    totalVideos: 0,
    completedVideos: 0,
    skippedTests: 0,
    statusText: 'Idle. Ready to start.',
    isBuffering: false,
    isHiddenPaused: false
  };

  // UI HUD Elements
  let hudRoot = null;
  let isInitialized = false;
  let isInitializing = false;
  let timerHandle = null;
  let lastQualitySourceKey = null;
  let qualityAttemptCount = 0;
  let lastQualityAttemptTime = 0;
  const MAX_QUALITY_ATTEMPTS = 3;

  // Navigation lock with explicit target identity and monotonic token
  let navTokenCounter = 0;
  const navLock = {
    inFlight: false,
    token: 0,
    targetUrn: null,
    targetHref: null,
    targetTitle: '',
    timerId: null,
    initiatedAt: 0
  };

  function sanitizeSpeed(speed) {
    const num = Number(speed);
    if (!Number.isFinite(num) || num <= 0) return 2.0;
    return Math.min(Math.max(num, 0.5), 2.0);
  }

  function isContextValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function broadcastConfig() {
    try {
      window.postMessage({
        type: 'JUKINS_CONFIG',
        enabled: state.enabled,
        rate: state.enabled ? state.speed : 1.0,
        muted: state.muted
      }, '*');
    } catch (e) {}
  }

  // Idempotent lowest quality selection (numeric resolution, no retry storms)
  function selectLowestQualityNumeric(videoEl) {
    if (!videoEl || !state.enabled) return;
    const currentSrc = videoEl.currentSrc || videoEl.src || 'active-video';
    if (lastQualitySourceKey === currentSrc) {
      return;
    }
    if (qualityAttemptCount >= MAX_QUALITY_ATTEMPTS && lastQualitySourceKey === currentSrc) {
      return;
    }

    const now = Date.now();
    if (now - lastQualityAttemptTime < 4000) {
      return;
    }
    lastQualityAttemptTime = now;
    qualityAttemptCount++;

    try {
      window.postMessage({
        type: 'JUKINS_SET_QUALITY',
        sourceKey: currentSrc
      }, '*');
    } catch (e) {}

    try {
      const menuItems = Array.from(document.querySelectorAll('.vjs-quality-menu .vjs-menu-item, .vjs-menu-item, .vjs-quality-setting-level'));
      if (menuItems.length > 0) {
        let lowestItem = null;
        let lowestRes = Infinity;
        let isAlreadySelected = false;

        menuItems.forEach(item => {
          const text = (item.textContent || '').trim();
          const match = text.match(/(\d{3,4})p?/i);
          if (match) {
            const res = parseInt(match[1], 10);
            if (res > 0 && res < lowestRes) {
              lowestRes = res;
              lowestItem = item;
              isAlreadySelected = item.classList.contains('vjs-selected') || item.getAttribute('aria-checked') === 'true';
            }
          }
        });

        if (lowestItem) {
          if (!isAlreadySelected) {
            lowestItem.click();
          }
          lastQualitySourceKey = currentSrc;
          return;
        }
      }
    } catch (e) {}

    if (qualityAttemptCount >= MAX_QUALITY_ATTEMPTS) {
      lastQualitySourceKey = currentSrc;
    }
  }

  function isRateLimited() {
    try {
      const title = (document.title || '').toLowerCase();
      const bodyText = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
      return title.includes('429') || bodyText.includes('http error 429') || bodyText.includes('too many requests');
    } catch (e) {
      return false;
    }
  }

  function createHUD() {
    if (document.getElementById('jukins-hud-root')) return;

    hudRoot = document.createElement('div');
    hudRoot.id = 'jukins-hud-root';
    hudRoot.innerHTML = `
      <div class="jukins-hud-panel">
        <div class="jukins-hud-header">
          <div class="jukins-hud-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Jukins Auto-Completer
          </div>
          <span id="jukins-badge" class="jukins-badge ${state.enabled ? 'jukins-badge-running' : 'jukins-badge-paused'}">
            ${state.enabled ? 'Active' : 'Stopped'}
          </span>
        </div>

        <div class="jukins-hud-stats">
          <div class="jukins-stat-item">
            <span class="jukins-stat-label">Videos Done</span>
            <span id="jukins-stat-videos" class="jukins-stat-val">0 / 0</span>
          </div>
          <div class="jukins-stat-item">
            <span class="jukins-stat-label">Tests Skipped</span>
            <span id="jukins-stat-tests" class="jukins-stat-val">0</span>
          </div>
        </div>

        <div class="jukins-hud-speed">
          <span>Speed:</span>
          <div class="jukins-speed-buttons">
            <button class="jukins-speed-btn ${state.speed === 1 ? 'active' : ''}" data-speed="1">1x</button>
            <button class="jukins-speed-btn ${state.speed === 1.5 ? 'active' : ''}" data-speed="1.5">1.5x</button>
            <button class="jukins-speed-btn ${state.speed === 2 ? 'active' : ''}" data-speed="2">2.0x (Max)</button>
          </div>
        </div>

        <div class="jukins-hud-controls">
          <button id="jukins-toggle-btn" class="jukins-btn ${state.enabled ? 'jukins-btn-danger' : 'jukins-btn-primary'}">
            ${state.enabled ? 'Pause Runner' : 'Start Auto-Complete'}
          </button>
          <button id="jukins-skip-btn" class="jukins-btn jukins-btn-secondary" title="Skip to next video">
            Next ⏭
          </button>
        </div>

        <div id="jukins-hud-log" class="jukins-hud-log">${state.statusText}</div>
      </div>
    `;

    document.body.appendChild(hudRoot);

    // Bind HUD events
    document.getElementById('jukins-toggle-btn').addEventListener('click', toggleRunner);
    document.getElementById('jukins-skip-btn').addEventListener('click', () => {
      updateStatus('Manual skip triggered...');
      advanceToNextVideo();
    });

    hudRoot.querySelectorAll('.jukins-speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rawSpeed = parseFloat(e.target.dataset.speed);
        setSpeed(rawSpeed);
      });
    });
  }

  function updateHUD() {
    if (!hudRoot) return;
    const badge = document.getElementById('jukins-badge');
    const toggleBtn = document.getElementById('jukins-toggle-btn');
    const statVideos = document.getElementById('jukins-stat-videos');
    const statTests = document.getElementById('jukins-stat-tests');
    const logEl = document.getElementById('jukins-hud-log');

    if (badge) {
      badge.textContent = state.enabled ? 'Active' : 'Stopped';
      badge.className = `jukins-badge ${state.enabled ? 'jukins-badge-running' : 'jukins-badge-paused'}`;
    }
    if (toggleBtn) {
      toggleBtn.textContent = state.enabled ? 'Pause Runner' : 'Start Auto-Complete';
      toggleBtn.className = `jukins-btn ${state.enabled ? 'jukins-btn-danger' : 'jukins-btn-primary'}`;
    }
    if (statVideos) {
      statVideos.textContent = `${state.completedVideos} / ${state.totalVideos} (Viewed)`;
    }
    if (statTests) {
      statTests.textContent = `${state.skippedTests}`;
    }
    if (logEl) {
      logEl.textContent = state.statusText;
    }
  }

  function updateStatus(text) {
    state.statusText = text;
    updateHUD();
  }

  function setSpeed(rawSpeed) {
    const cleanSpeed = sanitizeSpeed(rawSpeed);
    state.speed = cleanSpeed;
    if (isContextValid()) {
      try {
        chrome.storage.local.set({ jukins_speed: cleanSpeed });
      } catch (e) {}
    }
    broadcastConfig();
    updateHUD();
  }

  function stopRunner(reason) {
    state.enabled = false;
    if (navLock.timerId) {
      clearTimeout(navLock.timerId);
      navLock.timerId = null;
    }
    navLock.inFlight = false;
    updateStatus(reason || 'Runner paused.');
    broadcastConfig();
  }

  function toggleRunner() {
    if (state.enabled) {
      stopRunner('Runner paused by user.');
    } else {
      state.enabled = true;
      updateStatus('Runner started.');
      broadcastConfig();
      runCycle();
    }
  }

  // Playlist & Item Inspection
  function isAssessmentOrTest(li) {
    const urn = li.getAttribute('data-toc-content-id') || '';
    const link = li.querySelector('a.classroom-toc-item__link');
    const href = link ? link.getAttribute('href') || '' : '';
    const titleEl = li.querySelector('.classroom-toc-item__title');
    const title = titleEl ? titleEl.textContent.trim().toLowerCase() : '';

    const urnCheck = urn.includes('assessment') || urn.includes('Quiz') || urn.includes('quiz') || urn.includes('exam');
    const hrefCheck = href.includes('/quiz/') || href.includes('/assessment/') || href.includes('challenge');
    const titleCheck = title.includes('code challenge') || title.includes('quiz') || title.includes('exam') || title.includes('assessment');

    return urnCheck || hrefCheck || titleCheck;
  }

  function isItemCompleted(li) {
    // 1. Check data attribute directly
    if (li.hasAttribute('data-live-test-classroom-toc-item-completed')) {
      return true;
    }
    const link = li.querySelector('a.classroom-toc-item__link');
    if (link && link.hasAttribute('data-live-test-classroom-toc-item-completed')) {
      return true;
    }

    // 2. Check if the checkmark icon exists and is not hidden
    const completedIcon = li.querySelector('.classroom-toc-item__completed-icon');
    if (completedIcon && !completedIcon.classList.contains('classroom-toc-item__completed-icon--hidden')) {
      return true;
    }
    // 3. Check svg test icon or aria attributes
    const checkSvg = li.querySelector('svg[data-test-icon="check-small"], svg[data-test-icon="check"]');
    if (checkSvg && !checkSvg.classList.contains('classroom-toc-item__completed-icon--hidden')) return true;

    // 4. Check status container
    const statusDiv = li.querySelector('.classroom-toc-item__viewing-status');
    if (statusDiv && statusDiv.classList.contains('classroom-toc-item__viewing-status--completed')) {
      return true;
    }

    // 5. Check a11y text (Viewed)
    const a11yText = li.querySelector('.a11y-text');
    if (a11yText && a11yText.textContent.toLowerCase().includes('viewed')) {
      return true;
    }

    return false;
  }

  function expandAllCollapsedSections() {
    const collapseToggles = document.querySelectorAll('button.classroom-toc-section__toggle[aria-expanded="false"]');
    collapseToggles.forEach(btn => {
      try {
        btn.click();
      } catch (e) {}
    });
  }

  function getTOCItems() {
    expandAllCollapsedSections();
    const items = Array.from(document.querySelectorAll('li[data-toc-content-id]'));
    const videos = [];
    let testsCount = 0;

    items.forEach(item => {
      if (isAssessmentOrTest(item)) {
        testsCount++;
      } else if ((item.getAttribute('data-toc-content-id') || '').startsWith('urn:li:learningApiVideo:')) {
        videos.push({
          element: item,
          urn: item.getAttribute('data-toc-content-id'),
          link: item.querySelector('a.classroom-toc-item__link'),
          isCompleted: isItemCompleted(item),
          isSelected: item.classList.contains('classroom-toc-item--selected')
        });
      }
    });

    state.skippedTests = testsCount;
    state.totalVideos = videos.length;
    state.completedVideos = videos.filter(v => v.isCompleted).length;

    return videos;
  }

  let lastPlayAttempt = 0;
  let completionSeenAt = 0;
  let activeUrn = null;

  function runCycle() {
    if (!isContextValid()) {
      stopRunner('Extension reloaded: refresh this tab.');
      clearInterval(timerHandle);
      return;
    }
    if (!state.enabled) return;
    broadcastConfig();
    if (/HTTP ERROR 429/i.test(document.body?.innerText || '')) {
      stopRunner('Rate limited (429). Stopped; no automatic refresh.');
      return;
    }
    const videos = getTOCItems();
    const current = videos.find(v => v.isSelected);
    const video = document.querySelector('video.vjs-tech');
    if (navLock.inFlight) {
      if (current?.urn === navLock.targetUrn) navLock.inFlight = false;
      else {
        if (Date.now() - navLock.initiatedAt > 30000) stopRunner('Navigation timed out; stopped without retrying.');
        return;
      }
    }
    if (!current || !video) {
      updateStatus('Waiting for a selected course video.');
      return;
    }
    if (activeUrn !== current.urn) {
      activeUrn = current.urn;
      completionSeenAt = 0;
      lastPlayAttempt = 0;
      // New video loaded: re-apply background override + force playback
      broadcastConfig();
      try {
        if (!video.muted && state.muted) video.muted = true;
        if (video.paused && !video.ended) {
          video.play().catch(() => {});
        }
        if (video.playbackRate !== state.speed) {
          video.playbackRate = sanitizeSpeed(state.speed);
        }
      } catch (e) {}
      // Give the player 2 seconds to stabilize before normal cycle resumes
      updateStatus('New video detected. Loading...');
      return;
    }
    if (video.ended) {
      if (!current.isCompleted) {
        completionSeenAt = 0;
        updateStatus('Video ended; waiting for native completion.');
      } else {
        if (!completionSeenAt) completionSeenAt = Date.now();
        updateStatus('Native completion observed; server persistence unverified.');
        if (Date.now() - completionSeenAt >= 5000) advanceToNextVideo();
      }
      return;
    }
    if (video.error) {
      stopRunner('Player error: ' + video.error.code);
      return;
    }
    // A paused player can need play() before it fetches enough data to reach
    // HAVE_FUTURE_DATA. Do not make readyState >= 3 a prerequisite for play.
    if (video.seeking || (!video.paused && video.readyState < 3)) {
      updateStatus('Buffering; waiting without seeking or reloading.');
      return;
    }
    if (video.playbackRate !== state.speed) video.playbackRate = sanitizeSpeed(state.speed);
    if (state.muted) video.muted = true;
    selectLowestQualityNumeric(video);
    if (video.paused && Date.now() - lastPlayAttempt >= 5000) {
      lastPlayAttempt = Date.now();
      video.play().catch(e => updateStatus('Playback blocked: ' + e.message));
    }
    updateStatus('Actual speed: ' + video.playbackRate + 'x; played normally. Completion persistence unverified.');
  }

  function advanceToNextVideo() {
    if (!state.enabled || navLock.inFlight || !isContextValid()) return;
    const videos = getTOCItems();
    const current = videos.find(v => v.isSelected);
    const video = document.querySelector('video.vjs-tech');
    if (!current || !current.isCompleted || !video?.ended) return;
    const next = videos.find(v => !v.isCompleted && v.urn !== current.urn);
    if (!next?.link) {
      stopRunner('No pending videos in loaded outline. Verify completion after reload.');
      return;
    }
    navLock.inFlight = true;
    navLock.targetUrn = next.urn;
    navLock.initiatedAt = Date.now();
    next.link.click();
  }

  function init() {
    if (isInitialized || isInitializing) return;
    isInitializing = true;
    const ready = res => {
      if (isInitialized) return;
      state.speed = sanitizeSpeed(res?.jukins_speed);
      isInitialized = true;
      createHUD();
      broadcastConfig();
      timerHandle = setInterval(runCycle, 1000);
      updateHUD();
    };
    try { chrome.storage.local.get(['jukins_speed'], ready); }
    catch (e) { ready({}); }
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'JUKINS_STATE') respond({ enabled: state.enabled, speed: state.speed });
    if (msg.type === 'JUKINS_TOGGLE') { toggleRunner(); respond({ enabled: state.enabled, speed: state.speed }); }
    if (msg.type === 'JUKINS_SPEED') { setSpeed(msg.speed); respond({ enabled: state.enabled, speed: state.speed }); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
