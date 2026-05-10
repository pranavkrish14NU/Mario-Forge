'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaceholderScenes, DEFAULT_TRANSITIONS } = require('../src/scenes.js');

function fakeCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: null,
    font: null,
    fillRect: function (x, y, w, h) { calls.push(['rect', this.fillStyle, x, y, w, h]); },
    fillText: function (txt, x, y) { calls.push(['text', this.fillStyle, txt, x, y]); },
  };
}

test('createPlaceholderScenes returns all six scenes required by WO-002', () => {
  const scenes = createPlaceholderScenes();
  ['title', 'playing', 'paused', 'gameOver', 'victory', 'levelTransition'].forEach((name) => {
    assert.ok(scenes[name], 'scene missing: ' + name);
    assert.equal(typeof scenes[name].enter, 'function');
    assert.equal(typeof scenes[name].exit, 'function');
    assert.equal(typeof scenes[name].update, 'function');
    assert.equal(typeof scenes[name].render, 'function');
  });
});

test('AC3: each scene paints a distinct background color', () => {
  const scenes = createPlaceholderScenes({ width: 320, height: 180 });
  const colors = new Set();
  Object.keys(scenes).forEach((name) => {
    const ctx = fakeCtx();
    scenes[name].render(ctx);
    const rectCall = ctx.calls.find((c) => c[0] === 'rect');
    assert.ok(rectCall, 'no fillRect for ' + name);
    colors.add(rectCall[1]);
    assert.deepEqual(rectCall.slice(2), [0, 0, 320, 180]);
  });
  assert.equal(colors.size, 6, 'expected 6 distinct background colors, got ' + colors.size);
});

test('enter() logs the scene name via injected logger', () => {
  const logs = [];
  const scenes = createPlaceholderScenes({
    logger: { log: function (m) { logs.push(m); } },
  });
  scenes.title.enter();
  scenes.playing.enter();
  assert.deepEqual(logs, ['[Scene] enter: title', '[Scene] enter: playing']);
});

test('DEFAULT_TRANSITIONS forbids title -> victory (AC5 invariant)', () => {
  assert.ok(!DEFAULT_TRANSITIONS.title.includes('victory'));
  assert.ok(DEFAULT_TRANSITIONS.title.includes('playing'));
  assert.ok(DEFAULT_TRANSITIONS.playing.includes('paused'));
  assert.ok(DEFAULT_TRANSITIONS.paused.includes('playing'));
});

test('DEFAULT_TRANSITIONS is frozen — callers cannot mutate the contract', () => {
  assert.throws(() => { DEFAULT_TRANSITIONS.title = ['anything']; }, TypeError);
});
