'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInput, DEFAULT_KEY_MAP, DEFAULT_GAME_KEYS } = require('../src/input.js');

function makeEventTarget() {
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
      (listeners[type] || []).forEach((fn) => fn(evt));
    },
    listenerCount: function (type) {
      return (listeners[type] || []).length;
    },
  };
}

function pdEvent(key, opts) {
  const o = opts || {};
  return {
    key: key,
    repeat: o.repeat || false,
    _pd: 0,
    preventDefault: function () { this._pd++; },
  };
}

function press(target, key, opts) {
  const e = pdEvent(key, opts);
  target.dispatch('keydown', e);
  return e;
}

function release(target, key) {
  const e = pdEvent(key);
  target.dispatch('keyup', e);
  return e;
}

test('createInput requires an event target', () => {
  assert.throws(() => createInput({ target: null }), TypeError);
  assert.throws(() => createInput({ target: {} }), TypeError);
});

test('createInput attaches three listeners (keydown, keyup, blur)', () => {
  const t = makeEventTarget();
  createInput({ target: t });
  assert.equal(t.listenerCount('keydown'), 1);
  assert.equal(t.listenerCount('keyup'), 1);
  assert.equal(t.listenerCount('blur'), 1);
});

test('AC1: isHeld(moveLeft) is true while ArrowLeft is down, false after release', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'ArrowLeft');
  assert.equal(input.isHeld('moveLeft'), true);
  release(t, 'ArrowLeft');
  assert.equal(input.isHeld('moveLeft'), false);
});

test('AC1: isHeld(moveLeft) is true for the "a" key too (WASD)', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'a');
  assert.equal(input.isHeld('moveLeft'), true);
  release(t, 'a');
  assert.equal(input.isHeld('moveLeft'), false);
});

test('AC2: justPressed(jump) is true on first frame Space is pressed, false after update()', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, ' ');
  assert.equal(input.justPressed('jump'), true);
  assert.equal(input.isHeld('jump'), true);
  // simulate frame boundary
  input.update();
  // Space remains physically held — but justPressed must be false now
  assert.equal(input.justPressed('jump'), false);
  assert.equal(input.isHeld('jump'), true);
});

test('AC2: OS auto-repeat (event.repeat) does not re-trigger justPressed', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, ' ');
  input.update();
  // Browsers fire repeated keydowns with repeat:true while a key is held.
  press(t, ' ', { repeat: true });
  press(t, ' ', { repeat: true });
  assert.equal(input.justPressed('jump'), false);
  assert.equal(input.isHeld('jump'), true);
});

test('AC3: justPressed(pause) is true the frame P is pressed', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'p');
  assert.equal(input.justPressed('pause'), true);
  input.update();
  assert.equal(input.justPressed('pause'), false);
});

test('AC4: preventDefault is called for game keys (ArrowLeft, Space, Enter, p)', () => {
  const t = makeEventTarget();
  createInput({ target: t });
  const cases = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'p', 'm'];
  cases.forEach((k) => {
    const e = press(t, k);
    assert.equal(e._pd, 1, 'preventDefault should fire once for ' + k);
  });
});

test('AC4: preventDefault is NOT called for non-game keys', () => {
  const t = makeEventTarget();
  createInput({ target: t });
  const e1 = press(t, 'q');
  const e2 = press(t, 'F1');
  const e3 = press(t, '1');
  assert.equal(e1._pd, 0);
  assert.equal(e2._pd, 0);
  assert.equal(e3._pd, 0);
});

test('AC5: key-to-action map is configurable via remap() at runtime', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  // Initially q does nothing
  press(t, 'q');
  assert.equal(input.isHeld('jump'), false);
  // Remap q -> jump
  input.remap('q', 'jump');
  press(t, 'q');
  assert.equal(input.isHeld('jump'), true);
  assert.equal(input.justPressed('jump'), true);
});

test('AC5: caller-provided keyMap fully replaces the default', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t, keyMap: { z: 'jump' } });
  // Default keys (e.g., Space) should NOT trigger jump with this custom map
  press(t, ' ');
  assert.equal(input.isHeld('jump'), false);
  // The custom mapping should work
  press(t, 'z');
  assert.equal(input.isHeld('jump'), true);
});

test('AC5: getKeyMap returns a copy — mutating it does not affect internal state', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  const m = input.getKeyMap();
  m.q = 'jump';
  press(t, 'q');
  assert.equal(input.isHeld('jump'), false, 'returned keymap must be a copy');
});

test('DEFAULT_KEY_MAP is frozen — callers cannot mutate the shared default', () => {
  assert.throws(() => { DEFAULT_KEY_MAP.q = 'jump'; }, TypeError);
});

test('DEFAULT_GAME_KEYS is frozen', () => {
  assert.throws(() => { DEFAULT_GAME_KEYS.push('x'); }, TypeError);
});

test('AC6: update() at frame start transitions justPressed -> held only', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'ArrowRight');
  assert.equal(input.justPressed('moveRight'), true);
  assert.equal(input.isHeld('moveRight'), true);
  input.update();
  // After update, justPressed has rolled off but isHeld remains while key is down
  assert.equal(input.justPressed('moveRight'), false);
  assert.equal(input.isHeld('moveRight'), true);
});

test('justReleased fires for one frame after key release, then clears on next update', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'ArrowRight');
  input.update();
  release(t, 'ArrowRight');
  assert.equal(input.justReleased('moveRight'), true);
  assert.equal(input.isHeld('moveRight'), false);
  input.update();
  assert.equal(input.justReleased('moveRight'), false);
});

test('release without prior press is a no-op (does not flag justReleased)', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  release(t, 'ArrowRight');
  assert.equal(input.justReleased('moveRight'), false);
});

test('blur clears all held actions and flags them as just-released', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'ArrowLeft');
  press(t, ' ');
  assert.equal(input.isHeld('moveLeft'), true);
  assert.equal(input.isHeld('jump'), true);
  t.dispatch('blur', {});
  assert.equal(input.isHeld('moveLeft'), false);
  assert.equal(input.isHeld('jump'), false);
  assert.equal(input.justReleased('moveLeft'), true);
  assert.equal(input.justReleased('jump'), true);
});

test('unknown keys never produce actions or affect state', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'F5');
  release(t, 'F5');
  assert.equal(input.isHeld('moveLeft'), false);
  assert.equal(input.justPressed('jump'), false);
  assert.equal(input.justReleased('pause'), false);
});

test('detach() removes all three listeners', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  assert.equal(t.listenerCount('keydown'), 1);
  assert.equal(t.listenerCount('keyup'), 1);
  assert.equal(t.listenerCount('blur'), 1);
  input.detach();
  assert.equal(t.listenerCount('keydown'), 0);
  assert.equal(t.listenerCount('keyup'), 0);
  assert.equal(t.listenerCount('blur'), 0);
});

test('remap rejects non-string arguments', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  assert.throws(() => input.remap(123, 'jump'), TypeError);
  assert.throws(() => input.remap('q', null), TypeError);
});

test('unmap removes a key binding', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  input.unmap('ArrowLeft');
  press(t, 'ArrowLeft');
  assert.equal(input.isHeld('moveLeft'), false);
});

test('multiple held keys map to independent actions', () => {
  const t = makeEventTarget();
  const input = createInput({ target: t });
  press(t, 'ArrowLeft');
  press(t, ' ');
  press(t, 'Shift');
  assert.equal(input.isHeld('moveLeft'), true);
  assert.equal(input.isHeld('jump'), true);
  assert.equal(input.isHeld('run'), true);
  release(t, ' ');
  assert.equal(input.isHeld('moveLeft'), true);
  assert.equal(input.isHeld('jump'), false);
  assert.equal(input.isHeld('run'), true);
});
