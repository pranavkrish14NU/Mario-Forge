'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHazards,
  drawPlatform,
  DEFAULTS,
  SPIKE_CHAR,
  HORIZONTAL_CHAR,
  VERTICAL_CHAR,
} = require('../src/hazards.js');
const { createTilemap } = require('../src/tilemap.js');
const { createCombat } = require('../src/combat.js');
const { createItems } = require('../src/items.js');
const { createEnemyPool } = require('../src/enemy.js');

function makePlayer(x, y, opts) {
  return Object.assign({
    x: x, y: y, w: 16, h: 16,
    vx: 0, vy: 0,
    lives: 3, score: 0,
    visible: true,
  }, opts || {});
}

function mapWithSpike(tx, ty) {
  const rows = [];
  for (let y = 0; y < 10; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) r += '.';
    rows.push(r);
  }
  const row = rows[ty].split('');
  row[tx] = 's';
  rows[ty] = row.join('');
  return rows;
}

// ---------- factory ----------

test('createHazards exposes the public API', () => {
  const h = createHazards({});
  assert.equal(typeof h.spawnPlatform, 'function');
  assert.equal(typeof h.update, 'function');
  assert.equal(typeof h.spikeContact, 'function');
  assert.equal(typeof h.pitFall, 'function');
  assert.equal(typeof h.getActive, 'function');
  assert.equal(typeof h.activePlatformCount, 'function');
});

test('constants frozen, defaults reasonable', () => {
  const h = createHazards({});
  assert.throws(() => { h.constants.platformSpeed = 99; }, TypeError);
  assert.equal(DEFAULTS.platformCapacity, 8);
});

// ---------- AC1: spike contact damages from any direction ----------

test('AC: player AABB overlapping a spike tile is detected', () => {
  const tm = createTilemap({ tileSize: 16, map: mapWithSpike(5, 3) });
  const h = createHazards({});
  // Player overlapping the spike tile at (5, 3) → world (80, 48).
  const player = makePlayer(80, 48);
  assert.equal(h.spikeContact(player, tm), true);
});

test('AC: spike contact reports false when player is elsewhere', () => {
  const tm = createTilemap({ tileSize: 16, map: mapWithSpike(5, 3) });
  const h = createHazards({});
  const player = makePlayer(200, 200);
  assert.equal(h.spikeContact(player, tm), false);
});

test('AC: spike contact triggers combat damage (1 life lost)', () => {
  const tm = createTilemap({ tileSize: 16, map: mapWithSpike(5, 3) });
  const h = createHazards({});
  const items = createItems({});
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const player = makePlayer(80, 48, { lives: 3 });
  combat.update({
    player, pool, enemies: [],
    hazards: h, tilemap: tm, items: items,
  });
  assert.equal(player.lives, 2);
  assert.ok(combat.isInvincible());
});

test('AC: spike damage is consumed by powered state (no life loss when powered)', () => {
  const tm = createTilemap({ tileSize: 16, map: mapWithSpike(5, 3) });
  const h = createHazards({});
  const items = createItems({});
  const combat = createCombat({});
  const pool = createEnemyPool({});
  const player = makePlayer(80, 48, { lives: 3 });
  items.applyPowerup(player);
  // Player y shifted up by 8 — adjust so it still overlaps the spike.
  player.y = 48;
  combat.update({
    player, pool, enemies: [],
    hazards: h, tilemap: tm, items: items,
  });
  assert.equal(player.lives, 3);
  assert.equal(player.powered, false);
});

test('spike contact direction-agnostic: any overlap works (top, side, bottom)', () => {
  const tm = createTilemap({ tileSize: 16, map: mapWithSpike(5, 3) });
  const h = createHazards({});
  // 3 player positions, each grazing the spike tile differently.
  const positions = [
    { x: 80, y: 32, label: 'from above' },      // bottom row of player just enters spike top
    { x: 96, y: 48, label: 'from the side' },   // left edge of player at spike right
    { x: 80, y: 64, label: 'from below' },      // top of player at spike bottom
  ];
  // All three should overlap the 16×16 spike tile at world (80..96, 48..64).
  for (const p of positions) {
    const player = makePlayer(p.x, p.y - 1, { w: 16, h: 16 });
    if (p.label === 'from above') player.y = 48 - 15; // bottom = 49, just in
    if (p.label === 'from below') player.y = 49;
    if (p.label === 'from the side') player.x = 96 - 1; // right edge of player = 111, overlaps
    assert.equal(h.spikeContact(player, tm), true, p.label + ' should detect spike');
  }
});

// ---------- AC2: pit-fall death ----------

test('AC: pitFall returns true when player y exceeds level.pixelHeight', () => {
  const h = createHazards({});
  const player = makePlayer(100, 500);
  assert.equal(h.pitFall(player, { pixelHeight: 400 }), true);
});

test('AC: pitFall returns false inside the level bounds', () => {
  const h = createHazards({});
  const player = makePlayer(100, 100);
  assert.equal(h.pitFall(player, { pixelHeight: 400 }), false);
});

test('AC: pit-fall through combat decrements lives and invokes respawn', () => {
  const h = createHazards({});
  const combat = createCombat({});
  const items = createItems({});
  const pool = createEnemyPool({});
  const tm = createTilemap({ tileSize: 16, map: ['..............','##############'] });
  let respawned = false;
  const player = makePlayer(100, 500, { lives: 3 });
  combat.update({
    player, pool, enemies: [],
    hazards: h, items: items, tilemap: tm,
    level: { pixelHeight: 400 },
    respawn: function (p) { respawned = true; p.x = 32; p.y = 100; },
  });
  assert.equal(player.lives, 2);
  assert.ok(respawned, 'respawn callback should fire');
  assert.equal(player.x, 32);
  assert.equal(player.y, 100);
});

test('AC: pit-fall is NOT absorbed by powered state (instant death — AC2)', () => {
  const h = createHazards({});
  const combat = createCombat({});
  const items = createItems({});
  const pool = createEnemyPool({});
  const player = makePlayer(100, 500, { lives: 3 });
  items.applyPowerup(player);
  player.y = 500; // Force pit-fall y again (powerup shifted y).
  combat.update({
    player, pool, enemies: [],
    hazards: h, items: items,
    level: { pixelHeight: 400 },
    respawn: function () {},
  });
  // Spec: pit fall removes powerup AND drops a life (it's instant death).
  assert.equal(player.lives, 2);
  assert.equal(player.powered, false);
});

// ---------- AC3: moving platforms follow a path ----------

test('AC: horizontal platform travels along x and reverses at +range', () => {
  const h = createHazards({});
  const p = h.spawnPlatform(HORIZONTAL_CHAR, 100, 100, { range: 20, speed: 5 });
  const x0 = p.x;
  // Move enough frames to reach the right endpoint and reverse.
  let reversed = false;
  for (let i = 0; i < 20; i++) {
    h.updatePlatforms();
    if (p.direction < 0) { reversed = true; break; }
  }
  assert.ok(reversed, 'should reverse at +range');
  assert.equal(p.x, x0 + 20);
});

test('AC: vertical platform travels along y and reverses at -range', () => {
  const h = createHazards({});
  const p = h.spawnPlatform(VERTICAL_CHAR, 100, 100, { range: 16, speed: 2, direction: -1 });
  for (let i = 0; i < 20; i++) {
    h.updatePlatforms();
    if (p.direction > 0) break;
  }
  assert.equal(p.direction, 1);
  assert.equal(p.y, 100 - 16);
});

test('AC: platform travels at constant speed (frame delta == speed when not reversing)', () => {
  const h = createHazards({});
  const p = h.spawnPlatform(HORIZONTAL_CHAR, 100, 100, { range: 100, speed: 1 });
  h.updatePlatforms();
  assert.equal(Math.abs(p.lastDx), 1);
});

// ---------- AC4 + AC5: platform solid + player-carry ----------

test('AC: standing on a horizontal platform carries the player along with it', () => {
  const h = createHazards({});
  const platform = h.spawnPlatform(HORIZONTAL_CHAR, 100, 200, { range: 50, speed: 2 });
  const player = makePlayer(100, 184, { vy: 1 });
  // Step: move platform first, then resolve player landing + carry.
  h.update({ player });
  assert.equal(player.onGround, true);
  assert.equal(player.y + player.h, platform.y, 'player feet should sit exactly on platform top');
  // Next frame the platform moves +2 right; the player should follow.
  const xBefore = player.x;
  h.update({ player });
  assert.ok(player.x > xBefore, 'player should be carried along by platform');
});

test('AC: vertical platform carries player up/down', () => {
  const h = createHazards({});
  const platform = h.spawnPlatform(VERTICAL_CHAR, 100, 200, { range: 32, speed: 1 });
  const player = makePlayer(100, 184, { vy: 1 });
  h.update({ player });
  assert.equal(player.onGround, true);
  const yLanding = player.y;
  // One more frame — platform moves down by speed, player should follow.
  h.update({ player });
  assert.notEqual(player.y, yLanding);
});

test('AC: platform is solid landing (player.vy zeroes on landing)', () => {
  const h = createHazards({});
  h.spawnPlatform(HORIZONTAL_CHAR, 100, 200);
  const player = makePlayer(100, 190, { vy: 5 });
  h.update({ player });
  assert.equal(player.vy, 0);
  assert.equal(player.onGround, true);
});

test('player NOT on top of platform (horizontally off) is not carried', () => {
  const h = createHazards({});
  h.spawnPlatform(HORIZONTAL_CHAR, 100, 200, { range: 50, speed: 2 });
  const player = makePlayer(500, 184, { vy: 1 });
  const x0 = player.x;
  h.update({ player });
  assert.equal(player.x, x0, 'distant player should not move with platform');
});

// ---------- AC6: at least 2 moving platforms in the map data ----------

test('AC: parseSpawnsFromTilemap returns h/v entries for moving platforms', () => {
  const tm = createTilemap({ tileSize: 16, map: [
    '..h.............',
    '................',
    '..............v.',
    '................',
  ]});
  const h = createHazards({});
  const list = h.parseSpawnsFromTilemap(tm);
  assert.equal(list.length, 2);
  const types = list.map(s => s.pathType).sort();
  assert.deepEqual(types, ['h', 'v']);
});

test('AC: spawnAllFromTilemap activates platform pool entries', () => {
  const tm = createTilemap({ tileSize: 16, map: ['h.h.h.h.'] });
  const h = createHazards({});
  const list = h.spawnAllFromTilemap(tm);
  assert.equal(list.length, 4);
  assert.equal(h.activePlatformCount(), 4);
});

// ---------- AC7: spike sprite distinct (rendered via Renderer's drawTile) ----------

test('AC: Renderer drawTile renders fillRects for "s" spike char', () => {
  const { createRenderer, DEFAULT_TILE_PALETTE } = require('../src/renderer.js');
  const { createCamera } = require('../src/camera.js');
  const tm = createTilemap({ tileSize: 16, map: mapWithSpike(0, 0) });
  const ctx = {
    fillStyle: '',
    _calls: [],
    fillRect: function (x, y, w, hh) { this._calls.push({ x, y, w, h: hh, fs: this.fillStyle }); },
    clearRect: function () {},
  };
  const cam = createCamera({
    viewport: { width: 256, height: 64 },
    level: { pixelWidth: tm.pixelWidth, pixelHeight: tm.pixelHeight },
  });
  const renderer = createRenderer({
    ctx, viewport: { width: 256, height: 64 }, camera: cam, tilemap: tm,
    drawPlayer: () => {},
  });
  renderer.render({});
  const spikeFills = ctx._calls.filter(c => c.fs === DEFAULT_TILE_PALETTE.spike);
  assert.ok(spikeFills.length > 0, 'expected spike pixel fills from drawTile');
});

// ---------- drawPlatform sanity ----------

test('drawPlatform renders pixel rects within the platform footprint', () => {
  const calls = [];
  const ctx = { fillStyle: '', fillRect: function (x, y, w, h) { calls.push({ x, y, w, h }); } };
  drawPlatform(ctx, 100, 50, { w: 32, h: 8 });
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.ok(c.x >= 100 && c.x <= 100 + 32);
    assert.ok(c.y >= 50 && c.y <= 50 + 8);
  }
});

// ---------- pool discipline ----------

test('platform pool capacity defaults to 8 and respects spawn-beyond-cap returning null', () => {
  const h = createHazards({ platformCapacity: 2 });
  h.spawnPlatform(HORIZONTAL_CHAR, 0, 0);
  h.spawnPlatform(HORIZONTAL_CHAR, 0, 16);
  const overflow = h.spawnPlatform(HORIZONTAL_CHAR, 0, 32);
  assert.equal(overflow, null);
});

test('despawn frees the slot for reuse', () => {
  const h = createHazards({ platformCapacity: 2 });
  const a = h.spawnPlatform(HORIZONTAL_CHAR, 0, 0);
  h.despawnPlatform(a);
  const reused = h.spawnPlatform(VERTICAL_CHAR, 0, 0);
  assert.equal(reused, a);
});
