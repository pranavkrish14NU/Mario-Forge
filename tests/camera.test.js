'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCamera, DEFAULTS } = require('../src/camera.js');

// Default test rig: 256×240 logical viewport (matches PRD FR-2), with a
// generous level so we have room on every side to exercise edges.
const VIEWPORT = { width: 256, height: 240 };
const LEVEL = { pixelWidth: 1024, pixelHeight: 960 };

function makeCamera(overrides) {
  return createCamera(Object.assign({
    viewport: VIEWPORT,
    level: LEVEL,
  }, overrides || {}));
}

// Player-shaped target centred in the viewport given a camera position.
function centeredTarget(cam, opts) {
  const off = cam.getOffset();
  const w = (opts && opts.w) || 16;
  const h = (opts && opts.h) || 16;
  return Object.assign({
    x: off.x + VIEWPORT.width / 2 - w / 2,
    y: off.y + VIEWPORT.height / 2 - h / 2,
    width: w,
    height: h,
    onGround: false,
  }, opts || {});
}

// ---------- factory & validation ----------

test('createCamera returns the public API', () => {
  const cam = makeCamera();
  assert.equal(typeof cam.update, 'function');
  assert.equal(typeof cam.snapTo, 'function');
  assert.equal(typeof cam.getOffset, 'function');
  assert.equal(typeof cam.getParallaxOffset, 'function');
  assert.equal(typeof cam.getDeadZone, 'function');
  assert.equal(typeof cam.setLevelSize, 'function');
  assert.equal(typeof cam.setViewport, 'function');
});

test('createCamera throws without viewport', () => {
  assert.throws(() => createCamera({ level: LEVEL }), TypeError);
  assert.throws(() => createCamera({ viewport: {}, level: LEVEL }), TypeError);
});

test('createCamera throws without level', () => {
  assert.throws(() => createCamera({ viewport: VIEWPORT }), TypeError);
  assert.throws(() => createCamera({ viewport: VIEWPORT, level: { pixelWidth: 100 } }), TypeError);
});

test('createCamera rejects out-of-range dead-zone factors', () => {
  assert.throws(() => makeCamera({ deadZoneWidthFactor: 0 }), RangeError);
  assert.throws(() => makeCamera({ deadZoneWidthFactor: 1 }), RangeError);
  assert.throws(() => makeCamera({ deadZoneHeightFactor: -0.1 }), RangeError);
  assert.throws(() => makeCamera({ deadZoneHeightFactor: 1.5 }), RangeError);
});

test('createCamera rejects out-of-range lerp', () => {
  assert.throws(() => makeCamera({ lerp: 0 }), RangeError);
  assert.throws(() => makeCamera({ lerp: 1.1 }), RangeError);
});

test('constants are frozen so tuning cannot be mutated at runtime', () => {
  const cam = makeCamera();
  assert.throws(() => { cam.constants.lerp = 0.5; }, TypeError);
});

test('DEFAULTS match the dead-zone proportions specified in AC1 (40% × 30%)', () => {
  assert.equal(DEFAULTS.deadZoneWidthFactor, 0.4);
  assert.equal(DEFAULTS.deadZoneHeightFactor, 0.3);
});

test('update throws when target is missing or malformed', () => {
  const cam = makeCamera();
  assert.throws(() => cam.update(null), TypeError);
  assert.throws(() => cam.update({}), TypeError);
  assert.throws(() => cam.update({ x: 0 }), TypeError);
});

// ---------- AC1: dead zone (no motion when target is inside) ----------

test('AC1: target sitting at viewport centre triggers no camera motion', () => {
  const cam = makeCamera();
  const before = cam.getOffset();
  const target = centeredTarget(cam, { onGround: true });
  cam.update(target);
  const after = cam.getOffset();
  assert.equal(after.x, before.x, 'x must not change');
  assert.equal(after.y, before.y, 'y must not change');
});

test('AC1: target anywhere inside the dead zone produces no motion over many frames', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const before = cam.getOffset();
  const dz = cam.getDeadZone();
  // Target placed near the dead-zone interior (not touching edges).
  const target = {
    x: dz.left + 4,
    y: dz.top + 4,
    width: 8,
    height: 8,
    onGround: true,
  };
  for (let i = 0; i < 30; i++) cam.update(target);
  const after = cam.getOffset();
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
});

test('AC1: dead-zone dimensions match configured factors', () => {
  const cam = makeCamera();
  const dz = cam.getDeadZone();
  assert.equal(dz.width, VIEWPORT.width * DEFAULTS.deadZoneWidthFactor);
  assert.equal(dz.height, VIEWPORT.height * DEFAULTS.deadZoneHeightFactor);
});

// ---------- AC2: smooth lerp toward target when pushing dead-zone edges ----------

test('AC2: pushing right of the dead zone moves the camera right (less than full delta — lerped)', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const before = cam.getOffset();
  const dz = cam.getDeadZone();
  const shift = 40;
  // Place target so it overshoots the right dead-zone edge by `shift` px.
  const target = {
    x: dz.right - 16 + shift,
    y: dz.top + 10,
    width: 16,
    height: 16,
    onGround: true,
  };
  cam.update(target);
  const after = cam.getOffset();
  assert.ok(after.x > before.x, 'camera should move right');
  // First-frame lerp = 0.15 — should cover roughly that fraction of the shift.
  assert.ok(after.x - before.x < shift, 'must not snap to full delta');
  const expected = shift * DEFAULTS.lerp;
  assert.ok(Math.abs((after.x - before.x) - expected) < 0.5,
    'first-frame motion ~= shift * lerp (got ' + (after.x - before.x).toFixed(2) + ', want ~' + expected + ')');
});

test('AC2: repeated updates converge toward the dead-zone alignment', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const dz0 = cam.getDeadZone();
  const target = {
    x: dz0.right + 30,
    y: dz0.top + 10,
    width: 16,
    height: 16,
    onGround: true,
  };
  let lastDelta = Infinity;
  let prevX = cam.getOffset().x;
  // After enough frames the camera should settle (delta < epsilon).
  for (let i = 0; i < 200; i++) {
    cam.update(target);
    const x = cam.getOffset().x;
    const delta = Math.abs(x - prevX);
    if (i > 0) {
      // Motion magnitude must be monotonically non-increasing in early frames
      // (geometric decay), confirming the lerp is doing the smoothing.
      if (i < 10) assert.ok(delta <= lastDelta + 0.001, 'delta should not grow: ' + delta + ' vs ' + lastDelta);
    }
    lastDelta = delta;
    prevX = x;
  }
  // After 200 frames the target should sit at the right dead-zone edge.
  const dz = cam.getDeadZone();
  assert.ok(Math.abs(dz.right - (target.x + target.width)) < 0.5,
    'target right edge should converge to dead-zone right edge');
});

test('AC2: pushing left of the dead zone moves the camera left', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const before = cam.getOffset();
  const dz = cam.getDeadZone();
  const target = {
    x: dz.left - 40,
    y: dz.top + 10,
    width: 16,
    height: 16,
    onGround: true,
  };
  cam.update(target);
  assert.ok(cam.getOffset().x < before.x, 'camera should move left');
});

// ---------- AC3: level-boundary clamping at all four edges ----------

test('AC3: camera clamps at left edge (x >= 0)', () => {
  const cam = makeCamera();
  // Force a strong leftward target near the level origin.
  const target = { x: 0, y: 100, width: 16, height: 16, onGround: true };
  for (let i = 0; i < 100; i++) cam.update(target);
  assert.equal(cam.getOffset().x, 0);
});

test('AC3: camera clamps at right edge (x <= level.width - viewport.width)', () => {
  const cam = makeCamera();
  const maxX = LEVEL.pixelWidth - VIEWPORT.width;
  const target = { x: LEVEL.pixelWidth - 16, y: 100, width: 16, height: 16, onGround: true };
  for (let i = 0; i < 100; i++) cam.update(target);
  assert.equal(cam.getOffset().x, maxX);
});

test('AC3: camera clamps at top edge (y >= 0)', () => {
  const cam = makeCamera();
  const target = { x: 500, y: 0, width: 16, height: 16, onGround: true };
  for (let i = 0; i < 100; i++) cam.update(target);
  assert.equal(cam.getOffset().y, 0);
});

test('AC3: camera clamps at bottom edge (y <= level.height - viewport.height)', () => {
  const cam = makeCamera();
  const maxY = LEVEL.pixelHeight - VIEWPORT.height;
  const target = { x: 500, y: LEVEL.pixelHeight - 16, width: 16, height: 16, onGround: true };
  for (let i = 0; i < 100; i++) cam.update(target);
  assert.equal(cam.getOffset().y, maxY);
});

test('AC3: level smaller than the viewport locks camera to origin on that axis', () => {
  const tiny = createCamera({
    viewport: { width: 256, height: 240 },
    level: { pixelWidth: 100, pixelHeight: 100 },
  });
  tiny.update({ x: 50, y: 50, width: 16, height: 16, onGround: true });
  const off = tiny.getOffset();
  assert.equal(off.x, 0);
  assert.equal(off.y, 0);
});

// ---------- AC4: vertical engages on ground OR below panic line ----------

test('AC4: mid-air target above the panic line does not move the camera vertically', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const before = cam.getOffset();
  const dz = cam.getDeadZone();
  // Place target above the dead zone (jumping high). NOT onGround, NOT panic.
  const target = {
    x: dz.left + 10,
    y: dz.top - 80, // well above dead-zone top
    width: 16,
    height: 16,
    onGround: false,
  };
  cam.update(target);
  // Above dead zone but not below panic ⇒ no vertical motion.
  assert.equal(cam.getOffset().y, before.y, 'camera Y must not move during a jump');
});

test('AC4: grounded target above the dead zone moves the camera up', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const before = cam.getOffset();
  const dz = cam.getDeadZone();
  const target = {
    x: dz.left + 10,
    y: dz.top - 80,
    width: 16,
    height: 16,
    onGround: true, // grounded engages vertical tracking
  };
  cam.update(target);
  assert.ok(cam.getOffset().y < before.y, 'camera Y must move up when grounded above DZ');
});

test('AC4: airborne target falling below the panic line engages vertical tracking', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const before = cam.getOffset();
  const dz = cam.getDeadZone();
  // Target has fallen well below the dead-zone bottom but is still in air.
  const target = {
    x: dz.left + 10,
    y: dz.bottom + 80,
    width: 16,
    height: 16,
    onGround: false,
  };
  cam.update(target);
  assert.ok(cam.getOffset().y > before.y, 'camera Y must move down when below panic line');
});

test('AC4: airborne target within dead zone (no panic) leaves camera Y untouched', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const before = cam.getOffset();
  const dz = cam.getDeadZone();
  const target = {
    x: dz.left + 10,
    y: dz.top + 10,
    width: 16,
    height: 16,
    onGround: false,
  };
  cam.update(target);
  assert.equal(cam.getOffset().y, before.y);
});

// ---------- AC5: getOffset shape ----------

test('AC5: getOffset returns {x, y} numbers usable as render translation', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const off = cam.getOffset();
  assert.equal(typeof off.x, 'number');
  assert.equal(typeof off.y, 'number');
  // Convention: screen = world - offset. After snapTo the player's centre
  // lands at the viewport centre — so a 16-wide player has its left edge
  // 8px to the left of viewport mid.
  const playerScreenX = 500 - off.x;
  assert.equal(playerScreenX, VIEWPORT.width / 2 - 8);
});

// ---------- AC6: parallax offset ----------

test('AC6: getParallaxOffset(1) equals getOffset (foreground layer)', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const off = cam.getOffset();
  const par = cam.getParallaxOffset(1);
  assert.equal(par.x, off.x);
  assert.equal(par.y, off.y);
});

test('AC6: getParallaxOffset(0.5) returns half offset (mid background layer)', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const off = cam.getOffset();
  const par = cam.getParallaxOffset(0.5);
  assert.equal(par.x, off.x * 0.5);
  assert.equal(par.y, off.y * 0.5);
});

test('AC6: getParallaxOffset(0) returns zero (sky locks to screen)', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const par = cam.getParallaxOffset(0);
  assert.equal(par.x, 0);
  assert.equal(par.y, 0);
});

test('AC6: getParallaxOffset defaults factor to 1 when omitted', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const off = cam.getOffset();
  const par = cam.getParallaxOffset();
  assert.equal(par.x, off.x);
  assert.equal(par.y, off.y);
});

// ---------- supporting API ----------

test('snapTo centres the camera on the target instantly', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const off = cam.getOffset();
  // Player midpoint (508, 408) should land at viewport midpoint (128, 120).
  assert.equal(508 - off.x, VIEWPORT.width / 2);
  assert.equal(408 - off.y, VIEWPORT.height / 2);
});

test('snapTo respects level boundaries (no negative offsets)', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 0, y: 0, width: 16, height: 16 });
  const off = cam.getOffset();
  assert.equal(off.x, 0);
  assert.equal(off.y, 0);
});

test('snapTo respects right/bottom boundaries', () => {
  const cam = makeCamera();
  cam.snapTo({
    x: LEVEL.pixelWidth - 16,
    y: LEVEL.pixelHeight - 16,
    width: 16, height: 16,
  });
  const off = cam.getOffset();
  assert.equal(off.x, LEVEL.pixelWidth - VIEWPORT.width);
  assert.equal(off.y, LEVEL.pixelHeight - VIEWPORT.height);
});

test('setLevelSize re-clamps when level shrinks below current camera', () => {
  const cam = makeCamera();
  cam.snapTo({ x: 900, y: 800, width: 16, height: 16 });
  const before = cam.getOffset();
  assert.ok(before.x > 0);
  cam.setLevelSize({ pixelWidth: 256, pixelHeight: 240 });
  const after = cam.getOffset();
  // Level now equal to viewport — camera should clamp to origin.
  assert.equal(after.x, 0);
  assert.equal(after.y, 0);
});

test('setViewport re-clamps and re-sizes the dead zone', () => {
  const cam = makeCamera();
  cam.setViewport({ width: 512, height: 480 });
  const dz = cam.getDeadZone();
  assert.equal(dz.width, 512 * DEFAULTS.deadZoneWidthFactor);
  assert.equal(dz.height, 480 * DEFAULTS.deadZoneHeightFactor);
});

test('initial position option places the camera before any updates', () => {
  const cam = createCamera({
    viewport: VIEWPORT,
    level: LEVEL,
    initial: { x: 300, y: 200 },
  });
  const off = cam.getOffset();
  assert.equal(off.x, 300);
  assert.equal(off.y, 200);
});

test('snapEpsilon snaps to target once residual is tiny', () => {
  const cam = makeCamera({ lerp: 0.5, snapEpsilon: 0.5 });
  cam.snapTo({ x: 500, y: 400, width: 16, height: 16 });
  const dz = cam.getDeadZone();
  const target = {
    x: dz.right + 10,
    y: dz.top + 10,
    width: 16, height: 16,
    onGround: true,
  };
  // A handful of updates with snapEpsilon=0.5 should settle exactly.
  for (let i = 0; i < 12; i++) cam.update(target);
  const off = cam.getOffset();
  const dzAfter = cam.getDeadZone();
  // After settling, target right edge aligns exactly with dead-zone right edge.
  assert.equal(target.x + target.width, dzAfter.right);
  // No residual fractional drift in offset.
  assert.equal(off.x, Math.round(off.x * 100) / 100);
});
