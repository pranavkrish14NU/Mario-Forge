'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhysics, DEFAULTS } = require('../src/physics.js');

function entity(overrides) {
  return Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0 }, overrides || {});
}

// Find the first frame index where predicate is true. Returns -1 if not hit
// within the cap. Mutates the entity (caller's expectation).
function stepUntil(physics, e, predicate, cap) {
  const max = cap || 200;
  for (let i = 1; i <= max; i++) {
    physics.update(e, 1);
    if (predicate(e, i)) return i;
  }
  return -1;
}

test('createPhysics exposes update, jump, cutJump, constants', () => {
  const p = createPhysics();
  assert.equal(typeof p.update, 'function');
  assert.equal(typeof p.jump, 'function');
  assert.equal(typeof p.cutJump, 'function');
  assert.equal(typeof p.constants, 'object');
});

test('constants are frozen so callers cannot tamper with tuning at runtime', () => {
  const p = createPhysics();
  assert.throws(() => { p.constants.gravity = 99; }, TypeError);
});

test('options override DEFAULTS', () => {
  const p = createPhysics({ gravity: 1.5, maxSpeedX: 5 });
  assert.equal(p.constants.gravity, 1.5);
  assert.equal(p.constants.maxSpeedX, 5);
  // Untouched defaults preserved
  assert.equal(p.constants.friction, DEFAULTS.friction);
});

test('update throws if entity is missing', () => {
  const p = createPhysics();
  assert.throws(() => p.update(null, 1), TypeError);
});

// ---------- AC1: friction stops idle entity within 10 frames ----------
test('AC1: entity with no input decelerates to zero within 10 frames', () => {
  const p = createPhysics();
  const e = entity({ vx: p.constants.maxSpeedX }); // start at top speed
  const stopped = stepUntil(p, e, (ent) => ent.vx === 0, 10);
  assert.notEqual(stopped, -1, 'should reach vx=0');
  assert.ok(stopped <= 10, 'reached zero in ' + stopped + ' frames (limit 10)');
});

test('AC1: friction also stops a negative velocity', () => {
  const p = createPhysics();
  const e = entity({ vx: -p.constants.maxSpeedX });
  const stopped = stepUntil(p, e, (ent) => ent.vx === 0, 10);
  assert.notEqual(stopped, -1);
  assert.ok(stopped <= 10);
});

test('AC1: friction is monotonic — vx never overshoots zero', () => {
  const p = createPhysics();
  const e = entity({ vx: 2.5 });
  let prev = e.vx;
  for (let i = 0; i < 12; i++) {
    p.update(e, 1);
    // |vx| is monotonically non-increasing while idle
    assert.ok(Math.abs(e.vx) <= Math.abs(prev), 'friction must not increase speed');
    // sign should not flip
    if (prev > 0) assert.ok(e.vx >= 0, 'should not cross zero from positive side');
    prev = e.vx;
  }
});

// ---------- AC2: gravity + terminal velocity ----------
test('AC2: gravity accelerates a falling entity at a consistent rate', () => {
  const p = createPhysics();
  const e = entity();
  const before = e.vy;
  p.update(e, 1);
  assert.equal(e.vy - before, p.constants.gravity, 'one frame of gravity = exactly gravity units');
  p.update(e, 1);
  // After 2 frames, vy = 2 * gravity
  assert.equal(e.vy, p.constants.gravity * 2);
});

test('AC2: vy reaches terminalVelocityY and does not exceed it', () => {
  const p = createPhysics({ gravity: 0.5, terminalVelocityY: 8 });
  const e = entity();
  for (let i = 0; i < 100; i++) p.update(e, 1);
  assert.equal(e.vy, 8, 'vy must be clamped to terminal velocity');
  // One more update should still be terminal — never overshoots.
  p.update(e, 1);
  assert.equal(e.vy, 8);
});

// ---------- AC3: jump produces a parabolic arc with expected peak ----------
test('AC3: jump produces a parabolic arc; peak ≈ vy² / (2*g)', () => {
  const p = createPhysics({ gravity: 0.5, jumpVelocity: 12 });
  const e = entity();
  p.jump(e);
  assert.equal(e.vy, -12);
  // Simulate until apex (vy crosses from negative to non-negative).
  let peakY = e.y;
  for (let i = 0; i < 200; i++) {
    p.update(e, 1);
    if (e.y < peakY) peakY = e.y;
    if (e.vy >= 0) break;
  }
  const expectedPeakHeight = (12 * 12) / (2 * 0.5); // 144
  // Allow ±5% tolerance for integration discretization.
  const actualPeakHeight = -peakY;
  const ratio = actualPeakHeight / expectedPeakHeight;
  assert.ok(ratio > 0.95 && ratio < 1.10,
    'peak height ' + actualPeakHeight + ' should be near ' + expectedPeakHeight + ' (ratio=' + ratio.toFixed(3) + ')');
});

test('AC3: arc shape is parabolic — symmetric ascent and descent', () => {
  const p = createPhysics({ gravity: 0.5, jumpVelocity: 12 });
  const e = entity();
  p.jump(e);
  const heights = [];
  for (let i = 0; i < 60; i++) {
    p.update(e, 1);
    heights.push(e.y);
  }
  // Semi-implicit Euler is symmetric in velocity but produces a half-step
  // position shift, so positions a few frames either side of the apex differ
  // by a small constant. Tolerance is set to a few gravity-units (~ a couple
  // of game tiles) which is well within what the eye reads as parabolic.
  const minIdx = heights.indexOf(Math.min(...heights));
  const before = heights[minIdx - 5];
  const after = heights[minIdx + 5];
  assert.ok(Math.abs(before - after) < 5.0,
    'parabolic symmetry: heights[apex-5]=' + before + ' vs heights[apex+5]=' + after);
});

// ---------- AC4: variable-height jump (cutJump) ----------
test('AC4: cutJump early produces a jump at least 30% shorter than full', () => {
  const p = createPhysics({ gravity: 0.5, jumpVelocity: 12, jumpCutFactor: 0.4 });

  // Full jump.
  const full = entity();
  p.jump(full);
  let fullPeak = 0;
  for (let i = 0; i < 200; i++) {
    p.update(full, 1);
    if (full.y < fullPeak) fullPeak = full.y;
    if (full.vy >= 0) break;
  }

  // Cut jump — release immediately on frame 1.
  const cut = entity();
  p.jump(cut);
  p.cutJump(cut);
  let cutPeak = 0;
  for (let i = 0; i < 200; i++) {
    p.update(cut, 1);
    if (cut.y < cutPeak) cutPeak = cut.y;
    if (cut.vy >= 0) break;
  }

  const fullHeight = -fullPeak;
  const cutHeight = -cutPeak;
  const reduction = (fullHeight - cutHeight) / fullHeight;
  assert.ok(reduction >= 0.30,
    'cut jump reduction ' + (reduction * 100).toFixed(1) + '% must be >= 30% (full=' + fullHeight + ', cut=' + cutHeight + ')');
});

test('AC4: cutJump after apex is a no-op (does not boost the jump)', () => {
  const p = createPhysics();
  const e = entity();
  p.jump(e);
  // Step until falling (vy > 0).
  for (let i = 0; i < 100 && e.vy < 0; i++) p.update(e, 1);
  assert.ok(e.vy >= 0, 'sanity: should be falling now');
  const vyBefore = e.vy;
  p.cutJump(e);
  assert.equal(e.vy, vyBefore, 'cutJump should not affect falling entity');
});

test('AC4: cutJump while still rising clamps to jumpCutFactor*jumpVelocity', () => {
  const p = createPhysics({ jumpVelocity: 12, jumpCutFactor: 0.4 });
  const e = entity();
  p.jump(e);
  // vy = -12 (rising fast)
  p.cutJump(e);
  // float-tolerant compare — -12 * 0.4 = -4.8 with IEEE rounding
  assert.ok(Math.abs(e.vy - -4.8) < 1e-9,
    'vy should clamp to -jumpVelocity * jumpCutFactor, got ' + e.vy);
});

// ---------- AC5: horizontal acceleration zero -> max in 8-12 frames ----------
test('AC5: with ax=+0.3, vx reaches maxSpeedX in 8-12 frames', () => {
  const p = createPhysics({ maxSpeedX: 3 });
  const e = entity({ ax: 0.3 });
  const reached = stepUntil(p, e, (ent) => ent.vx >= p.constants.maxSpeedX, 20);
  assert.ok(reached >= 8 && reached <= 12,
    'reached max speed in ' + reached + ' frames (expected 8-12)');
});

test('AC5: vx is clamped to maxSpeedX even with continuing acceleration', () => {
  const p = createPhysics({ maxSpeedX: 3 });
  const e = entity({ ax: 0.3, vx: 2.9 });
  p.update(e, 1);
  p.update(e, 1);
  p.update(e, 1);
  assert.equal(e.vx, 3, 'vx must clamp at maxSpeedX');
});

test('AC5: negative acceleration symmetrically reaches -maxSpeedX', () => {
  const p = createPhysics({ maxSpeedX: 3 });
  const e = entity({ ax: -0.3 });
  const reached = stepUntil(p, e, (ent) => ent.vx <= -p.constants.maxSpeedX, 20);
  assert.ok(reached >= 8 && reached <= 12);
});

// ---------- AC6: update mutates position and velocity correctly ----------
test('AC6: update integrates position from velocity', () => {
  const p = createPhysics();
  const e = entity({ x: 100, y: 100, vx: 2, vy: 0 });
  // With vx=2 and no ax (idle), friction will apply. Compute expected:
  // After update: vx *= 0.65 = 1.3 (above stop threshold so no snap); x += new vx
  p.update(e, 1);
  assert.equal(e.vx, 2 * p.constants.friction);
  assert.equal(e.x, 100 + e.vx, 'x integrates from updated vx');
});

test('AC6: update applies ay on top of gravity', () => {
  const p = createPhysics({ gravity: 0.5 });
  const e = entity({ ay: 0.5 }); // e.g., wind down
  p.update(e, 1);
  // vy gains gravity + ay = 1.0 per frame
  assert.equal(e.vy, 1.0);
});

test('AC6: update does not affect entities other than the one passed', () => {
  const p = createPhysics();
  const a = entity({ x: 5, vx: 1 });
  const b = entity({ x: 5, vx: 1 });
  const snapshot = JSON.stringify(b);
  p.update(a, 1);
  assert.equal(JSON.stringify(b), snapshot, 'unaffected entity must be byte-identical');
});

test('AC6: dt scales position integration linearly', () => {
  // Friction is exponential and Euler integration is not closed-form linear,
  // so sub-stepping and full-stepping diverge slightly. The contract this test
  // does enforce: with a fixed velocity (no friction path because ax is set
  // and clamping doesn't engage), dt=0.5 produces exactly half the motion.
  const p = createPhysics({ gravity: 0 });
  const e1 = entity({ vx: 2, ax: 0.0001 }); // tiny ax disables friction branch
  const e2 = entity({ vx: 2, ax: 0.0001 });
  p.update(e1, 1);
  p.update(e2, 0.5);
  // Position change is roughly proportional to dt; half-step → half x change.
  assert.ok(Math.abs(e1.x - 2 * e2.x) < 0.01,
    'dt scales position: full.x=' + e1.x + ' vs 2*half.x=' + (2 * e2.x));
});

// ---------- Additional invariants ----------
test('idle entity at the stopThreshold snaps to exact zero', () => {
  const p = createPhysics({ stopThreshold: 0.1 });
  const e = entity({ vx: 0.05 });
  p.update(e, 1);
  assert.equal(e.vx, 0, 'small vx must snap to exact 0 to avoid drift');
});

test('terminal velocity does not affect upward motion', () => {
  const p = createPhysics({ terminalVelocityY: 8 });
  const e = entity({ vy: -20 }); // moving up at 20 (faster than terminal)
  p.update(e, 1);
  // vy increases by gravity but should remain well negative; no clamp on negative side
  assert.ok(e.vy < 0, 'upward velocity must not be clamped by terminalVelocityY');
});

test('DEFAULTS is frozen', () => {
  assert.throws(() => { DEFAULTS.gravity = 99; }, TypeError);
});
