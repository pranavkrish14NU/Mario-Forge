'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStateManager } = require('../src/state-manager.js');

function makeRecorder() {
  const calls = [];
  return {
    calls,
    log: function () { calls.push(['log'].concat([].slice.call(arguments))); },
    warn: function () { calls.push(['warn'].concat([].slice.call(arguments))); },
  };
}

function makeScene(name, log) {
  return {
    enter: function () { log.push('enter:' + name); },
    exit: function () { log.push('exit:' + name); },
    update: function (dt) { log.push('update:' + name + ':' + dt); },
    render: function (ctx) { log.push('render:' + name + ':' + (ctx && ctx.id)); },
  };
}

test('AC1: exposes registerScene, changeScene, getCurrentScene', () => {
  const sm = createStateManager();
  assert.equal(typeof sm.registerScene, 'function');
  assert.equal(typeof sm.changeScene, 'function');
  assert.equal(typeof sm.getCurrentScene, 'function');
});

test('registerScene stores the scene and getCurrentScene returns null until a transition', () => {
  const sm = createStateManager();
  const log = [];
  sm.registerScene('title', makeScene('title', log));
  assert.equal(sm.getCurrentScene(), null);
  sm.changeScene('title');
  assert.ok(sm.getCurrentScene());
  assert.equal(sm.getCurrentSceneName(), 'title');
});

test('registerScene rejects invalid args', () => {
  const sm = createStateManager();
  assert.throws(() => sm.registerScene('', {}), TypeError);
  assert.throws(() => sm.registerScene('x', null), TypeError);
  assert.throws(() => sm.registerScene(123, {}), TypeError);
});

test('AC2: missing lifecycle hooks are safely skipped', () => {
  const sm = createStateManager();
  sm.registerScene('bare', {}); // no hooks at all
  // None of these should throw.
  sm.changeScene('bare');
  sm.update(0.016);
  sm.render({});
  assert.equal(sm.getCurrentSceneName(), 'bare');
});

test('AC2: scenes with partial hooks (e.g. only render) work too', () => {
  const sm = createStateManager();
  let rendered = false;
  sm.registerScene('partial', { render: function () { rendered = true; } });
  sm.changeScene('partial');
  sm.render({});
  assert.equal(rendered, true);
});

test('changeScene fires exit on previous then enter on next', () => {
  const log = [];
  const sm = createStateManager();
  sm.registerScene('a', makeScene('a', log));
  sm.registerScene('b', makeScene('b', log));
  sm.changeScene('a');
  log.length = 0;
  sm.changeScene('b');
  assert.deepEqual(log, ['exit:a', 'enter:b']);
});

test('update/render delegate to the active scene with provided args', () => {
  const log = [];
  const sm = createStateManager();
  sm.registerScene('s', makeScene('s', log));
  sm.changeScene('s');
  log.length = 0;
  sm.update(0.016);
  sm.render({ id: 'ctx' });
  assert.deepEqual(log, ['update:s:0.016', 'render:s:ctx']);
});

test('AC5: invalid transition rejected with warn, state unchanged', () => {
  const rec = makeRecorder();
  const sm = createStateManager({
    allowedTransitions: { title: ['playing'], playing: ['paused'] },
    logger: rec,
  });
  sm.registerScene('title', { enter: function () {} });
  sm.registerScene('playing', { enter: function () {} });
  sm.registerScene('victory', { enter: function () {} });
  sm.changeScene('title');
  const ok = sm.changeScene('victory');
  assert.equal(ok, false);
  assert.equal(sm.getCurrentSceneName(), 'title');
  const warns = rec.calls.filter((c) => c[0] === 'warn');
  assert.equal(warns.length, 1);
  assert.match(warns[0][1], /Invalid transition from "title" to "victory"/);
});

test('AC5: unknown scene names are rejected with warn', () => {
  const rec = makeRecorder();
  const sm = createStateManager({ logger: rec });
  const ok = sm.changeScene('ghost');
  assert.equal(ok, false);
  assert.equal(sm.getCurrentSceneName(), null);
  const warns = rec.calls.filter((c) => c[0] === 'warn');
  assert.equal(warns.length, 1);
  assert.match(warns[0][1], /Unknown scene: "ghost"/);
});

test('first transition is always allowed regardless of allowedTransitions', () => {
  const rec = makeRecorder();
  const sm = createStateManager({
    allowedTransitions: { playing: ['paused'] }, // no entry for "title"
    logger: rec,
  });
  sm.registerScene('title', {});
  const ok = sm.changeScene('title');
  assert.equal(ok, true);
  assert.equal(sm.getCurrentSceneName(), 'title');
});

test('AC4: P toggles between playing and paused via valid transitions', () => {
  const sm = createStateManager({
    allowedTransitions: { playing: ['paused'], paused: ['playing'] },
  });
  sm.registerScene('playing', {});
  sm.registerScene('paused', {});
  sm.changeScene('playing');
  assert.equal(sm.changeScene('paused'), true);
  assert.equal(sm.getCurrentSceneName(), 'paused');
  assert.equal(sm.changeScene('playing'), true);
  assert.equal(sm.getCurrentSceneName(), 'playing');
});

test('AC6: factory instances are isolated (no shared/global state)', () => {
  const a = createStateManager();
  const b = createStateManager();
  a.registerScene('only-in-a', {});
  assert.equal(a.changeScene('only-in-a'), true);
  // b should not know about a's scene
  const rec = makeRecorder();
  const c = createStateManager({ logger: rec });
  c.registerScene('x', {});
  assert.equal(b.changeScene('only-in-a'), false);
});
