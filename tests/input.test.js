'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInputHandler } = require('../src/input.js');
const { createStateManager } = require('../src/state-manager.js');
const { createPlaceholderScenes, DEFAULT_TRANSITIONS } = require('../src/scenes.js');

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

function setupGame() {
  const sm = createStateManager({ allowedTransitions: DEFAULT_TRANSITIONS });
  const scenes = createPlaceholderScenes({ logger: { log: function () {} } });
  Object.keys(scenes).forEach((n) => sm.registerScene(n, scenes[n]));
  sm.changeScene('title');
  return sm;
}

test('createInputHandler requires a stateManager', () => {
  assert.throws(() => createInputHandler({}), TypeError);
  assert.throws(() => createInputHandler({ stateManager: setupGame(), target: {} }), TypeError);
});

test('AC3: ENTER on title transitions to playing', () => {
  const sm = setupGame();
  const target = makeEventTarget();
  createInputHandler({ stateManager: sm, target });
  target.dispatch('keydown', { key: 'Enter' });
  assert.equal(sm.getCurrentSceneName(), 'playing');
});

test('AC4: P during playing → paused, P again → playing', () => {
  const sm = setupGame();
  const target = makeEventTarget();
  createInputHandler({ stateManager: sm, target });
  target.dispatch('keydown', { key: 'Enter' });
  assert.equal(sm.getCurrentSceneName(), 'playing');
  target.dispatch('keydown', { key: 'p' });
  assert.equal(sm.getCurrentSceneName(), 'paused');
  target.dispatch('keydown', { key: 'P' });
  assert.equal(sm.getCurrentSceneName(), 'playing');
});

test('ENTER on gameOver returns to title', () => {
  const sm = setupGame();
  const target = makeEventTarget();
  createInputHandler({ stateManager: sm, target });
  target.dispatch('keydown', { key: 'Enter' });        // title -> playing
  sm.changeScene('gameOver');                           // playing -> gameOver
  target.dispatch('keydown', { key: 'Enter' });        // gameOver -> title
  assert.equal(sm.getCurrentSceneName(), 'title');
});

test('unrelated keys are ignored (no state change, no throw)', () => {
  const sm = setupGame();
  const target = makeEventTarget();
  createInputHandler({ stateManager: sm, target });
  target.dispatch('keydown', { key: 'q' });
  target.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(sm.getCurrentSceneName(), 'title');
});

test('detach() removes the keydown listener', () => {
  const sm = setupGame();
  const target = makeEventTarget();
  const handler = createInputHandler({ stateManager: sm, target });
  assert.equal(target.listenerCount('keydown'), 1);
  handler.detach();
  assert.equal(target.listenerCount('keydown'), 0);
});

test('handleKey() lets tests bypass DOM event plumbing', () => {
  const sm = setupGame();
  const target = makeEventTarget();
  const handler = createInputHandler({ stateManager: sm, target });
  assert.equal(handler.handleKey('Enter'), true);
  assert.equal(sm.getCurrentSceneName(), 'playing');
});
