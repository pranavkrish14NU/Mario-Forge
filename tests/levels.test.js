'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLevelManager,
  DEFAULT_LEVELS,
  LEVEL_GRASSLANDS,
  LEVEL_CAVE,
  LEVEL_SKY,
  SPAWN_CHAR,
  GOAL_CHAR,
} = require('../src/levels.js');
const { createTilemap } = require('../src/tilemap.js');
const { createLevelTransitionScreen } = require('../src/screens.js');

// ---------- defaults ----------

test('DEFAULT_LEVELS exposes 3 themed levels', () => {
  assert.equal(DEFAULT_LEVELS.length, 3);
  const names = DEFAULT_LEVELS.map(l => l.name);
  assert.deepEqual(names, ['Grasslands', 'Cave', 'Sky']);
});

test('each default level has a goal tile somewhere', () => {
  for (const lvl of DEFAULT_LEVELS) {
    let found = false;
    for (const row of lvl.map) {
      if (row.indexOf(GOAL_CHAR) !== -1) { found = true; break; }
    }
    assert.ok(found, 'level ' + lvl.name + ' must contain a goal');
  }
});

test('each default level has a spawn marker', () => {
  for (const lvl of DEFAULT_LEVELS) {
    let found = false;
    for (const row of lvl.map) {
      if (row.indexOf(SPAWN_CHAR) !== -1) { found = true; break; }
    }
    assert.ok(found, 'level ' + lvl.name + ' must contain a spawn marker');
  }
});

// ---------- manager basics ----------

test('createLevelManager rejects empty level list', () => {
  assert.throws(() => createLevelManager({ levels: [] }), RangeError);
});

test('currentIndex starts at 0 and currentLevel matches', () => {
  const lm = createLevelManager({});
  assert.equal(lm.currentIndex(), 0);
  assert.equal(lm.currentLevel().name, 'Grasslands');
  assert.equal(lm.totalLevels(), 3);
});

test('isVictoryNext is true only on the final level', () => {
  const lm = createLevelManager({});
  assert.equal(lm.isVictoryNext(), false);
  lm.reachGoal(); lm.completeTransition();
  assert.equal(lm.isVictoryNext(), false);
  lm.reachGoal(); lm.completeTransition();
  assert.equal(lm.isVictoryNext(), true);
});

test('isTransitioning toggles via reachGoal → completeTransition', () => {
  const lm = createLevelManager({});
  assert.equal(lm.isTransitioning(), false);
  lm.reachGoal();
  assert.equal(lm.isTransitioning(), true);
  lm.completeTransition();
  assert.equal(lm.isTransitioning(), false);
});

test('AC: completing the goal in level 1 advances to level 2', () => {
  const loaded = [];
  const lm = createLevelManager({ onLoadLevel: function (lvl, i) { loaded.push({ name: lvl.name, i }); } });
  lm.reachGoal();
  lm.completeTransition();
  assert.equal(lm.currentIndex(), 1);
  assert.equal(lm.currentLevel().name, 'Cave');
  assert.deepEqual(loaded[loaded.length - 1], { name: 'Cave', i: 1 });
});

test('AC: completing the goal in level 3 fires onVictory (no advance)', () => {
  let victories = 0;
  const lm = createLevelManager({ onVictory: function () { victories++; } });
  // Walk to level 3.
  lm.reachGoal(); lm.completeTransition();
  lm.reachGoal(); lm.completeTransition();
  assert.equal(lm.currentIndex(), 2);
  lm.reachGoal();
  lm.completeTransition();
  assert.equal(victories, 1);
  assert.equal(lm.currentIndex(), 2, 'index does NOT advance past final level');
});

test('reachGoal is idempotent during an active transition', () => {
  const lm = createLevelManager({});
  lm.reachGoal();
  lm.reachGoal();
  lm.completeTransition();
  assert.equal(lm.currentIndex(), 1);
});

test('completeTransition is a no-op when not transitioning', () => {
  const lm = createLevelManager({});
  lm.completeTransition();
  assert.equal(lm.currentIndex(), 0);
});

test('reset returns to level 0 and fires onLoadLevel', () => {
  const loaded = [];
  const lm = createLevelManager({ onLoadLevel: function (lvl, i) { loaded.push(i); } });
  lm.reachGoal(); lm.completeTransition();
  assert.equal(lm.currentIndex(), 1);
  lm.reset();
  assert.equal(lm.currentIndex(), 0);
  assert.equal(loaded[loaded.length - 1], 0);
});

// ---------- spawn position ----------

test('AC: getSpawnPosition returns the P-marker position in world coords', () => {
  const lm = createLevelManager({});
  const spawn = lm.getSpawnPosition();
  // First default level (Grasslands) has 'P' at tx=0, ty=9.
  assert.equal(spawn.x, 0);
  assert.equal(spawn.y, 9 * 16);
});

test('getSpawnPositionFor scans an arbitrary level', () => {
  const lm = createLevelManager({});
  const cave = lm._levels[1];
  const spawn = lm.getSpawnPositionFor(cave);
  // Cave row 9: '#P..............##........h.G..#'
  assert.equal(spawn.x, 1 * 16);
  assert.equal(spawn.y, 9 * 16);
});

test('getSpawnPosition falls back to (32, 100) when no P-marker exists', () => {
  const noMarker = { name: 'NoSpawn', map: ['................', '################'] };
  const lm = createLevelManager({ levels: [noMarker] });
  const spawn = lm.getSpawnPosition();
  assert.equal(spawn.x, 32);
  assert.equal(spawn.y, 100);
});

// ---------- goal contact ----------

test('AC: goalContact returns true when player overlaps a G tile', () => {
  const lm = createLevelManager({});
  const tm = createTilemap({ tileSize: 16, map: lm.currentLevel().map });
  // Grasslands has G at row 9 around col 26 (`P..c.c....................G.....`).
  const player = { x: 26 * 16, y: 9 * 16, w: 16, h: 16 };
  assert.equal(lm.goalContact(player, tm), true);
});

test('goalContact returns false when player is elsewhere', () => {
  const lm = createLevelManager({});
  const tm = createTilemap({ tileSize: 16, map: lm.currentLevel().map });
  const player = { x: 0, y: 0, w: 16, h: 16 };
  assert.equal(lm.goalContact(player, tm), false);
});

// ---------- nextLevelName ----------

test('nextLevelName returns the upcoming level title', () => {
  const lm = createLevelManager({});
  assert.equal(lm.nextLevelName(), 'Cave');
  lm.reachGoal(); lm.completeTransition();
  assert.equal(lm.nextLevelName(), 'Sky');
  lm.reachGoal(); lm.completeTransition();
  assert.equal(lm.nextLevelName(), null);
});

// ---------- transition screen ----------

test('createLevelTransitionScreen requires width and height', () => {
  assert.throws(() => createLevelTransitionScreen({}), TypeError);
});

test('AC: level-transition screen counts frames and fires onComplete at durationFrames', () => {
  let completed = false;
  const sc = createLevelTransitionScreen({
    width: 256, height: 240, durationFrames: 5,
    getLevelIndex: function () { return 1; },
    getLevelName: function () { return 'Cave'; },
    transitions: { onComplete: function () { completed = true; } },
  });
  sc.enter();
  for (let i = 0; i < 4; i++) sc.update(0);
  assert.equal(completed, false);
  sc.update(0); // 5th frame
  assert.equal(completed, true);
});

test('AC: level-transition screen renders LEVEL N and the level name', () => {
  const calls = [];
  const ctx = {
    fillStyle: '', font: '',
    fillRect: function () {},
    fillText: function (text) { calls.push(text); },
    measureText: function (str) { return { width: str.length * 6 }; },
  };
  const sc = createLevelTransitionScreen({
    width: 256, height: 240, durationFrames: 999,
    getLevelIndex: function () { return 1; },
    getLevelName: function () { return 'Cave'; },
  });
  sc.enter();
  sc.render(ctx);
  assert.ok(calls.some(t => /LEVEL 2/.test(t)), 'expected LEVEL 2 label');
  assert.ok(calls.some(t => /Cave/.test(t)), 'expected level name');
});

test('level-transition screen onComplete fires exactly once even if updated past duration', () => {
  let n = 0;
  const sc = createLevelTransitionScreen({
    width: 256, height: 240, durationFrames: 3,
    transitions: { onComplete: function () { n++; } },
  });
  sc.enter();
  for (let i = 0; i < 10; i++) sc.update(0);
  assert.equal(n, 1);
});

// ---------- constants & data sanity ----------

test('manager constants are frozen', () => {
  const lm = createLevelManager({});
  assert.throws(() => { lm.constants.tileSize = 8; }, TypeError);
});

test('Cave + Sky level constants exported individually', () => {
  assert.ok(Array.isArray(LEVEL_GRASSLANDS));
  assert.ok(Array.isArray(LEVEL_CAVE));
  assert.ok(Array.isArray(LEVEL_SKY));
});
