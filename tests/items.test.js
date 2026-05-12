'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createItems,
  drawCoin,
  drawMystery,
  SPRITES_COIN,
  SPRITES_MYSTERY_UNUSED,
  SPRITES_MYSTERY_USED,
  DEFAULTS,
  TYPE_COIN,
  TYPE_MYSTERY,
} = require('../src/items.js');
const { createTilemap } = require('../src/tilemap.js');

function makePlayer(x, y) {
  return { x: x, y: y, w: 16, h: 16, vx: 0, vy: 0, score: 0 };
}

function makeMapWith(chars) {
  // chars: array of {ch, x, y} positions; surround with 10×10 of '.'
  const rows = [];
  for (let y = 0; y < 10; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) r += '.';
    rows.push(r);
  }
  for (const c of chars) {
    const row = rows[c.y].split('');
    row[c.x] = c.ch;
    rows[c.y] = row.join('');
  }
  return rows;
}

// ---------- factory & validation ----------

test('createItems exposes the public API', () => {
  const items = createItems({});
  assert.equal(typeof items.spawnCoin, 'function');
  assert.equal(typeof items.spawnMystery, 'function');
  assert.equal(typeof items.update, 'function');
  assert.equal(typeof items.onCeilingHit, 'function');
  assert.equal(typeof items.tileAt, 'function');
  assert.equal(typeof items.combineTileQuery, 'function');
  assert.equal(typeof items.parseSpawnsFromTilemap, 'function');
  assert.equal(typeof items.spawnAllFromTilemap, 'function');
  assert.equal(typeof items.getActive, 'function');
});

test('createItems rejects non-positive capacities', () => {
  assert.throws(() => createItems({ coinCapacity: 0 }), RangeError);
  assert.throws(() => createItems({ mysteryCapacity: -1 }), RangeError);
});

test('constants frozen', () => {
  const items = createItems({});
  assert.throws(() => { items.constants.coinScore = 50; }, TypeError);
});

test('DEFAULTS coin score is 100 and coin capacity is 80', () => {
  assert.equal(DEFAULTS.coinScore, 100);
  assert.equal(DEFAULTS.coinCapacity, 80);
});

// ---------- AC: coin pool supports up to 80, no allocation in gameplay ----------

test('AC: coin capacity defaults to 80', () => {
  const items = createItems({});
  assert.equal(items.coinCapacity(), 80);
});

test('AC: spawnCoin fills to capacity then returns null', () => {
  const items = createItems({ coinCapacity: 3 });
  const a = items.spawnCoin(0, 0);
  items.spawnCoin(16, 0);
  items.spawnCoin(32, 0);
  const overflow = items.spawnCoin(48, 0);
  assert.ok(a, 'first spawn succeeds');
  assert.equal(overflow, null, 'beyond-capacity spawn returns null');
});

test('AC: despawning a coin frees its slot for reuse — same object reference', () => {
  const items = createItems({ coinCapacity: 2 });
  const a = items.spawnCoin(0, 0);
  items.spawnCoin(16, 0);
  items.despawn(a);
  const reused = items.spawnCoin(32, 0);
  assert.equal(reused, a, 'slot object reference reused after despawn');
});

test('_coins / _mysteries pool arrays are stable across spawn cycles (allocation discipline)', () => {
  const items = createItems({ coinCapacity: 5, mysteryCapacity: 3 });
  const cref = items._coins;
  const mref = items._mysteries;
  items.spawnCoin(0, 0);
  items.spawnMystery(16, 0);
  items.despawn(items._coins[0]);
  items.spawnCoin(32, 0);
  assert.strictEqual(items._coins, cref);
  assert.strictEqual(items._mysteries, mref);
});

// ---------- AC: coins from level data ----------

test('AC: parseSpawnsFromTilemap finds c (coin) and M (mystery) markers in world coords', () => {
  const tm = createTilemap({ tileSize: 16, map: makeMapWith([
    { ch: 'c', x: 3, y: 2 },
    { ch: 'M', x: 5, y: 4 },
    { ch: 'c', x: 7, y: 6 },
  ]) });
  const items = createItems({});
  const list = items.parseSpawnsFromTilemap(tm);
  assert.equal(list.length, 3);
  const coins = list.filter(s => s.type === TYPE_COIN);
  const mystery = list.find(s => s.type === TYPE_MYSTERY);
  assert.equal(coins.length, 2);
  assert.ok(mystery);
  assert.equal(coins[0].x, 3 * 16);
  assert.equal(coins[0].y, 2 * 16);
  assert.equal(mystery.x, 5 * 16);
  assert.equal(mystery.y, 4 * 16);
});

test('AC: spawnAllFromTilemap activates one coin/mystery per marker', () => {
  const tm = createTilemap({ tileSize: 16, map: makeMapWith([
    { ch: 'c', x: 1, y: 1 },
    { ch: 'c', x: 2, y: 1 },
    { ch: 'M', x: 3, y: 4 },
  ]) });
  const items = createItems({});
  const list = items.spawnAllFromTilemap(tm);
  assert.equal(list.length, 3);
  assert.equal(items.activeCoinCount(), 2);
  assert.equal(items.activeMysteryCount(), 1);
});

// ---------- AC: coin animation (spin, ≥ 4 frames) ----------

test('AC: coin has at least 4 spin animation frames', () => {
  assert.ok(SPRITES_COIN.length >= 4, 'coin animation must have ≥ 4 frames');
});

test('AC: coin animFrame advances over multiple update() calls', () => {
  const items = createItems({ coinFrameInterval: 2 });
  const coin = items.spawnCoin(200, 200);
  // Place player far away so no collection occurs.
  const player = makePlayer(0, 0);
  for (let i = 0; i < 30; i++) items.update({ player });
  assert.ok(coin.active, 'coin should still be active (player far away)');
  assert.notEqual(coin.animFrame, 0, 'animFrame should advance');
});

// ---------- AC: walking into a coin collects + score += 100 ----------

test('AC: AABB overlap with player despawns coin and adds 100 to score', () => {
  const items = createItems({});
  const coin = items.spawnCoin(50, 50);
  const player = makePlayer(50, 50); // overlaps exactly
  items.update({ player });
  assert.equal(coin.active, false, 'coin despawned on collection');
  assert.equal(player.score, 100, 'score increased by 100');
});

test('AC: non-overlapping player does NOT collect the coin', () => {
  const items = createItems({});
  const coin = items.spawnCoin(100, 100);
  const player = makePlayer(500, 500);
  items.update({ player });
  assert.equal(coin.active, true);
  assert.equal(player.score, 0);
});

test('AC: collecting multiple coins increments score for each', () => {
  const items = createItems({});
  items.spawnCoin(50, 50);
  items.spawnCoin(55, 55);
  items.spawnCoin(60, 60);
  const player = makePlayer(48, 48);
  items.update({ player });
  // All three overlap a 16×16 player at (48, 48) — score = 3 * 100.
  assert.equal(player.score, 300);
  assert.equal(items.activeCoinCount(), 0);
});

test('onCoinCollected callback is invoked on collection', () => {
  const items = createItems({});
  const coin = items.spawnCoin(50, 50);
  const player = makePlayer(50, 50);
  let calls = 0;
  items.update({ player, onCoinCollected: () => calls++ });
  assert.equal(calls, 1);
});

// ---------- AC: mystery block tile is solid ----------

test('AC: mystery block tileAt(tx, ty) reports solid', () => {
  const items = createItems({});
  items.spawnMystery(5 * 16, 4 * 16);
  const t = items.tileAt(5, 4);
  assert.ok(t);
  assert.equal(t.solid, true);
  assert.equal(t.type, 'mystery');
  assert.equal(t.used, false);
});

test('AC: tileAt returns null for empty cells', () => {
  const items = createItems({});
  assert.equal(items.tileAt(0, 0), null);
});

test('combineTileQuery falls back to tilemap when no mystery occupies the cell', () => {
  const tm = createTilemap({ tileSize: 16, map: [
    '################',
    '................',
  ]});
  const items = createItems({});
  items.spawnMystery(5 * 16, 1 * 16);
  const q = items.combineTileQuery(tm);
  // (0, 0) is a # in the tilemap.
  const a = q(0, 0);
  assert.ok(a && a.solid);
  // (5, 1) is empty in tilemap but has a mystery block.
  const b = q(5, 1);
  assert.ok(b && b.solid && b.type === 'mystery');
  // (10, 1) is empty in both.
  assert.equal(q(10, 1), null);
});

// ---------- AC: mystery block hit-from-below triggers coin popup + used ----------

test('AC: onCeilingHit on a mystery cell marks used, spawns popup coin one tile up', () => {
  const items = createItems({});
  const m = items.spawnMystery(5 * 16, 4 * 16);
  const player = makePlayer(0, 0);
  const result = items.onCeilingHit(player, { tx: 5, ty: 4 });
  assert.ok(result);
  assert.equal(m.used, true);
  assert.ok(result.popup);
  assert.equal(result.popup.isPopup, true);
  assert.equal(result.popup.x, 5 * 16);
  assert.equal(result.popup.y, 3 * 16); // one tile up
});

test('AC: a used mystery block is no-op on repeat hits (no second popup, score unchanged)', () => {
  const items = createItems({});
  items.spawnMystery(5 * 16, 4 * 16);
  const player = makePlayer(0, 0);
  const r1 = items.onCeilingHit(player, { tx: 5, ty: 4 });
  assert.ok(r1);
  const r2 = items.onCeilingHit(player, { tx: 5, ty: 4 });
  assert.equal(r2, null, 'second hit returns null (no-op)');
});

test('AC: onCeilingHit on a non-mystery cell returns null', () => {
  const items = createItems({});
  items.spawnMystery(5 * 16, 4 * 16);
  const player = makePlayer(0, 0);
  assert.equal(items.onCeilingHit(player, { tx: 0, ty: 0 }), null);
});

test('AC: a used mystery block is still solid (player can stand on it)', () => {
  const items = createItems({});
  const m = items.spawnMystery(5 * 16, 4 * 16);
  items.onCeilingHit(makePlayer(0, 0), { tx: 5, ty: 4 });
  assert.equal(m.used, true);
  const t = items.tileAt(5, 4);
  assert.ok(t && t.solid, 'used block remains solid');
});

// ---------- AC: popup coin auto-collects ----------

test('AC: popup coin spawned by a hit auto-collects after popupLifetimeFrames', () => {
  const items = createItems({ popupLifetimeFrames: 5 });
  items.spawnMystery(5 * 16, 4 * 16);
  const player = makePlayer(0, 0);
  const r = items.onCeilingHit(player, { tx: 5, ty: 4 });
  assert.ok(r.popup.active);
  // Advance enough frames to age out the popup.
  for (let i = 0; i < 6; i++) items.update({ player });
  assert.equal(r.popup.active, false, 'popup coin should be auto-collected after lifetime');
  assert.equal(player.score, 100, 'auto-collect still grants the score');
});

test('popup coin rises while alive (vy is negative)', () => {
  const items = createItems({ popupLifetimeFrames: 10 });
  items.spawnMystery(5 * 16, 4 * 16);
  const player = makePlayer(0, 0);
  const r = items.onCeilingHit(player, { tx: 5, ty: 4 });
  const y0 = r.popup.y;
  items.update({ player });
  items.update({ player });
  assert.ok(r.popup.y < y0, 'popup coin should rise (y decreases)');
});

// ---------- AC: mystery block pulse animation when unused ----------

test('AC: unused mystery block has at least 2 pulse frames and they differ', () => {
  assert.ok(SPRITES_MYSTERY_UNUSED.length >= 2);
  const a = SPRITES_MYSTERY_UNUSED[0];
  const b = SPRITES_MYSTERY_UNUSED[1];
  let differ = false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { differ = true; break; }
  assert.ok(differ, 'pulse frames must differ');
});

test('AC: used mystery block has a distinct static appearance', () => {
  assert.ok(SPRITES_MYSTERY_USED.length >= 1);
  const used = SPRITES_MYSTERY_USED[0];
  const unused = SPRITES_MYSTERY_UNUSED[0];
  let differ = false;
  for (let i = 0; i < used.length; i++) if (used[i] !== unused[i]) { differ = true; break; }
  assert.ok(differ, 'used appearance must differ from unused');
});

test('unused mystery animFrame advances; used mystery animFrame stays at 0', () => {
  const items = createItems({ mysteryFrameInterval: 2 });
  const unused = items.spawnMystery(0, 0);
  const used = items.spawnMystery(16, 0, { used: true });
  for (let i = 0; i < 10; i++) items.update({ player: null });
  assert.notEqual(unused.animFrame, 0);
  assert.equal(used.animFrame, 0);
});

// ---------- Renderer feed ----------

test('getActive includes both coins and mystery blocks; each has a draw(ctx, sx, sy, e) function', () => {
  const items = createItems({});
  items.spawnCoin(0, 0);
  items.spawnMystery(16, 16);
  const list = items.getActive();
  assert.equal(list.length, 2);
  for (const e of list) {
    assert.equal(typeof e.draw, 'function');
    assert.equal(e.draw.length, 4);
  }
});

test('drawCoin issues fillRects inside the 16×16 footprint', () => {
  const calls = [];
  const ctx = { fillStyle: '', fillRect: function (x, y, w, h) { calls.push({ x, y, w, h }); } };
  const coin = { animFrame: 0 };
  drawCoin(ctx, 100, 50, coin);
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.ok(c.x >= 100 && c.x < 116);
    assert.ok(c.y >= 50 && c.y < 66);
  }
});

test('drawMystery renders pulse frames when unused and static when used', () => {
  const unusedCalls = [];
  const usedCalls = [];
  const ctxU = { fillStyle: '', fillRect: function (x, y, w, h) { unusedCalls.push({ x, y, fs: this.fillStyle }); } };
  const ctxUsed = { fillStyle: '', fillRect: function (x, y, w, h) { usedCalls.push({ x, y, fs: this.fillStyle }); } };
  drawMystery(ctxU, 0, 0, { animFrame: 0, used: false });
  drawMystery(ctxUsed, 0, 0, { animFrame: 0, used: true });
  // Different sprite ⇒ different set of fill calls.
  assert.notEqual(unusedCalls.length, usedCalls.length, 'used vs unused sprites should differ in pixel count');
});
