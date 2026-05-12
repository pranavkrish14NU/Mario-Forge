'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createViewport, computeDisplayRect, DEFAULTS } = require('../src/viewport.js');

// ----------------------------------------------------------------------------
// stubs
// ----------------------------------------------------------------------------

function makeCanvas(intrinsicW, intrinsicH) {
  return {
    width: intrinsicW,
    height: intrinsicH,
    style: {},
  };
}

function makeTarget(viewportW, viewportH, opts) {
  const o = opts || {};
  const listeners = {};
  let pendingRaf = null;
  let rafQueue = [];
  let nextRafId = 1;
  return {
    innerWidth: viewportW,
    innerHeight: viewportH,
    addEventListener: function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: function (type, fn) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch: function (type, evt) {
      (listeners[type] || []).forEach(function (fn) { fn(evt); });
    },
    listenerCount: function (type) { return (listeners[type] || []).length; },
    requestAnimationFrame: o.noRaf ? undefined : function (cb) {
      const id = nextRafId++;
      rafQueue.push({ id: id, cb: cb });
      return id;
    },
    cancelAnimationFrame: o.noRaf ? undefined : function (id) {
      rafQueue = rafQueue.filter(function (e) { return e.id !== id; });
    },
    flushRaf: function () {
      const q = rafQueue;
      rafQueue = [];
      q.forEach(function (e) { e.cb(); });
    },
    pendingRafCount: function () { return rafQueue.length; },
    setViewport: function (w, h) { this.innerWidth = w; this.innerHeight = h; },
  };
}

// ----------------------------------------------------------------------------
// computeDisplayRect — pure scaling math
// ----------------------------------------------------------------------------

test('computeDisplayRect preserves aspect ratio (no stretching)', () => {
  // 512×208 game in 1024×768 viewport: scale = min(1024/512, 768/208)
  //   = min(2.0, 3.692) = 2.0 → 1024×416 (pillarbox on top/bottom? no — fits horizontally,
  //   actually it's letterbox: 768 viewport height vs 416 game = (768-416)/2 = 176 on top/bottom).
  const r = computeDisplayRect(512, 208, 1024, 768, true);
  assert.equal(r.width / r.height, 512 / 208, 'aspect ratio preserved');
  assert.equal(r.scale, 2);
  assert.equal(r.width, 1024);
  assert.equal(r.height, 416);
});

test('computeDisplayRect: integer scaling when preferInteger=true and scale > 1', () => {
  // 512×208 in 1500×800: float scale = min(1500/512, 800/208) = min(2.93, 3.85) = 2.93.
  // preferInteger → floor to 2.
  const r = computeDisplayRect(512, 208, 1500, 800, true);
  assert.equal(r.scale, 2);
  assert.equal(r.width, 1024);
  assert.equal(r.height, 416);
});

test('computeDisplayRect: fractional scaling when preferInteger=false', () => {
  const r = computeDisplayRect(512, 208, 1500, 800, false);
  assert.ok(r.scale > 2.9 && r.scale < 3.0, 'expected ~2.93, got ' + r.scale);
});

test('computeDisplayRect: fractional scale ALWAYS used when scale < 1 (small screen)', () => {
  // 320×480 phone vs 512×208 game: scale = min(320/512, 480/208) = min(0.625, 2.308) = 0.625.
  // preferInteger=true would round to 0 (invisible!) — must NOT happen.
  const r = computeDisplayRect(512, 208, 320, 480, true);
  assert.ok(r.scale > 0 && r.scale < 1);
  assert.equal(r.scale, 0.625);
  assert.equal(r.width, 320);
  assert.equal(r.height, 130);
});

test('computeDisplayRect: result centered (letterbox/pillarbox offsets)', () => {
  const r = computeDisplayRect(512, 208, 1024, 768, true);
  // Width matches viewport → no x-offset.
  assert.equal(r.offsetX, 0);
  // Height < viewport → centered vertically.
  assert.equal(r.offsetY, (768 - 416) / 2);
});

test('computeDisplayRect: zero-sized viewport returns zero rect', () => {
  const r = computeDisplayRect(512, 208, 0, 0, true);
  assert.deepEqual(r, { width: 0, height: 0, offsetX: 0, offsetY: 0, scale: 0 });
});

// ----------------------------------------------------------------------------
// createViewport — wiring + lifecycle
// ----------------------------------------------------------------------------

test('createViewport throws without a canvas', () => {
  const target = makeTarget(800, 600);
  assert.throws(function () { createViewport({ target: target }); }, TypeError);
  assert.throws(function () { createViewport({ canvas: {}, target: target }); }, TypeError);
});

test('createViewport throws without an event-target with addEventListener', () => {
  assert.throws(function () {
    createViewport({ canvas: makeCanvas(512, 208), target: {} });
  }, TypeError);
});

test('createViewport applies initial display size synchronously', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(1024, 768);
  createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  // Initial recompute is synchronous (no rAF batching on first call).
  assert.equal(canvas.style.width, '1024px');
  assert.equal(canvas.style.height, '416px');
});

test('createViewport attaches resize + orientationchange listeners', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(1024, 768);
  createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  assert.equal(target.listenerCount('resize'), 1);
  assert.equal(target.listenerCount('orientationchange'), 1);
});

test('detach removes both listeners', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(1024, 768);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  v.detach();
  assert.equal(target.listenerCount('resize'), 0);
  assert.equal(target.listenerCount('orientationchange'), 0);
});

// ----------------------------------------------------------------------------
// AC1: fixed internal resolution regardless of screen size
// ----------------------------------------------------------------------------

test('AC1: internal resolution does not change when viewport resizes', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(1024, 768);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  // Resize the viewport.
  target.setViewport(320, 480);
  v.recomputeSync();
  // The canvas's intrinsic dimensions (width/height attributes) MUST NOT be
  // touched — only style.width/style.height changes.
  assert.equal(canvas.width, 512);
  assert.equal(canvas.height, 208);
  assert.equal(v.getInternalSize().w, 512);
  assert.equal(v.getInternalSize().h, 208);
});

// ----------------------------------------------------------------------------
// AC2: aspect ratio preserved at all viewport sizes
// ----------------------------------------------------------------------------

test('AC2: aspect ratio preserved across multiple viewport sizes', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(800, 600);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  const ratios = [];
  [[400, 300], [1920, 1080], [2560, 1440], [375, 667], [768, 1024]].forEach(function (vp) {
    target.setViewport(vp[0], vp[1]);
    v.recomputeSync();
    const r = v.getDisplayRect();
    if (r.width > 0 && r.height > 0) {
      ratios.push(r.width / r.height);
    }
  });
  ratios.forEach(function (r) {
    assert.ok(Math.abs(r - 512 / 208) < 0.001, 'ratio drift: ' + r);
  });
});

// ----------------------------------------------------------------------------
// AC3: mobile portrait 320px — visible with letterbox
// ----------------------------------------------------------------------------

test('AC3: 320×568 portrait — game is visible and aspect-correct (letterbox top/bottom)', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(320, 568);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  const r = v.getDisplayRect();
  assert.ok(r.width > 0, 'visible: width > 0');
  assert.ok(r.height > 0, 'visible: height > 0');
  // Fills width, letterboxed vertically.
  assert.equal(r.width, 320);
  assert.equal(r.offsetX, 0);
  assert.ok(r.offsetY > 0, 'expected vertical letterbox, got offsetY=' + r.offsetY);
});

// ----------------------------------------------------------------------------
// AC4: 2560px desktop — crisp pixelated (integer scale)
// ----------------------------------------------------------------------------

test('AC4: 2560×1440 desktop scales with integer multiplier for pixel-perfect rendering', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(2560, 1440);
  const v = createViewport({
    canvas: canvas, internalWidth: 512, internalHeight: 208, target: target,
    preferInteger: true,
  });
  const r = v.getDisplayRect();
  // 2560 / 512 = 5, 1440 / 208 = 6.92 → min = 5 (integer).
  assert.equal(r.scale, 5);
  assert.equal(Number.isInteger(r.scale), true, 'scale must be integer for crisp pixels');
});

test('AC4: image-rendering: pixelated written to canvas style by default', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(2560, 1440);
  createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  assert.equal(canvas.style.imageRendering, 'pixelated');
});

test('AC4: setImageRendering=false leaves canvas.style.imageRendering untouched', () => {
  const canvas = makeCanvas(512, 208);
  canvas.style.imageRendering = 'auto'; // pre-existing value
  const target = makeTarget(2560, 1440);
  createViewport({
    canvas: canvas, internalWidth: 512, internalHeight: 208, target: target,
    setImageRendering: false,
  });
  assert.equal(canvas.style.imageRendering, 'auto');
});

// ----------------------------------------------------------------------------
// AC5: orientation change → re-scale within 1 frame
// ----------------------------------------------------------------------------

test('AC5: orientationchange queues a single rAF for re-scaling', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(375, 667); // portrait
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  // Rotate to landscape.
  target.setViewport(667, 375);
  target.dispatch('orientationchange', {});
  assert.equal(target.pendingRafCount(), 1, 'one rAF should be pending');
  target.flushRaf();
  // After the rAF runs, the canvas is re-sized.
  assert.notEqual(canvas.style.width, '375px'); // would have been portrait width
  const r = v.getDisplayRect();
  // 667 / 512 = 1.30, 375 / 208 = 1.80. min = 1.30. preferInteger → floor → 1.
  assert.equal(r.scale, 1);
  assert.equal(r.width, 512);
  assert.equal(r.height, 208);
});

test('AC5: multiple back-to-back resize events coalesce into ONE rAF', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(800, 600);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  target.setViewport(1024, 768);
  target.dispatch('resize', {});
  target.dispatch('resize', {});
  target.dispatch('resize', {});
  assert.equal(target.pendingRafCount(), 1, 'three resize events → one pending rAF');
  target.flushRaf();
  assert.equal(v.getDisplayRect().width, 1024);
});

test('AC5: when no rAF is available, recompute falls back to synchronous execution', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(800, 600, { noRaf: true });
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  target.setViewport(1024, 768);
  target.dispatch('resize', {});
  // No rAF → recompute runs sync immediately.
  assert.equal(v.getDisplayRect().width, 1024);
});

// ----------------------------------------------------------------------------
// AC6 / AC7 are implemented in index.html (viewport meta + CSS) — covered
// here by verifying the module does not undo the page's CSS.
// ----------------------------------------------------------------------------

test('AC7: module does not delete pre-existing imageRendering values', () => {
  const canvas = makeCanvas(512, 208);
  canvas.style.imageRendering = 'pixelated'; // already set by CSS
  const target = makeTarget(800, 600);
  createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  assert.equal(canvas.style.imageRendering, 'pixelated');
});

// ----------------------------------------------------------------------------
// API surface + edge cases
// ----------------------------------------------------------------------------

test('getDisplayRect returns a copy (defensive against mutation)', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(1024, 768);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  const r1 = v.getDisplayRect();
  r1.width = 9999;
  const r2 = v.getDisplayRect();
  assert.notEqual(r2.width, 9999, 'mutating returned rect must not affect internal state');
});

test('onChange callbacks fire on every recompute', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(800, 600);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  let calls = 0;
  v.onChange(function () { calls++; });
  target.setViewport(1024, 768);
  v.recomputeSync();
  assert.equal(calls, 1);
  target.setViewport(640, 480);
  v.recomputeSync();
  assert.equal(calls, 2);
});

test('onChange returns an unsubscribe function', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(800, 600);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  let calls = 0;
  const unsub = v.onChange(function () { calls++; });
  v.recomputeSync(); // 1
  unsub();
  v.recomputeSync(); // 2 — but unsubscribed
  assert.equal(calls, 1);
});

test('DEFAULTS exposes internalWidth / internalHeight / preferInteger', () => {
  assert.equal(typeof DEFAULTS.internalWidth, 'number');
  assert.equal(typeof DEFAULTS.internalHeight, 'number');
  assert.equal(typeof DEFAULTS.preferInteger, 'boolean');
});

test('getScale returns the current scale factor', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(1024, 768);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  assert.equal(v.getScale(), 2);
  target.setViewport(320, 480);
  v.recomputeSync();
  assert.equal(v.getScale(), 0.625);
});

test('detach cancels any pending rAF', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(800, 600);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  target.setViewport(1024, 768);
  target.dispatch('resize', {});
  assert.equal(target.pendingRafCount(), 1);
  v.detach();
  assert.equal(target.pendingRafCount(), 0);
});

test('initial paint sets style.width / style.height immediately', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(1920, 1080);
  createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  // Before any resize event — initial values must already be applied.
  assert.notEqual(canvas.style.width, '');
  assert.notEqual(canvas.style.height, '');
});

// ----------------------------------------------------------------------------
// scale: viewport sweep — 320 to 4K
// ----------------------------------------------------------------------------

test('scale sweep: all sizes 320–4K produce a positive scale and visible rect', () => {
  const canvas = makeCanvas(512, 208);
  const target = makeTarget(800, 600);
  const v = createViewport({ canvas: canvas, internalWidth: 512, internalHeight: 208, target: target });
  const sizes = [
    [320, 480], [375, 667], [414, 736], // phones
    [768, 1024], [834, 1112],            // tablets
    [1280, 720], [1920, 1080],           // common desktop
    [2560, 1440], [3840, 2160],          // 2K, 4K
  ];
  sizes.forEach(function (s) {
    target.setViewport(s[0], s[1]);
    v.recomputeSync();
    const r = v.getDisplayRect();
    assert.ok(r.scale > 0, s[0] + 'x' + s[1] + ' produced scale ' + r.scale);
    assert.ok(r.width > 0 && r.height > 0, s[0] + 'x' + s[1] + ' produced zero rect');
    assert.ok(r.width <= s[0], 'width exceeds viewport');
    assert.ok(r.height <= s[1], 'height exceeds viewport');
  });
});
