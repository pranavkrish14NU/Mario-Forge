'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTouch,
  detectTouch,
  DEFAULT_BUTTONS,
  MIN_TOUCH_TARGET_PX,
} = require('../src/touch.js');
const { createInput } = require('../src/input.js');

// ----------------------------------------------------------------------------
// stubs
// ----------------------------------------------------------------------------

function makeEventTarget() {
  const listeners = {};
  return {
    addEventListener: function (type, fn, opts) {
      (listeners[type] = listeners[type] || []).push({ fn: fn, opts: opts });
    },
    removeEventListener: function (type, fn) {
      const arr = listeners[type] || [];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].fn === fn) { arr.splice(i, 1); return; }
      }
    },
    dispatch: function (type, evt) {
      (listeners[type] || []).forEach(function (entry) { entry.fn(evt); });
    },
    listenerCount: function (type) {
      return (listeners[type] || []).length;
    },
    getListenerOpts: function (type) {
      return (listeners[type] || []).map(function (e) { return e.opts; });
    },
  };
}

function makeTouch(id, x, y) {
  return { identifier: id, clientX: x, clientY: y };
}

function makeTouchEvent(touches) {
  return {
    changedTouches: touches,
    _pd: 0,
    preventDefault: function () { this._pd++; },
  };
}

function makeAudio() { /* unused */ return null; }

// Minimal Input stub that records virtual presses/releases.
function makeFakeInput() {
  const events = [];
  return {
    events: events,
    virtualPress: function (a) { events.push({ op: 'press', a: a }); },
    virtualRelease: function (a) { events.push({ op: 'release', a: a }); },
  };
}

function makeTouchOverlay(opts) {
  const target = makeEventTarget();
  const input = (opts && opts.input) || makeFakeInput();
  const touch = createTouch(Object.assign({
    target: target,
    input: input,
    isTouchCapable: true,
    viewport: { w: 800, h: 600 },
  }, opts || {}));
  return { touch: touch, target: target, input: input };
}

// ----------------------------------------------------------------------------
// API surface + detection
// ----------------------------------------------------------------------------

test('createTouch exposes the public API', () => {
  const { touch } = makeTouchOverlay();
  ['isActive', 'isTouchCapable', 'isVisible', 'setVisible', 'setViewport',
   'getButtonRects', 'getButtonForAction', 'hitTest', 'draw', 'detach']
    .forEach(function (m) {
      assert.equal(typeof touch[m], 'function', 'missing method ' + m);
    });
});

test('createTouch throws if input does not expose virtualPress/Release', () => {
  const t = makeEventTarget();
  assert.throws(function () { createTouch({ target: t, input: {} }); }, TypeError);
  assert.throws(function () { createTouch({ target: t, input: null }); }, TypeError);
});

test('createTouch throws if target does not support addEventListener', () => {
  assert.throws(function () { createTouch({ input: makeFakeInput(), target: {} }); }, TypeError);
});

test('detectTouch: returns true when ontouchstart is on the root', () => {
  const fakeRoot = { ontouchstart: null };
  assert.equal(detectTouch(fakeRoot), true);
});

test('detectTouch: returns true when navigator.maxTouchPoints > 0', () => {
  const fakeRoot = { navigator: { maxTouchPoints: 5 } };
  assert.equal(detectTouch(fakeRoot), true);
});

test('detectTouch: returns false on a desktop-like root', () => {
  const fakeRoot = { navigator: { maxTouchPoints: 0 } };
  assert.equal(detectTouch(fakeRoot), false);
});

test('detectTouch: returns false for null root', () => {
  assert.equal(detectTouch(null), false);
});

// ----------------------------------------------------------------------------
// AC1: appears automatically on touch-capable devices
// ----------------------------------------------------------------------------

test('AC1: isActive() is true when touch-capable', () => {
  const { touch } = makeTouchOverlay({ isTouchCapable: true });
  assert.equal(touch.isActive(), true);
});

test('AC1: attaches touch listeners only when touch-capable', () => {
  const { target } = makeTouchOverlay({ isTouchCapable: true });
  assert.equal(target.listenerCount('touchstart'), 1);
  assert.equal(target.listenerCount('touchmove'), 1);
  assert.equal(target.listenerCount('touchend'), 1);
  assert.equal(target.listenerCount('touchcancel'), 1);
});

// ----------------------------------------------------------------------------
// AC2-AC4: D-pad and action buttons map to the correct actions
// ----------------------------------------------------------------------------

function pressTouchAt(target, id, btnRect) {
  // Press at the centre of the button rect.
  const x = btnRect.x + btnRect.w / 2;
  const y = btnRect.y + btnRect.h / 2;
  target.dispatch('touchstart', makeTouchEvent([makeTouch(id, x, y)]));
  return { id: id, x: x, y: y };
}

test('AC2: left D-pad button triggers moveLeft', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  pressTouchAt(target, 1, r.left);
  assert.deepEqual(input.events, [{ op: 'press', a: 'moveLeft' }]);
});

test('AC2: right D-pad button triggers moveRight', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  pressTouchAt(target, 1, r.right);
  assert.deepEqual(input.events, [{ op: 'press', a: 'moveRight' }]);
});

test('AC3: jump button triggers jump', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  pressTouchAt(target, 1, r.jump);
  assert.deepEqual(input.events, [{ op: 'press', a: 'jump' }]);
});

test('AC4: run button triggers run', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  pressTouchAt(target, 1, r.run);
  assert.deepEqual(input.events, [{ op: 'press', a: 'run' }]);
});

test('AC2-4: touchend on a button fires virtualRelease for its action', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  const t1 = pressTouchAt(target, 1, r.left);
  target.dispatch('touchend', makeTouchEvent([makeTouch(t1.id, t1.x, t1.y)]));
  assert.deepEqual(input.events, [
    { op: 'press', a: 'moveLeft' },
    { op: 'release', a: 'moveLeft' },
  ]);
});

test('AC2-4: touchcancel acts like touchend (release the action)', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  const t1 = pressTouchAt(target, 1, r.jump);
  target.dispatch('touchcancel', makeTouchEvent([makeTouch(t1.id, t1.x, t1.y)]));
  assert.deepEqual(input.events, [
    { op: 'press', a: 'jump' },
    { op: 'release', a: 'jump' },
  ]);
});

// ----------------------------------------------------------------------------
// AC5: multi-touch
// ----------------------------------------------------------------------------

test('AC5: two simultaneous touches on different buttons fire two presses', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  target.dispatch('touchstart', makeTouchEvent([
    makeTouch(1, r.right.x + r.right.w / 2, r.right.y + r.right.h / 2),
    makeTouch(2, r.jump.x + r.jump.w / 2,  r.jump.y + r.jump.h / 2),
  ]));
  const actions = input.events.filter(function (e) { return e.op === 'press'; }).map(function (e) { return e.a; });
  assert.deepEqual(actions.sort(), ['jump', 'moveRight'].sort());
});

test('AC5: two fingers on the same button release only after BOTH lift', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  const x = r.right.x + r.right.w / 2;
  const y = r.right.y + r.right.h / 2;
  target.dispatch('touchstart', makeTouchEvent([makeTouch(1, x, y)]));
  target.dispatch('touchstart', makeTouchEvent([makeTouch(2, x, y)]));
  // First finger lifts — should NOT release moveRight (finger 2 still holding).
  target.dispatch('touchend', makeTouchEvent([makeTouch(1, x, y)]));
  let releases = input.events.filter(function (e) { return e.op === 'release'; });
  assert.equal(releases.length, 0);
  // Second finger lifts — NOW release.
  target.dispatch('touchend', makeTouchEvent([makeTouch(2, x, y)]));
  releases = input.events.filter(function (e) { return e.op === 'release'; });
  assert.deepEqual(releases, [{ op: 'release', a: 'moveRight' }]);
});

test('AC5: finger slides from one button to another — release old, press new', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  const fromX = r.left.x + r.left.w / 2;
  const fromY = r.left.y + r.left.h / 2;
  const toX = r.right.x + r.right.w / 2;
  const toY = r.right.y + r.right.h / 2;
  target.dispatch('touchstart', makeTouchEvent([makeTouch(1, fromX, fromY)]));
  target.dispatch('touchmove',  makeTouchEvent([makeTouch(1, toX, toY)]));
  const ops = input.events.map(function (e) { return e.op + ':' + e.a; });
  assert.deepEqual(ops, ['press:moveLeft', 'release:moveLeft', 'press:moveRight']);
});

test('AC5: finger slides OFF all buttons — current action releases', () => {
  const { touch, target, input } = makeTouchOverlay();
  const r = touch.getButtonRects();
  const onX = r.jump.x + r.jump.w / 2;
  const onY = r.jump.y + r.jump.h / 2;
  target.dispatch('touchstart', makeTouchEvent([makeTouch(1, onX, onY)]));
  // Slide far off-screen.
  target.dispatch('touchmove', makeTouchEvent([makeTouch(1, -100, -100)]));
  const last = input.events[input.events.length - 1];
  assert.deepEqual(last, { op: 'release', a: 'jump' });
});

// ----------------------------------------------------------------------------
// AC6: responsive sizing with WCAG 44px minimum
// ----------------------------------------------------------------------------

test('AC6: at 320px wide all buttons are at least 44x44 (WCAG minimum)', () => {
  const { touch } = makeTouchOverlay({ viewport: { w: 320, h: 480 } });
  const rects = touch.getButtonRects();
  ['left', 'right', 'jump', 'run'].forEach(function (name) {
    assert.ok(rects[name].w >= MIN_TOUCH_TARGET_PX,
      name + '.w=' + rects[name].w + ' < ' + MIN_TOUCH_TARGET_PX);
    assert.ok(rects[name].h >= MIN_TOUCH_TARGET_PX,
      name + '.h=' + rects[name].h + ' < ' + MIN_TOUCH_TARGET_PX);
  });
});

test('AC6: at 1024px wide buttons scale to the configured fraction (>44px)', () => {
  const { touch } = makeTouchOverlay({ viewport: { w: 1024, h: 768 } });
  const rects = touch.getButtonRects();
  // 1024 * 0.10 = 102.4 px — comfortably above the WCAG floor.
  assert.ok(rects.left.w > MIN_TOUCH_TARGET_PX);
  assert.ok(rects.left.w >= 100, 'expected ~102, got ' + rects.left.w);
});

test('AC6: buttons live in the lower portion of the screen', () => {
  const { touch } = makeTouchOverlay({ viewport: { w: 800, h: 600 } });
  const rects = touch.getButtonRects();
  // All button rect centres should be below the vertical midline (y > 300).
  ['left', 'right', 'jump', 'run'].forEach(function (name) {
    const centreY = rects[name].y + rects[name].h / 2;
    assert.ok(centreY > 300, name + ' centre Y=' + centreY + ' not in lower half');
  });
});

test('AC6: D-pad on the lower-left, action buttons on the lower-right', () => {
  const { touch } = makeTouchOverlay({ viewport: { w: 800, h: 600 } });
  const rects = touch.getButtonRects();
  const midX = 400;
  const leftCx = rects.left.x + rects.left.w / 2;
  const rightCx = rects.right.x + rects.right.w / 2;
  const jumpCx = rects.jump.x + rects.jump.w / 2;
  const runCx = rects.run.x + rects.run.w / 2;
  assert.ok(leftCx < midX);
  assert.ok(rightCx < midX);
  assert.ok(jumpCx > midX);
  assert.ok(runCx > midX);
});

test('AC6: setViewport recomputes button rects', () => {
  const { touch } = makeTouchOverlay({ viewport: { w: 320, h: 480 } });
  const small = touch.getButtonRects();
  touch.setViewport(1024, 768);
  const large = touch.getButtonRects();
  assert.ok(large.left.w > small.left.w);
});

// ----------------------------------------------------------------------------
// AC7: not visible on non-touch devices
// ----------------------------------------------------------------------------

test('AC7: isActive() is false when isTouchCapable=false', () => {
  const { touch } = makeTouchOverlay({ isTouchCapable: false });
  assert.equal(touch.isActive(), false);
  assert.equal(touch.isTouchCapable(), false);
});

test('AC7: attaches NO listeners on non-touch devices', () => {
  const { target } = makeTouchOverlay({ isTouchCapable: false });
  assert.equal(target.listenerCount('touchstart'), 0);
  assert.equal(target.listenerCount('touchmove'), 0);
  assert.equal(target.listenerCount('touchend'), 0);
  assert.equal(target.listenerCount('touchcancel'), 0);
});

test('AC7: draw() is a no-op when not active', () => {
  const { touch } = makeTouchOverlay({ isTouchCapable: false });
  let calls = 0;
  const fakeCtx = {
    save: function () { calls++; },
    restore: function () { calls++; },
    fillRect: function () { calls++; },
    beginPath: function () { calls++; },
    arc: function () { calls++; },
    fill: function () { calls++; },
    fillText: function () { calls++; },
  };
  touch.draw(fakeCtx);
  assert.equal(calls, 0);
});

// ----------------------------------------------------------------------------
// AC8: touch events do not trigger unwanted browser behaviors
// ----------------------------------------------------------------------------

test('AC8: touchstart calls preventDefault to block scroll/zoom/select', () => {
  const { touch, target } = makeTouchOverlay();
  const r = touch.getButtonRects();
  const evt = makeTouchEvent([makeTouch(1, r.left.x + r.left.w / 2, r.left.y + r.left.h / 2)]);
  target.dispatch('touchstart', evt);
  assert.equal(evt._pd, 1, 'preventDefault should be called exactly once');
});

test('AC8: touchmove calls preventDefault', () => {
  const { touch, target } = makeTouchOverlay();
  const r = touch.getButtonRects();
  target.dispatch('touchstart', makeTouchEvent([makeTouch(1, r.left.x + r.left.w / 2, r.left.y + r.left.h / 2)]));
  const evt = makeTouchEvent([makeTouch(1, r.right.x + r.right.w / 2, r.right.y + r.right.h / 2)]);
  target.dispatch('touchmove', evt);
  assert.equal(evt._pd, 1);
});

test('AC8: touchend calls preventDefault', () => {
  const { touch, target } = makeTouchOverlay();
  const r = touch.getButtonRects();
  target.dispatch('touchstart', makeTouchEvent([makeTouch(1, r.jump.x, r.jump.y)]));
  const evt = makeTouchEvent([makeTouch(1, r.jump.x, r.jump.y)]);
  target.dispatch('touchend', evt);
  assert.equal(evt._pd, 1);
});

test('AC8: touch listeners are registered with passive:false', () => {
  const { target } = makeTouchOverlay();
  // passive:false is needed for preventDefault to actually suppress scroll.
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
    const opts = target.getListenerOpts(type);
    assert.ok(opts[0] && opts[0].passive === false, type + ' should be passive:false');
  });
});

// ----------------------------------------------------------------------------
// integration with the real Input module
// ----------------------------------------------------------------------------

function makeRealInputTarget() {
  const listeners = {};
  return {
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
  };
}

test('integration: touch press → real Input module isHeld() reflects it', () => {
  const inputTarget = makeRealInputTarget();
  const input = createInput({ target: inputTarget });
  const overlay = makeTouchOverlay({ input: input });
  const r = overlay.touch.getButtonRects();
  overlay.target.dispatch('touchstart', makeTouchEvent([
    makeTouch(1, r.jump.x + r.jump.w / 2, r.jump.y + r.jump.h / 2),
  ]));
  assert.equal(input.isHeld('jump'), true);
  assert.equal(input.justPressed('jump'), true);
});

test('integration: pressing same action from touch while keyboard already held is idempotent', () => {
  const inputTarget = makeRealInputTarget();
  const input = createInput({ target: inputTarget });
  const overlay = makeTouchOverlay({ input: input });
  const r = overlay.touch.getButtonRects();
  // Keyboard presses Space first.
  inputTarget.dispatch('keydown', { key: ' ', repeat: false, preventDefault: function () {} });
  input.update(); // clear justPressed
  // Now touch tries to press jump too — virtualPress is idempotent, so
  // justPressed must NOT re-fire while the action is still held.
  overlay.target.dispatch('touchstart', makeTouchEvent([
    makeTouch(1, r.jump.x + r.jump.w / 2, r.jump.y + r.jump.h / 2),
  ]));
  assert.equal(input.isHeld('jump'), true);
  assert.equal(input.justPressed('jump'), false);
});

// ----------------------------------------------------------------------------
// detach + setVisible
// ----------------------------------------------------------------------------

test('detach() removes all touch listeners and releases held actions', () => {
  const inputTarget = makeRealInputTarget();
  const input = createInput({ target: inputTarget });
  const overlay = makeTouchOverlay({ input: input });
  const r = overlay.touch.getButtonRects();
  overlay.target.dispatch('touchstart', makeTouchEvent([
    makeTouch(1, r.right.x + r.right.w / 2, r.right.y + r.right.h / 2),
  ]));
  assert.equal(input.isHeld('moveRight'), true);
  overlay.touch.detach();
  assert.equal(input.isHeld('moveRight'), false);
  assert.equal(overlay.target.listenerCount('touchstart'), 0);
});

test('setVisible(false) makes touch presses inert without detaching', () => {
  const { touch, target, input } = makeTouchOverlay();
  touch.setVisible(false);
  const r = touch.getButtonRects();
  target.dispatch('touchstart', makeTouchEvent([
    makeTouch(1, r.left.x + r.left.w / 2, r.left.y + r.left.h / 2),
  ]));
  assert.equal(input.events.length, 0);
});

// ----------------------------------------------------------------------------
// hit-test edge cases
// ----------------------------------------------------------------------------

test('hitTest returns null when viewport is unset (no buttons rendered)', () => {
  const inputTarget = makeRealInputTarget();
  const input = createInput({ target: inputTarget });
  const target = makeEventTarget();
  const t = createTouch({ target: target, input: input, isTouchCapable: true });
  // No viewport set yet → hitTest must not throw and must return null.
  assert.equal(t.hitTest(100, 100), null);
});

test('hitTest returns null for points outside any button', () => {
  const { touch } = makeTouchOverlay();
  assert.equal(touch.hitTest(0, 0), null);
  assert.equal(touch.hitTest(400, 100), null); // upper-middle = nothing
});

test('getButtonForAction reverses the action map', () => {
  const { touch } = makeTouchOverlay();
  assert.equal(touch.getButtonForAction('moveLeft'), 'left');
  assert.equal(touch.getButtonForAction('jump'), 'jump');
  assert.equal(touch.getButtonForAction('nonexistent'), null);
});

test('draw() invokes ctx primitives for each button when active + viewport set', () => {
  const { touch } = makeTouchOverlay();
  const calls = { save: 0, restore: 0, arc: 0, fillText: 0 };
  const fakeCtx = {
    save: function () { calls.save++; },
    restore: function () { calls.restore++; },
    beginPath: function () {},
    arc: function () { calls.arc++; },
    fill: function () {},
    fillText: function () { calls.fillText++; },
    fillStyle: '', globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
  };
  touch.draw(fakeCtx);
  // 4 buttons rendered → save/restore × 4, arc × 4, fillText × 4.
  assert.equal(calls.save, 4);
  assert.equal(calls.restore, 4);
  assert.equal(calls.arc, 4);
  assert.equal(calls.fillText, 4);
});

test('module exports DEFAULT_BUTTONS map covering all 4 buttons', () => {
  assert.equal(DEFAULT_BUTTONS.left.action, 'moveLeft');
  assert.equal(DEFAULT_BUTTONS.right.action, 'moveRight');
  assert.equal(DEFAULT_BUTTONS.jump.action, 'jump');
  assert.equal(DEFAULT_BUTTONS.run.action, 'run');
});
