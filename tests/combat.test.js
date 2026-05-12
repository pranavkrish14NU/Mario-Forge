'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCombat, DEFAULTS } = require('../src/combat.js');
const { createEnemyPool, TYPE_GROUND, TYPE_FLYING } = require('../src/enemy.js');

function makePlayer(x, y, opts) {
  return Object.assign({
    x: x, y: y, w: 16, h: 16,
    vx: 0, vy: 0,
    lives: 3, score: 0,
    visible: true,
  }, opts || {});
}

function mockStateManager() {
  const sm = {
    scenes: [],
    changeScene: function (name) { sm.scenes.push(name); },
    getCurrentSceneName: function () { return sm.scenes[sm.scenes.length - 1] || null; },
  };
  return sm;
}

// ---------- factory ----------

test('createCombat exposes the public API', () => {
  const combat = createCombat({});
  assert.equal(typeof combat.update, 'function');
  assert.equal(typeof combat.reset, 'function');
  assert.equal(typeof combat.isInvincible, 'function');
  assert.equal(typeof combat.detectStomp, 'function');
});

test('constants frozen', () => {
  const combat = createCombat({});
  assert.throws(() => { combat.constants.stompScore = 0; }, TypeError);
});

test('DEFAULTS: 25% top-fraction, 200 stomp score, 120 invincibility frames', () => {
  assert.equal(DEFAULTS.stompTopFraction, 0.25);
  assert.equal(DEFAULTS.stompScore, 200);
  assert.equal(DEFAULTS.invincibilityFrames, 120);
});

// ---------- AC1 + AC7: stomp detects, defeats, bounces, +200 score ----------

test('AC: stomp (vy>0, top-25% contact) defeats enemy and gives upward bounce', () => {
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  // Player overlaps the top of the enemy and is falling.
  const player = makePlayer(100, 200 - 14, { vy: 4, score: 0, lives: 3 });
  const combat = createCombat({});
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, true, 'enemy should be defeated');
  assert.ok(player.vy < 0, 'player should bounce upward');
  assert.equal(player.score, 200, 'AC: +200 score per stomp');
  assert.equal(player.lives, 3, 'no damage on stomp');
});

test('AC: side contact (player walking into enemy horizontally) does NOT stomp — it damages', () => {
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  // Player overlaps enemy from the side: player.y nearly equals enemy.y; vy=0.
  const player = makePlayer(108, 200, { vy: 0, lives: 3 });
  const combat = createCombat({});
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, undefined, 'enemy not defeated (no stomp from side)');
  assert.equal(player.lives, 2, 'AC: 1 life lost');
  assert.ok(combat.isInvincible(), 'invincibility engaged');
});

test('AC: bottom contact (player rising into enemy from below) damages, not stomps', () => {
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  // Player below the enemy, moving up (vy < 0).
  const player = makePlayer(100, 210, { vy: -5, lives: 3 });
  const combat = createCombat({});
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, undefined);
  assert.equal(player.lives, 2);
});

test('AC: stomp detection — falling player NOT in top 25% damages instead', () => {
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  // Player overlapping enemy but bottom is at 220 (middle of enemy, not top 25%).
  const player = makePlayer(100, 220 - 16, { vy: 4, lives: 3 });
  // playerBottom = 220, stompBandBottom = 200 + 16*0.25 = 204 → not a stomp.
  const combat = createCombat({});
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, undefined, 'too deep → no stomp');
  assert.equal(player.lives, 2);
});

// ---------- AC2 + AC3: invincibility frames + flashing ----------

test('AC: damage triggers ~2s (120-frame) invincibility', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  assert.ok(combat.isInvincible());
  // Run forward 119 frames — still invincible.
  for (let i = 0; i < 119; i++) combat.update({ player, pool, enemies: [] });
  assert.ok(combat.isInvincible(), 'still invincible after 119 more frames');
  // One more — done.
  combat.update({ player, pool, enemies: [] });
  assert.equal(combat.isInvincible(), false);
});

test('AC: during invincibility, repeat contact does NOT subtract another life', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 3 });
  // Frame 1: damage.
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(player.lives, 2);
  // Frame 2-30: repeated overlap, no extra damage.
  for (let i = 0; i < 30; i++) {
    combat.update({ player, pool, enemies: [enemy] });
  }
  assert.equal(player.lives, 2);
});

test('AC: player.visible flickers every 4 frames during invincibility', () => {
  const combat = createCombat({ flashInterval: 4 });
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  // Tick a sequence of frames and observe visibility toggles.
  const visibility = [];
  for (let i = 0; i < 16; i++) {
    combat.update({ player, pool, enemies: [] });
    visibility.push(player.visible);
  }
  // Group into windows of 4 — within each window visibility should be constant.
  const groups = [];
  for (let i = 0; i < 4; i++) {
    const window = visibility.slice(i * 4, i * 4 + 4);
    assert.ok(window.every(v => v === window[0]), 'visibility constant within 4-frame window: ' + JSON.stringify(window));
    groups.push(window[0]);
  }
  // Adjacent windows differ — verifies the toggle is actually happening.
  for (let i = 1; i < groups.length; i++) {
    assert.notEqual(groups[i], groups[i - 1], 'adjacent 4-frame windows alternate');
  }
});

test('player.visible resets to true after invincibility ends', () => {
  const combat = createCombat({ invincibilityFrames: 5 });
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  for (let i = 0; i < 6; i++) combat.update({ player, pool, enemies: [] });
  assert.equal(player.visible, true);
});

// ---------- AC4: squish animation before despawn ----------

test('AC: defeated enemy plays squish anim for squishDurationFrames then despawns', () => {
  const combat = createCombat({ squishDurationFrames: 5 });
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(100, 200 - 14, { vy: 4, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, true);
  assert.ok(enemy.active, 'still in pool during squish');
  // Tick squish window.
  for (let i = 0; i < 5; i++) combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.active, false, 'enemy despawned after squish');
});

test('squished enemy has its draw fn replaced and h halved (vertical squash)', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const originalDraw = enemy.draw;
  const player = makePlayer(100, 200 - 14, { vy: 4 });
  combat.update({ player, pool, enemies: [enemy] });
  assert.notEqual(enemy.draw, originalDraw, 'draw fn swapped');
  assert.ok(enemy.h <= 8 + 1, 'enemy height halved (~8)');
});

test('Enemy.update skips defeated enemies (they do not patrol)', () => {
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200, { facing: 'right', walkSpeed: 2 });
  enemy.defeated = true;
  const x0 = enemy.x;
  pool.update({});
  assert.equal(enemy.x, x0, 'defeated enemy must not advance');
});

// ---------- AC5: game-over scene transition on lives = 0 ----------

test('AC: lives reaching 0 calls stateManager.changeScene("gameOver")', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 1 });
  const sm = mockStateManager();
  combat.update({ player, pool, enemies: [enemy], stateManager: sm });
  assert.equal(player.lives, 0);
  assert.deepEqual(sm.scenes, ['gameOver']);
});

test('AC: gameOver transition fires only once even with repeated damage attempts', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 1 });
  const sm = mockStateManager();
  combat.update({ player, pool, enemies: [enemy], stateManager: sm });
  for (let i = 0; i < 10; i++) {
    combat.update({ player, pool, enemies: [enemy], stateManager: sm });
  }
  assert.equal(sm.scenes.length, 1, 'gameOver fires exactly once');
});

test('changeScene failures (e.g., gameOver scene unregistered) do not crash', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 1 });
  const sm = { changeScene: function () { throw new Error('not registered'); } };
  combat.update({ player, pool, enemies: [enemy], stateManager: sm });
  assert.equal(player.lives, 0);
});

// ---------- AC6: stomp vs side disambiguation in corner cases ----------

test('AC: barely-overlapping side contact while falling — bottom outside top band → damage', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  // Player is alongside the enemy with bottom at y=210 (well below top band 204).
  const player = makePlayer(110, 194, { vy: 2, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, undefined);
  assert.equal(player.lives, 2);
});

test('AC: precise top-band contact with downward velocity is a stomp', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  // Player bottom = 201 (1px penetration into top of enemy), vy > 0.
  // Stomp band is enemy.y .. enemy.y + h*0.25 = 200..204, so 201 ⇒ stomp.
  const player = makePlayer(100, 185, { vy: 5, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, true);
});

test('no overlap = no event', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 500, 500);
  const player = makePlayer(0, 0, { vy: 5, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  assert.equal(enemy.defeated, undefined);
  assert.equal(player.lives, 3);
});

// ---------- reset & no-player ----------

test('reset() clears invincibility + gameOverFired', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { vy: 0, lives: 3 });
  combat.update({ player, pool, enemies: [enemy] });
  assert.ok(combat.isInvincible());
  combat.reset();
  assert.equal(combat.isInvincible(), false);
});

test('update() with no player is a no-op (no throw)', () => {
  const combat = createCombat({});
  combat.update({}); // does not throw
});

// ---------- onStomp / onDamage hooks ----------

test('onStomp and onDamage hooks are fired with the right entities', () => {
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const e1 = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(100, 200 - 14, { vy: 4 });
  let stompFired = null;
  combat.update({
    player, pool, enemies: [e1],
    hooks: { onStomp: (p, en) => { stompFired = { p, en }; } },
  });
  assert.ok(stompFired);
  assert.equal(stompFired.p, player);
  assert.equal(stompFired.en, e1);

  // Damage hook.
  const e2 = pool.spawn(TYPE_GROUND, 200, 200);
  const player2 = makePlayer(208, 200, { vy: 0, lives: 3 });
  let damageFired = null;
  combat.update({
    player: player2, pool, enemies: [e2],
    hooks: { onDamage: (p) => { damageFired = p; } },
  });
  assert.equal(damageFired, player2);
});
