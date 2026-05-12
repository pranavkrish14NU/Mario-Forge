'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createItems,
  drawPowerup,
  SPRITES_POWERUP,
  DEFAULTS,
  TYPE_POWERUP,
} = require('../src/items.js');
const { createCombat } = require('../src/combat.js');
const { createEnemyPool, TYPE_GROUND } = require('../src/enemy.js');
const { createPlayer, drawPlayer } = require('../src/player.js');

function makePlayer(x, y, opts) {
  return Object.assign({
    x: x, y: y, w: 16, h: 16,
    vx: 0, vy: 0,
    lives: 3, score: 0,
    visible: true,
  }, opts || {});
}

// ---------- AC1: every 3rd mystery block hit releases a power-up ----------

test('AC: 1st and 2nd mystery hits release a coin; 3rd releases a power-up', () => {
  const items = createItems({ mysteryHitInterval: 3 });
  items.spawnMystery(0 * 16, 5 * 16);
  items.spawnMystery(1 * 16, 5 * 16);
  items.spawnMystery(2 * 16, 5 * 16);
  const r1 = items.onCeilingHit({}, { tx: 0, ty: 5 });
  const r2 = items.onCeilingHit({}, { tx: 1, ty: 5 });
  const r3 = items.onCeilingHit({}, { tx: 2, ty: 5 });
  assert.ok(r1.popup && !r1.powerup, '1st = coin popup');
  assert.ok(r2.popup && !r2.powerup, '2nd = coin popup');
  assert.ok(r3.powerup && !r3.popup, '3rd = power-up');
});

test('AC: hit counter is global across mystery blocks (cycle repeats every N hits)', () => {
  const items = createItems({ mysteryHitInterval: 3 });
  for (let i = 0; i < 6; i++) items.spawnMystery(i * 16, 5 * 16);
  const results = [];
  for (let i = 0; i < 6; i++) {
    results.push(items.onCeilingHit({}, { tx: i, ty: 5 }));
  }
  // Cycle: coin, coin, POWERUP, coin, coin, POWERUP
  assert.ok(results[0].popup && results[1].popup && results[2].powerup);
  assert.ok(results[3].popup && results[4].popup && results[5].powerup);
});

test('mystery hit count is observable', () => {
  const items = createItems({});
  items.spawnMystery(0, 0);
  items.spawnMystery(16, 0);
  assert.equal(items._mysteryHitCount(), 0);
  items.onCeilingHit({}, { tx: 0, ty: 0 });
  assert.equal(items._mysteryHitCount(), 1);
  items.onCeilingHit({}, { tx: 1, ty: 0 });
  assert.equal(items._mysteryHitCount(), 2);
});

// ---------- AC2: power-up floats upward before becoming collectible ----------

test('AC: power-up is NOT collectible during the float window', () => {
  const items = createItems({ powerupFloatFrames: 5 });
  const power = items.spawnPowerup(100, 100);
  const player = makePlayer(100, 100);
  // Player overlaps immediately, but the power-up is still floating.
  for (let i = 0; i < 3; i++) items.update({ player });
  assert.equal(power.active, true, 'still active — not yet collectible');
  assert.equal(player.powered, undefined, 'player not powered yet');
});

test('AC: after float window, power-up becomes collectible and rises stops', () => {
  const items = createItems({ powerupFloatFrames: 3 });
  const power = items.spawnPowerup(100, 100);
  // Tick past the float window with no player.
  for (let i = 0; i < 5; i++) items.update({ player: null });
  assert.equal(power.collectable, true);
  assert.equal(power.vy, 0);
});

test('power-up rises during the float window', () => {
  const items = createItems({ powerupFloatFrames: 10 });
  const power = items.spawnPowerup(100, 100);
  const y0 = power.y;
  for (let i = 0; i < 5; i++) items.update({ player: null });
  assert.ok(power.y < y0, 'power-up should rise during float');
});

// ---------- AC3 + AC4: collection grows player to 24×24 (visual + hitbox) ----------

test('AC: collecting a power-up sets player.powered and grows box to 24×24', () => {
  const items = createItems({ powerupFloatFrames: 0 });
  const power = items.spawnPowerup(100, 100);
  const player = makePlayer(100, 100);
  // Bring the power-up to collectible state by ticking once with no player.
  items.update({ player: null });
  assert.equal(power.collectable, true);
  // Now run one update with the player overlapping.
  items.update({ player });
  assert.equal(power.active, false, 'collected');
  assert.equal(player.powered, true);
  assert.equal(player.w, 24);
  assert.equal(player.h, 24);
});

test('AC: applyPowerup raises player.y so feet stay grounded (symmetric to revert)', () => {
  const items = createItems({});
  const player = makePlayer(100, 100);
  const y0 = player.y;
  items.applyPowerup(player);
  assert.equal(player.y, y0 - 8, 'y should rise by 8 so feet remain at original y+h');
  assert.equal(player.w, 24);
});

test('AC: applyPowerup is idempotent (calling twice does not double-grow)', () => {
  const items = createItems({});
  const player = makePlayer(100, 100);
  items.applyPowerup(player);
  const yAfter = player.y;
  items.applyPowerup(player);
  assert.equal(player.y, yAfter);
  assert.equal(player.w, 24);
});

// ---------- AC5: damage while powered reverts (no life loss) ----------

test('AC: taking damage while powered reverts to 16×16 + invincibility but NO life loss', () => {
  const items = createItems({});
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);

  const player = makePlayer(100, 100);
  items.applyPowerup(player);
  assert.equal(player.powered, true);
  assert.equal(player.lives, 3);

  // Stage a side contact (player overlaps enemy from the side, vy = 0).
  player.x = 108; player.y = 200; // bottom would be 224 — but powered box is 24
  // Reset bottom alignment: powered is 24×24 so put player to overlap enemy.
  player.y = 196;
  combat.update({ player, pool, enemies: [enemy], items: items });
  assert.equal(player.lives, 3, 'no life lost when powered (revert instead)');
  assert.equal(player.powered, false, 'reverted to normal');
  assert.equal(player.w, 16);
  assert.ok(combat.isInvincible(), 'invincibility still engaged');
});

test('AC: damage while NOT powered still decrements lives (regression)', () => {
  const items = createItems({});
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const enemy = pool.spawn(TYPE_GROUND, 100, 200);
  const player = makePlayer(108, 200, { lives: 3 });
  combat.update({ player, pool, enemies: [enemy], items: items });
  assert.equal(player.lives, 2);
  assert.equal(player.powered, undefined);
});

// ---------- AC6: powered persists until damage or level end ----------

test('AC: powered state persists across update ticks without damage', () => {
  const items = createItems({});
  const player = makePlayer(100, 100);
  items.applyPowerup(player);
  for (let i = 0; i < 50; i++) items.update({ player });
  assert.equal(player.powered, true);
});

// ---------- AC7: visually distinct sprite when powered ----------

test('AC: drawPlayer emits a different visual when player.powered is true', () => {
  const captureCalls = [];
  function ctxFactory() {
    return {
      fillStyle: '',
      fillRect: function (x, y, w, h) { captureCalls.push({ x, y, w, h, fs: this.fillStyle, mode: this._mode }); },
      _mode: '',
    };
  }
  const normal = ctxFactory();
  normal._mode = 'normal';
  const powered = ctxFactory();
  powered._mode = 'powered';

  const p1 = createPlayer({ x: 0, y: 0 });
  const p2 = createPlayer({ x: 0, y: 0 });
  p2.powered = true;
  drawPlayer(normal, p1);
  drawPlayer(powered, p2);

  const normalCount = captureCalls.filter(c => c.mode === 'normal').length;
  const poweredCount = captureCalls.filter(c => c.mode === 'powered').length;
  // Powered renders more rects (outline + scaled sprite) than the plain 16×16.
  assert.ok(poweredCount > normalCount, 'powered should render more rects (got ' + poweredCount + ' vs ' + normalCount + ')');
});

test('powered sprite draws within a 24×24 envelope', () => {
  const calls = [];
  const ctx = {
    fillStyle: '',
    fillRect: function (x, y, w, h) { calls.push({ x, y, w, h }); },
  };
  const p = createPlayer({ x: 100, y: 100 });
  p.powered = true;
  drawPlayer(ctx, p);
  for (const c of calls) {
    assert.ok(c.x >= 100 && c.x < 100 + 24, 'x within 24-wide envelope: ' + c.x);
    assert.ok(c.y >= 100 && c.y < 100 + 24, 'y within 24-tall envelope: ' + c.y);
  }
});

// ---------- power-up sprite & API ----------

test('SPRITES_POWERUP has at least 1 frame and original design (16×16 = 256 cells)', () => {
  assert.ok(SPRITES_POWERUP.length >= 1);
  assert.equal(SPRITES_POWERUP[0].length, 256);
});

test('drawPowerup signature is (ctx, sx, sy, e) — fits Renderer entities hook', () => {
  assert.equal(drawPowerup.length, 4);
});

test('TYPE_POWERUP is exported', () => {
  assert.equal(typeof TYPE_POWERUP, 'string');
  assert.equal(TYPE_POWERUP, 'powerup');
});

test('powerup pool capacity defaults from DEFAULTS', () => {
  const items = createItems({});
  assert.equal(items.powerupCapacity(), DEFAULTS.powerupCapacity);
});

test('getActive includes active power-ups alongside coins and mystery blocks', () => {
  const items = createItems({});
  items.spawnCoin(0, 0);
  items.spawnMystery(16, 0);
  items.spawnPowerup(32, 0);
  const active = items.getActive();
  const types = active.map(e => e.type);
  assert.ok(types.includes('coin'));
  assert.ok(types.includes('mystery'));
  assert.ok(types.includes('powerup'));
});

test('removePowerup is a no-op when player is not powered', () => {
  const items = createItems({});
  const player = makePlayer(100, 100);
  items.removePowerup(player); // does not throw
  assert.equal(player.w, 16);
  assert.equal(player.h, 16);
});
