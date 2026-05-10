'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../src/game.js');
const { createStateManager } = require('../src/state-manager.js');

function fakeRafLoop() {
  // Manual rAF substitute: queue callbacks; tests step them deliberately so
  // we never depend on real animation frame timing.
  const queue = [];
  let nextId = 1;
  return {
    raf: function (cb) {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    caf: function (id) {
      const i = queue.findIndex((e) => e.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
    runOne: function (timestamp) {
      const e = queue.shift();
      if (!e) return false;
      e.cb(timestamp);
      return true;
    },
    pending: function () { return queue.length; },
  };
}

function makeSM() {
  const sm = createStateManager();
  const calls = [];
  sm.registerScene('s', {
    enter: function () { calls.push('enter'); },
    update: function (dt) { calls.push('update:' + dt); },
    render: function (ctx) { calls.push('render:' + (ctx && ctx.id)); },
  });
  sm.changeScene('s');
  return { sm, calls };
}

test('createGame requires a stateManager', () => {
  assert.throws(() => createGame({}), TypeError);
});

test('start() schedules a frame; tick delegates update + render to active scene', () => {
  const { sm, calls } = makeSM();
  const loop = fakeRafLoop();
  const ctx = { id: 'ctx' };
  const game = createGame({
    stateManager: sm,
    ctx,
    rafProvider: loop.raf,
    cancelProvider: loop.caf,
  });
  calls.length = 0;
  game.start();
  assert.equal(game.isRunning(), true);
  assert.equal(loop.pending(), 1);
  loop.runOne(1000);
  // first tick has dt 0 because lastTime starts at 0
  assert.ok(calls.includes('update:0'));
  assert.ok(calls.includes('render:ctx'));
  // running=true means a new frame was scheduled by the previous tick
  assert.equal(loop.pending(), 1);
  loop.runOne(1016);
  assert.ok(calls.includes('update:0.016'));
});

test('stop() halts the loop and cancels the pending frame', () => {
  const { sm } = makeSM();
  const loop = fakeRafLoop();
  const game = createGame({
    stateManager: sm,
    ctx: null,
    rafProvider: loop.raf,
    cancelProvider: loop.caf,
  });
  game.start();
  assert.equal(loop.pending(), 1);
  game.stop();
  assert.equal(game.isRunning(), false);
  assert.equal(loop.pending(), 0);
});

test('start() is idempotent — calling twice does not double-schedule', () => {
  const { sm } = makeSM();
  const loop = fakeRafLoop();
  const game = createGame({
    stateManager: sm,
    rafProvider: loop.raf,
    cancelProvider: loop.caf,
  });
  game.start();
  game.start();
  assert.equal(loop.pending(), 1);
});

test('tick() runs a frame manually without start() — useful for deterministic tests', () => {
  const { sm, calls } = makeSM();
  const loop = fakeRafLoop();
  const game = createGame({
    stateManager: sm,
    ctx: { id: 'manual' },
    rafProvider: loop.raf,
    cancelProvider: loop.caf,
  });
  calls.length = 0;
  game.tick(500);
  assert.ok(calls.some((c) => c.startsWith('update:')));
  assert.ok(calls.includes('render:manual'));
  // running=false → no follow-up frame scheduled
  assert.equal(loop.pending(), 0);
});

test('no rendering attempted when ctx is null', () => {
  const { sm, calls } = makeSM();
  const loop = fakeRafLoop();
  const game = createGame({
    stateManager: sm,
    ctx: null,
    rafProvider: loop.raf,
    cancelProvider: loop.caf,
  });
  calls.length = 0;
  game.tick(0);
  assert.equal(calls.filter((c) => c.startsWith('render')).length, 0);
});
