'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, createPlayerController, PLAYER_SPRITES } = require('../src/player.js');

// Minimal mock Input that satisfies the polling-API contract.
function mockInput() {
  const held = new Set();
  const just = new Set();
  const justR = new Set();
  return {
    isHeld: (a) => held.has(a),
    justPressed: (a) => just.has(a),
    justReleased: (a) => justR.has(a),
    // test controls
    setHeld(a, on) { if (on) held.add(a); else held.delete(a); },
    setJustPressed(a) { just.add(a); },
    setJustReleased(a) { justR.add(a); },
    clearFrame() { just.clear(); justR.clear(); },
  };
}

test('createPlayer returns required entity properties (AC1)', () => {
  const p = createPlayer();
  ['x', 'y', 'vx', 'vy', 'w', 'h', 'onGround', 'lives', 'score', 'animState', 'facing'].forEach((k) => {
    assert.ok(k in p, 'missing property: ' + k);
  });
  assert.equal(p.lives, 3);
  assert.equal(p.score, 0);
  assert.equal(p.w, 16);
  assert.equal(p.h, 16);
});

test('AC2: pressing right accelerates over multiple frames (not instant max)', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input });
  const p = createPlayer();
  p.onGround = true;
  input.setHeld('moveRight', true);
  ctl.update(p);
  const vxAfter1 = p.vx;
  ctl.update(p);
  const vxAfter2 = p.vx;
  assert.ok(vxAfter1 > 0, 'should be moving right');
  assert.ok(vxAfter1 < ctl.constants.walkMaxSpeed, 'first frame must not be at max speed');
  assert.ok(vxAfter2 > vxAfter1, 'second frame should be faster (accel curve)');
});

test('AC2: left/right sets facing direction', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input });
  const p = createPlayer();
  p.onGround = true;
  input.setHeld('moveLeft', true);
  ctl.update(p);
  assert.equal(p.facing, 'left');
  input.setHeld('moveLeft', false);
  input.setHeld('moveRight', true);
  ctl.update(p);
  assert.equal(p.facing, 'right');
});

test('AC3: jump while onGround initiates a jump', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input });
  const p = createPlayer();
  p.onGround = true;
  input.setJustPressed('jump');
  ctl.update(p);
  assert.ok(p.vy < 0, 'vy should be negative (rising)');
  assert.equal(p.onGround, false);
});

test('AC3: jump while airborne does nothing (without coyote)', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input, options: { coyoteFrames: 0 } });
  const p = createPlayer();
  p.onGround = false;
  input.setJustPressed('jump');
  ctl.update(p);
  // Wait through any jump buffer (none should trigger without coyote either).
  assert.equal(p.vy, 0, 'no jump in mid-air without coyote');
});

test('AC4: coyote time allows jumping within N frames of leaving ground', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input, options: { coyoteFrames: 6 } });
  const p = createPlayer();
  // Frame 0: on ground.
  p.onGround = true;
  ctl.update(p);
  input.clearFrame();
  // Frame 1: stepped off — onGround=false. Within coyote window jump must work.
  p.onGround = false;
  input.setJustPressed('jump');
  ctl.update(p);
  assert.ok(p.vy < 0, 'jump within coyote window must trigger (vy=' + p.vy + ')');
});

test('AC4: coyote window expires after N frames', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input, options: { coyoteFrames: 6 } });
  const p = createPlayer();
  p.onGround = true;
  ctl.update(p);
  // Leave the ground.
  p.onGround = false;
  // Burn through the coyote window.
  for (let i = 0; i < 7; i++) { input.clearFrame(); ctl.update(p); }
  input.setJustPressed('jump');
  ctl.update(p);
  assert.equal(p.vy, 0, 'jump after coyote expired must not trigger');
});

test('AC5: jump buffering — pressing jump shortly before landing still triggers a jump', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input, options: { jumpBufferFrames: 6, coyoteFrames: 6 } });
  const p = createPlayer();
  p.onGround = false;
  // Press jump while still in the air.
  input.setJustPressed('jump');
  ctl.update(p);
  input.clearFrame();
  // 3 frames go by, still airborne.
  for (let i = 0; i < 3; i++) ctl.update(p);
  // Now we land — jump buffer should still be alive and fire.
  p.onGround = true;
  ctl.update(p);
  assert.ok(p.vy < 0, 'buffered jump must trigger on landing (vy=' + p.vy + ')');
});

test('AC6: holding Shift (run) increases max horizontal speed', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input });
  // Walk run.
  const walker = createPlayer(); walker.onGround = true;
  input.setHeld('moveRight', true);
  for (let i = 0; i < 30; i++) ctl.update(walker);
  const walkSpeed = walker.vx;
  // Run run.
  const runner = createPlayer(); runner.onGround = true;
  input.setHeld('run', true);
  for (let i = 0; i < 30; i++) ctl.update(runner);
  const runSpeed = runner.vx;
  assert.ok(runSpeed > walkSpeed * 1.4,
    'run speed (' + runSpeed + ') should be ≥40% faster than walk (' + walkSpeed + ')');
});

test('AC7: PLAYER_SPRITES has idle, run, jump, death with adequate frame counts', () => {
  assert.ok(PLAYER_SPRITES.idle.length >= 1);
  assert.ok(PLAYER_SPRITES.run.length >= 3);
  assert.ok(PLAYER_SPRITES.jump.length >= 1);
  assert.ok(PLAYER_SPRITES.death.length >= 1);
});

test('AC8: sprite data is inline (plain arrays of numbers, no external loading)', () => {
  const idle = PLAYER_SPRITES.idle[0];
  assert.equal(idle.length, 256, 'each frame is 16×16 = 256 indices');
  assert.ok(idle.every((n) => typeof n === 'number'), 'all entries are numbers');
});

test('animation state updates from idle → run → jump as player moves and jumps', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input });
  const p = createPlayer();
  p.onGround = true;
  ctl.update(p);
  assert.equal(p.animState, 'idle');
  input.setHeld('moveRight', true);
  // Push past the 0.5 vx threshold.
  for (let i = 0; i < 5; i++) ctl.update(p);
  assert.equal(p.animState, 'run');
  p.onGround = false;
  ctl.update(p);
  assert.equal(p.animState, 'jump');
});

test('animation frame advances over time', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input, options: { animFrameInterval: 2 } });
  const p = createPlayer();
  p.onGround = true;
  input.setHeld('moveRight', true);
  // Run a few frames so we're in 'run' state.
  for (let i = 0; i < 3; i++) ctl.update(p);
  const frameA = p.animFrame;
  for (let i = 0; i < 4; i++) ctl.update(p);
  const frameB = p.animFrame;
  assert.notEqual(frameA, frameB, 'animation frame should advance');
});

test('cut jump on jump-key-release while rising shortens the jump', () => {
  const input = mockInput();
  const ctl = createPlayerController({ input });
  const p = createPlayer();
  p.onGround = true;
  input.setJustPressed('jump');
  ctl.update(p);
  const fullVy = p.vy;
  input.clearFrame();
  // Release the jump key while still rising.
  input.setJustReleased('jump');
  ctl.update(p);
  assert.ok(p.vy > fullVy, 'vy should be reduced (less negative) after cut');
});

test('createPlayerController requires input', () => {
  assert.throws(() => createPlayerController({}), TypeError);
  assert.throws(() => createPlayerController(null), TypeError);
});
