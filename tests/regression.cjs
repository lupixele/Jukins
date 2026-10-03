const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../extension/content.js'), 'utf8');
let now = 100000, clicks = 0, reloads = 0;
let plays = 0;

// Mock classroom video element
const video = {
  ended:false, paused:false, seeking:false, readyState:4,
  playbackRate:2, muted:true, error:null,
  play(){ plays++; return Promise.resolve(); }
};

// Mock classroom-toc <li> mirroring LinkedIn's DOM structure
function makeLi(urn, { selected=false, completed=false, title='item' } = {}) {
  const li = {
    _urn: urn,
    classList: { contains: c => (c === 'classroom-toc-item--selected' ? selected : false) },
    getAttribute: n => (n === 'data-toc-content-id' ? urn : null),
    hasAttribute: () => completed,
    querySelector(sel) {
      if (sel === 'a.classroom-toc-item__link') {
        return { hasAttribute: () => completed, getAttribute: n => (n === 'href' ? 'https://x/' + urn : null), href: 'https://x/' + urn, click(){ clicks++; } };
      }
      if (sel === '.classroom-toc-item__title') return { textContent: title };
      if (sel === '.a11y-text') return completed ? { textContent: '(Viewed)' } : null;
      return null;
    }
  };
  return li;
}

// getTOCItems DTO fixtures
const v1Li = makeLi('urn:li:learningApiVideo:1', { selected:true, completed:true });
const v2Li = makeLi('urn:li:learningApiVideo:2', { completed:false, title:'Next video' });
const dto1 = { urn:v1Li._urn, isSelected:true, isCompleted:true, element:v1Li, link:null };
const dto2 = { urn:v2Li._urn, isSelected:false, isCompleted:false, element:v2Li, link:v2Li.querySelector('a.classroom-toc-item__link') };

let selectFn = () => null;
let selectAllFn = () => [];
let tocFn = () => [dto1, dto2];

const document = {
  hidden:false,
  body:{ innerText:'' },
  querySelector: sel => selectFn(sel),
  querySelectorAll: sel => selectAllFn(sel)
};
const sandbox = { document, chrome:{runtime:{id:'test'}}, window:{postMessage(){},location:{reload(){reloads++;}}}, Date:{now:()=>now}, clearInterval(){}, console };

const cut = source.indexOf('  chrome.runtime.onMessage.addListener');
assert.ok(cut > 0, 'insertion seam must exist');
vm.runInNewContext(source.slice(0,cut) + `
 getTOCItems = () => toc();
 globalThis.setTOC = fn => { getTOCItems = fn; };
 updateStatus = text => { globalThis.status = text; };
 updateHUD = () => {};
 selectLowestQualityNumeric = () => {};
 globalThis.test = { state, runCycle, advanceToNextVideo, sanitizeSpeed, navLock, skipSelectedAssessment };
})();`, Object.assign(sandbox,{toc:()=>tocFn()}));

const t = sandbox.test;

assert.equal(t.sanitizeSpeed(16),2,'legacy 16x migrates to 2x');
assert.equal(t.sanitizeSpeed(0.1),0.5,'floor 0.5x');
assert.equal(t.sanitizeSpeed('bad'),2,'garbage/invalid speed falls back to native max 2x');

// --- Phase 1: normal video page, in-progress; never navigates early ---
selectFn = sel => (sel === 'video.vjs-tech' ? video : null);
t.state.enabled = true;
t.runCycle();
assert.equal(clicks,0,'in-progress video must not navigate');

video.readyState = 1; video.paused = false;
t.runCycle();
assert.equal(plays,0,'playing-but-buffering is untouched');
video.paused = true; now += 6000; t.runCycle();
assert.equal(plays,1,'paused+buffering triggers one resume');
now += 4000; video.paused = true; t.runCycle();
assert.equal(plays,1,'resume attempts refuse a 4s gap');
now += 2000; video.paused = true; t.runCycle();
assert.equal(plays,2,'resume attempts allowed after >=5s');

video.readyState = 4;
video.ended = true;
t.runCycle();
assert.equal(clicks,0,'ended without completion mark must not navigate');
now += 6000; t.runCycle();
assert.equal(clicks,1,'stable completion advances once');
t.runCycle();
assert.equal(clicks,1,'navLock blocks duplicates');

t.navLock.inFlight = false;
document.body.innerText = 'HTTP ERROR 429';
t.runCycle();
assert.equal(t.state.enabled,false);
assert.equal(reloads,0,'429 never auto-reloads');
document.body.innerText = '';

t.state.enabled = true;
sandbox.chrome.runtime.id = undefined;
t.runCycle();
assert.equal(t.state.enabled,false,'invalid context stops runner');
sandbox.chrome.runtime.id = 'test';

// --- Phase 4: Code-Challenge page, mirrors Raw/Code Challenge save ---
const challengeLi = makeLi('urn:li:la_assessmentV2:71731827', { selected:true, title:'</> Code Challenge: X' });
selectAllFn = sel => (sel.startsWith('li[data-toc-content-id]') ? [challengeLi, v2Li] : []);
selectFn = sel =>
  sel === 'video.vjs-tech' ? null :
  sel === 'li.classroom-toc-item--selected' ? challengeLi : null;
sandbox.setTOC(() => [dto2]);

t.state.enabled = true;
const before = clicks;
t.runCycle();
assert.equal(clicks, before + 1, 'challenge page skips to next video');
assert.equal(t.navLock.targetUrn, dto2.urn);
t.runCycle();
assert.equal(clicks, before + 1, 'no double skip while navigating');

const injected = fs.readFileSync(require('node:path').join(__dirname, '../extension/injected.js'), 'utf8');
for (const banned of ['Document.prototype', 'Window.prototype', 'IntersectionObserver', 'HTMLMediaElement.prototype']) {
  assert.ok(!injected.includes(banned), 'no global spoofing of ' + banned);
}
console.log('PASS: sanitize, buffering, end gating, nav lock, 429 stop, invalidation, challenge skip, no global spoofing');
