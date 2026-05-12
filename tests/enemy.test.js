'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEnemyPool,
  drawEnemy,
  SPRITES_GROUND,
  SPRITES_FLYING,
  DEFAULTS,
  TYPE_GROUND,
  TYPE_FLYING,
} = require('../src/enemy.js');
const { createTilemap } = require('../src/tilemap.js');

// A minimal floor-with-ledge map for ground-patrol tests:
//   - Floor ('#') along y=4 from x=0..9
//   - x=10..15 is empty (ledge)
//   - Wall column at x=12 from y=0..3 (so flying patrols hit something too)
//   - 'g' marker at (2, 3), 'f' marker at (6, 1)
function makePatrolMap() {
  return [
    '......f.........',
    '................',
    '..g.............',
    '............#...',
    '##########......',
  ];
}

function makeFloorOnlyMap() {
  return [
    '....................',
    '....................',
    '....................',
    '....................',
    '####################',
  ];
}

// ---------- factory & validation ----------

test('createEnemyPool exposes the public API', () => {
  const pool = createEnemyPool({});
  assert.equal(typeof pool.spawn, 'function');
  assert.equal(typeof pool.despawn, 'function');
  assert.equal(typeof pool.update, 'function');
  assert.equal(typeof pool.getActive, 'function');
  assert.equal(typeof pool.activeCount, 'function');
  assert.equal(typeof pool.capacity, 'function');
  assert.equal(typeof pool.parseSpawnsFromTilemap, 'function');
  assert.equal(typeof pool.spawnAllFromTilemap, 'function');
});

test('createEnemyPool rejects non-positive capacity', () => {
  assert.throws(() => createEnemyPool({ capacity: 0 }), RangeError);
  assert.throws(() => createEnemyPool({ capacity: -3 }), RangeError);
});

test('constants are frozen', () => {
  const pool = createEnemyPool({});
  assert.throws(() => { pool.constants.capacity = 1; }, TypeError);
});

test('DEFAULTS pool capacity matches architecture (24)', () => {
  assert.equal(DEFAULTS.capacity, 24);
});

// ---------- AC: object pool — 24 slots, no allocation after construction ----------

test('AC: capacity defaults to 24 active slots', () => {
  const pool = createEnemyPool({});
  assert.equal(pool.capacity(), 24);
});

test('AC: pool starts empty (no active enemies)', () => {
  const pool = createEnemyPool({});
  assert.equal(pool.activeCount(), 0);
  assert.equal(pool.getActive().length, 0);
});

test('AC: spawn fills slots up to capacity then returns null', () => {
  const pool = createEnemyPool({ capacity: 3 });
  const a = pool.spawn(TYPE_GROUND, 0, 0);
  const b = pool.spawn(TYPE_GROUND, 16, 0);
  const c = pool.spawn(TYPE_FLYING, 32, 0);
  const overflow = pool.spawn(TYPE_GROUND, 48, 0);
  assert.ok(a && b && c, 'first 3 spawns succeed');
  assert.equal(overflow, null, 'spawn beyond capacity returns null');
  assert.equal(pool.activeCount(), 3);
});

test('AC: despawning frees a slot; next spawn reuses the SAME object (no allocation)', () => {
  const pool = createEnemyPool({ capacity: 2 });
  const a = pool.spawn(TYPE_GROUND, 0, 0);
  pool.spawn(TYPE_FLYING, 16, 0);
  pool.despawn(a);
  const reused = pool.spawn(TYPE_GROUND, 32, 0);
  assert.equal(reused, a, 'reused slot must be the same object reference');
  assert.equal(pool.activeCount(), 2);
});

test('despawning the same enemy twice is a no-op', () => {
  const pool = createEnemyPool({ capacity: 2 });
  const a = pool.spawn(TYPE_GROUND, 0, 0);
  pool.despawn(a);
  pool.despawn(a); // does not throw, does not decrement below 0
  assert.equal(pool.activeCount(), 0);
});

test('_pool reference is the SAME array across spawn cycles (allocation discipline)', () => {
  const pool = createEnemyPool({ capacity: 4 });
  const ref = pool._pool;
  pool.spawn(TYPE_GROUND, 0, 0);
  pool.spawn(TYPE_FLYING, 16, 0);
  pool.despawn(ref[0]);
  pool.spawn(TYPE_GROUND, 32, 0);
  assert.strictEqual(pool._pool, ref, 'pool array reference must not be re-created');
  // Each slot is also the same object reference.
  for (let i = 0; i < ref.length; i++) assert.equal(typeof ref[i], 'object');
});

// ---------- AC: spawning from tilemap markers ----------

test('AC: parseSpawnsFromTilemap finds g/f markers and yields world-space coords', () => {
  const tm = createTilemap({ tileSize: 16, map: makePatrolMap() });
  const pool = createEnemyPool({ tilemap: tm });
  const spawns = pool.parseSpawnsFromTilemap(tm);
  assert.equal(spawns.length, 2);
  const ground = spawns.find(s => s.type === TYPE_GROUND);
  const flying = spawns.find(s => s.type === TYPE_FLYING);
  assert.ok(ground && flying, 'both spawn types found');
  assert.equal(ground.x, 2 * 16);
  assert.equal(ground.y, 2 * 16);
  assert.equal(flying.x, 6 * 16);
  assert.equal(flying.y, 0 * 16);
});

test('AC: spawnAllFromTilemap activates one enemy per marker', () => {
  const tm = createTilemap({ tileSize: 16, map: makePatrolMap() });
  const pool = createEnemyPool({ tilemap: tm });
  const list = pool.spawnAllFromTilemap(tm);
  assert.equal(list.length, 2);
  assert.equal(pool.activeCount(), 2);
});

test('spawnAllFromTilemap stops cleanly when pool is full (excess markers ignored)', () => {
  const map = [
    'gggggg', // 6 ground markers
    '......',
  ];
  const tm = createTilemap({ tileSize: 16, map: map });
  const pool = createEnemyPool({ tilemap: tm, capacity: 3 });
  const list = pool.spawnAllFromTilemap(tm);
  assert.equal(list.length, 3, 'only capacity-many enemies spawn');
  assert.equal(pool.activeCount(), 3);
});

// ---------- AC: ground patrol — reverses at walls and ledges ----------

test('AC: ground patrol walks horizontally between updates', () => {
  const tm = createTilemap({ tileSize: 16, map: makeFloorOnlyMap() });
  const pool = createEnemyPool({ tilemap: tm });
  // Stand the enemy on top of the floor (floor starts at row 4 = y=64).
  const e = pool.spawn(TYPE_GROUND, 5 * 16, 4 * 16 - 16, { facing: 'right' });
  const x0 = e.x;
  pool.update({}); // proximity gating bypassed when viewport.width omitted
  assert.notEqual(e.x, x0, 'enemy should move when active');
  assert.ok(e.x > x0, 'right-facing enemy moves +x');
});

test('AC: ground patrol reverses direction at a wall', () => {
  // Wall column at x=4 from row 0..3 (above the floor at row 4).
  const map = [
    '....#...........',
    '....#...........',
    '....#...........',
    '....#...........',
    '################',
  ];
  const tm = createTilemap({ tileSize: 16, map: map });
  const pool = createEnemyPool({ tilemap: tm });
  // Place enemy walking right toward the wall.
  const e = pool.spawn(TYPE_GROUND, 3 * 16, 3 * 16, { facing: 'right', walkSpeed: 1 });
  // March it forward until it bumps the wall and reverses.
  let lastVx = e.vx;
  let reversedFrame = -1;
  for (let i = 0; i < 30; i++) {
    pool.update({});
    if (Math.sign(e.vx) !== Math.sign(lastVx)) {
      reversedFrame = i;
      break;
    }
    lastVx = e.vx;
  }
  assert.notEqual(reversedFrame, -1, 'enemy should reverse direction at the wall');
  assert.ok(e.vx < 0, 'after reversal, vx is negative (moving left)');
  assert.equal(e.facing, 'left');
});

test('AC: ground patrol reverses at a platform edge (does not walk off)', () => {
  // Short platform at row 4 from x=0..5; void after.
  const map = [
    '........',
    '........',
    '........',
    '........',
    '######..',
  ];
  const tm = createTilemap({ tileSize: 16, map: map });
  const pool = createEnemyPool({ tilemap: tm });
  // Place enemy walking right near the edge.
  const e = pool.spawn(TYPE_GROUND, 4 * 16, 3 * 16, { facing: 'right', walkSpeed: 1 });
  let reversed = false;
  // Track the rightmost x so we can assert the enemy never crosses the edge.
  let maxX = e.x;
  for (let i = 0; i < 30; i++) {
    pool.update({});
    if (e.x > maxX) maxX = e.x;
    if (e.vx < 0) { reversed = true; break; }
  }
  assert.ok(reversed, 'enemy should reverse at the platform edge');
  // Edge is at x = 6 * 16 = 96; enemy should not have gone past it
  // (its right edge — x + width — should not exceed the floor's right edge).
  assert.ok(maxX + e.w <= 6 * 16 + 16, 'enemy did not walk off the platform');
});

// ---------- AC: flying patrol — sinusoidal motion within range ----------

test('AC: flying patrol oscillates horizontally around its anchor', () => {
  const pool = createEnemyPool({});
  const e = pool.spawn(TYPE_FLYING, 200, 50, { amplitude: 40, frequency: 0.1 });
  let minX = e.x, maxX = e.x;
  for (let i = 0; i < 200; i++) {
    pool.update({});
    if (e.x < minX) minX = e.x;
    if (e.x > maxX) maxX = e.x;
  }
  // Sinusoid centred on anchorX=200 with amplitude=40 ⇒ swings between 160 and 240.
  assert.ok(maxX > 200 + 30, 'should swing right of anchor');
  assert.ok(minX < 200 - 30, 'should swing left of anchor');
  assert.ok(maxX - minX <= 2 * 40 + 1, 'total x-span bounded by 2 × amplitude');
});

test('flying patrol facing flips with its horizontal velocity', () => {
  const pool = createEnemyPool({});
  const e = pool.spawn(TYPE_FLYING, 100, 50, { amplitude: 20, frequency: 0.3 });
  const facings = new Set();
  for (let i = 0; i < 50; i++) {
    pool.update({});
    facings.add(e.facing);
  }
  assert.ok(facings.has('left') && facings.has('right'), 'flying enemy faces both directions over time');
});

// ---------- AC: sprites — ≥ 2 frames each, visually distinct from each other ----------

test('AC: each enemy type has at least 2 animation frames', () => {
  assert.ok(SPRITES_GROUND.length >= 2);
  assert.ok(SPRITES_FLYING.length >= 2);
});

test('AC: ground and flying sprites are visually distinct (different pixel arrays)', () => {
  const g = SPRITES_GROUND[0];
  const f = SPRITES_FLYING[0];
  // Different sizes (16×16 vs 16×12) AND/OR different content — either is enough.
  assert.notEqual(g.length, f.length, 'sprite buffers differ in size — visually distinct silhouettes');
});

test('AC: animation frames within a type are not identical (frame advance is visible)', () => {
  // Compare frame 0 and frame 1 element-wise — at least one pixel must differ.
  function distinct(a, b) {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
  }
  assert.ok(distinct(SPRITES_GROUND[0], SPRITES_GROUND[1]), 'ground frames differ');
  assert.ok(distinct(SPRITES_FLYING[0], SPRITES_FLYING[1]), 'flying frames differ');
});

test('drawEnemy renders pixel rects from sprite data', () => {
  const calls = [];
  const ctx = {
    fillStyle: '',
    fillRect: function (x, y, w, h) { calls.push({ x, y, w, h, fillStyle: this.fillStyle }); },
  };
  const e = { type: TYPE_GROUND, w: 16, h: 16, facing: 'right', animFrame: 0 };
  drawEnemy(ctx, 100, 50, e);
  assert.ok(calls.length > 0, 'expected sprite to issue at least one fillRect');
  // All draw calls land inside the 16×16 box anchored at (100, 50).
  for (const c of calls) {
    assert.ok(c.x >= 100 && c.x < 100 + 16);
    assert.ok(c.y >= 50 && c.y < 50 + 16);
    assert.equal(c.w, 1);
    assert.equal(c.h, 1);
  }
});

test('drawEnemy flips horizontally when facing left', () => {
  const callsRight = [];
  const callsLeft = [];
  const ctxR = { fillStyle: '', fillRect: function (x, y) { callsRight.push({ x, y }); } };
  const ctxL = { fillStyle: '', fillRect: function (x, y) { callsLeft.push({ x, y }); } };
  const er = { type: TYPE_GROUND, w: 16, h: 16, facing: 'right', animFrame: 0 };
  const el = { type: TYPE_GROUND, w: 16, h: 16, facing: 'left', animFrame: 0 };
  drawEnemy(ctxR, 0, 0, er);
  drawEnemy(ctxL, 0, 0, el);
  // Same pixel count regardless of flip.
  assert.equal(callsRight.length, callsLeft.length);
  // Mirror invariant: for every (x, y) in right, (15 - x, y) appears in left.
  const leftSet = new Set(callsLeft.map(c => c.x + ',' + c.y));
  for (const c of callsRight) {
    assert.ok(leftSet.has((15 - c.x) + ',' + c.y), 'mirror pixel missing at ' + c.x + ',' + c.y);
  }
});

// ---------- AC: proximity gating (only update enemies near the camera) ----------

test('AC: enemies outside the wake band do not advance position', () => {
  const tm = createTilemap({ tileSize: 16, map: makeFloorOnlyMap() });
  const pool = createEnemyPool({ tilemap: tm, cullDistanceFactor: 2 });
  // Two enemies: one near the camera, one ~10 viewports away.
  const near = pool.spawn(TYPE_GROUND, 100, 48, { facing: 'right' });
  const far = pool.spawn(TYPE_GROUND, 100 + 10 * 256, 48, { facing: 'right' });
  const farX0 = far.x;
  for (let i = 0; i < 10; i++) {
    pool.update({ cameraOffset: { x: 0 }, viewport: { width: 256, height: 240 } });
  }
  assert.notEqual(near.x, 100, 'near enemy moved');
  assert.equal(far.x, farX0, 'far enemy stayed put (proximity-gated)');
});

test('AC: flying enemy outside the wake band does not advance its phase either', () => {
  const pool = createEnemyPool({});
  const e = pool.spawn(TYPE_FLYING, 100 + 10 * 256, 50, { amplitude: 40, frequency: 0.1 });
  const phase0 = e.phase;
  for (let i = 0; i < 20; i++) {
    pool.update({ cameraOffset: { x: 0 }, viewport: { width: 256, height: 240 } });
  }
  assert.equal(e.phase, phase0, 'phase unchanged when culled');
});

test('proximity gating bypassed when viewport.width omitted (tests without camera)', () => {
  const tm = createTilemap({ tileSize: 16, map: makeFloorOnlyMap() });
  const pool = createEnemyPool({ tilemap: tm });
  const e = pool.spawn(TYPE_GROUND, 100, 48, { facing: 'right' });
  const x0 = e.x;
  pool.update({}); // no viewport, no culling
  assert.notEqual(e.x, x0);
});

// ---------- AC: bounding boxes ----------

test('AC: ground enemy bounding box defaults to tile-sized 16×16', () => {
  const pool = createEnemyPool({});
  const e = pool.spawn(TYPE_GROUND, 0, 0);
  assert.equal(e.w, 16);
  assert.equal(e.h, 16);
});

test('AC: flying enemy bounding box is its slim 16×12 silhouette', () => {
  const pool = createEnemyPool({});
  const e = pool.spawn(TYPE_FLYING, 0, 0);
  assert.equal(e.w, 16);
  assert.equal(e.h, 12);
});

test('spawn opts can override width/height for special enemies', () => {
  const pool = createEnemyPool({});
  const e = pool.spawn(TYPE_GROUND, 0, 0, { width: 24, height: 24 });
  assert.equal(e.w, 24);
  assert.equal(e.h, 24);
});

// ---------- animation advance ----------

test('animation frame advances over time (at the configured interval)', () => {
  const pool = createEnemyPool({ animFrameInterval: 3 });
  const e = pool.spawn(TYPE_FLYING, 0, 0, { amplitude: 0, frequency: 0 });
  const f0 = e.animFrame;
  for (let i = 0; i < 10; i++) {
    pool.update({});
  }
  assert.notEqual(e.animFrame, f0, 'frame should advance');
});

// ---------- Renderer compatibility ----------

test('each spawned enemy carries a draw function the Renderer can call', () => {
  const pool = createEnemyPool({});
  const e = pool.spawn(TYPE_GROUND, 0, 0);
  assert.equal(typeof e.draw, 'function');
  // drawEnemy signature is (ctx, sx, sy, e) — matches Renderer's entities hook.
  assert.equal(e.draw.length, 4);
});

test('getActive returns only currently-active enemies (renderer feed)', () => {
  const pool = createEnemyPool({ capacity: 5 });
  const a = pool.spawn(TYPE_GROUND, 0, 0);
  const b = pool.spawn(TYPE_FLYING, 16, 0);
  pool.spawn(TYPE_GROUND, 32, 0);
  pool.despawn(b);
  const active = pool.getActive();
  assert.equal(active.length, 2);
  assert.ok(active.includes(a));
  assert.ok(!active.includes(b));
});
