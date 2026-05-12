'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollision, aabbOverlap } = require('../src/collision.js');

// Build a tile-query function backed by a Set of solid coordinates.
function makeTiles(solidCoords) {
  const set = new Set(solidCoords.map((c) => c[0] + ',' + c[1]));
  // Count how many times queries happen so AC6 can assert the spatial query
  // never scans the whole world.
  let queryCount = 0;
  const queries = [];
  function query(tx, ty) {
    queryCount++;
    queries.push([tx, ty]);
    if (set.has(tx + ',' + ty)) return { solid: true };
    return null;
  }
  query.queryCount = () => queryCount;
  query.queries = queries;
  return query;
}

function entity(o) {
  return Object.assign({ x: 0, y: 0, w: 16, h: 16, vx: 0, vy: 0, onGround: false }, o || {});
}

// ---------- aabbOverlap (AC7) ----------
test('aabbOverlap returns true when boxes intersect', () => {
  assert.equal(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true);
});

test('aabbOverlap returns false when boxes touch only at the edge (zero-area)', () => {
  assert.equal(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
});

test('aabbOverlap returns false when boxes are disjoint', () => {
  assert.equal(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 }), false);
});

test('aabbOverlap throws on missing args', () => {
  assert.throws(() => aabbOverlap(null, { x: 0, y: 0, w: 1, h: 1 }), TypeError);
});

// ---------- AC1: rightward stop ----------
test('AC1: entity moving rightward stops at the left edge of a solid tile', () => {
  const c = createCollision({ tileSize: 16 });
  // Solid wall at tile (2,0) — left edge is x=32.
  const tiles = makeTiles([[2, 0]]);
  const e = entity({ x: 0, y: 0, vx: 50 }); // big velocity → would penetrate
  c.step(e, tiles);
  assert.equal(e.x, 16, 'x must snap to 32 - entity.w(16) = 16');
  assert.equal(e.vx, 0);
  assert.equal(e.x + e.w, 32, 'right edge of entity must touch left edge of tile');
});

test('moving leftward stops at the right edge of a solid tile (symmetric)', () => {
  const c = createCollision({ tileSize: 16 });
  const tiles = makeTiles([[0, 0]]); // wall at tile (0,0) right edge x=16
  const e = entity({ x: 100, y: 0, vx: -200 });
  c.step(e, tiles);
  assert.equal(e.x, 16);
  assert.equal(e.vx, 0);
});

// ---------- AC2: landing ----------
test('AC2: falling entity lands on top of a solid tile, vy=0, onGround=true', () => {
  const c = createCollision({ tileSize: 16 });
  // Floor at tile (0,5) — top edge is y=80.
  const tiles = makeTiles([[0, 5]]);
  const e = entity({ x: 0, y: 0, vy: 100 });
  c.step(e, tiles);
  assert.equal(e.y, 80 - 16, 'top of entity sits at floor y - entity.h');
  assert.equal(e.vy, 0);
  assert.equal(e.onGround, true);
});

// ---------- AC3: ceiling ----------
test('AC3: jumping entity hits ceiling and vy=0', () => {
  const c = createCollision({ tileSize: 16 });
  // Ceiling tile at (0,0) — bottom edge is y=16.
  const tiles = makeTiles([[0, 0]]);
  const e = entity({ x: 0, y: 32, vy: -100 });
  c.step(e, tiles);
  assert.equal(e.y, 16, 'top of entity snaps to bottom of ceiling tile');
  assert.equal(e.vy, 0);
  assert.equal(e.onGround, false, 'ceiling hit does not set onGround');
});

// ---------- AC4: walk off ledge ----------
test('AC4: walking off a platform edge clears onGround on the next frame', () => {
  const c = createCollision({ tileSize: 16 });
  // Platform spans tiles (0,5) and (1,5). Tile (2,5) is empty.
  const tiles = makeTiles([[0, 5], [1, 5]]);
  // Entity standing on tile (1,5) — y=64 puts entity top at 64, bottom at 80=tile top.
  const e = entity({ x: 16, y: 64, vx: 4, vy: 0, onGround: true });
  // First step: still on platform after moving 4px right (now at x=20, still over tile 1).
  c.step(e, tiles);
  assert.equal(e.onGround, true, 'still on platform');
  // Now apply gravity-like vy and continue moving until past the edge.
  // After enough steps to clear x=32 (tile 2's left edge), onGround should drop.
  for (let i = 0; i < 5; i++) {
    e.vy = 0; // simulate no gravity for simplicity
    c.step(e, tiles);
    if (e.x >= 32) break;
  }
  // Once past the platform's right edge with no Y motion, onGround must be false.
  assert.equal(e.x >= 32, true, 'sanity: entity walked off');
  assert.equal(e.onGround, false, 'onGround must clear when no tile is below');
});

// ---------- AC5: diagonal corner slide ----------
test('AC5: diagonal-into-floor resolves to a slide (X moves; Y stops on floor)', () => {
  const c = createCollision({ tileSize: 16 });
  // Floor at tile (3,5): top y=80. Place entity above the floor.
  const tiles = makeTiles([[3, 5]]);
  // Entity centered over the floor tile (x=48 is the floor's left edge).
  const e = entity({ x: 48, y: 50, vx: 4, vy: 100 });
  c.step(e, tiles);
  assert.equal(e.vx, 4, 'horizontal motion preserved while landing');
  assert.equal(e.x, 52, 'x advanced by vx');
  assert.equal(e.onGround, true);
  assert.equal(e.vy, 0);
  assert.equal(e.y, 64, 'y snapped to floor.top(80) - entity.h(16) = 64');
});

test('AC5: diagonal-into-wall resolves to a slide (Y moves; X stops on wall)', () => {
  const c = createCollision({ tileSize: 16 });
  // Wall at tile (2,0): left edge x=32. No floor.
  const tiles = makeTiles([[2, 0]]);
  // Entity starts at (16, 0) with vx=20 (would penetrate) and vy=3 (drops).
  const e = entity({ x: 16, y: 0, vx: 20, vy: 3 });
  c.step(e, tiles);
  assert.equal(e.vx, 0, 'horizontal stopped by wall');
  assert.equal(e.x, 16, 'x clamped at wall-tile.left - entity.w');
  assert.equal(e.vy, 3, 'vertical motion preserved');
  assert.equal(e.y, 3);
});

// ---------- AC6: spatial query ----------
test('AC6: spatial query — Collision tests only tiles overlapping the entity', () => {
  const c = createCollision({ tileSize: 16 });
  // Build a tile world but record every query.
  const tiles = makeTiles([]); // all empty; we care about which tiles are read.
  const e = entity({ x: 100, y: 100, w: 16, h: 16, vx: 5, vy: 5 });
  c.step(e, tiles);
  // After moving, the entity overlaps at most 4 tiles (2x2). Per-axis step
  // queries that footprint twice (once after X-move, once after Y-move). So
  // at most ~10 queries, definitely not the whole map.
  const total = tiles.queryCount();
  assert.ok(total > 0, 'should query at least one tile');
  assert.ok(total < 16, 'queries (' + total + ') must be bounded, not full-map');
});

test('AC6: spatial query stays bounded regardless of world position', () => {
  const c = createCollision({ tileSize: 16 });
  // Both entities are tile-aligned so they straddle the same number of
  // tiles after the velocity nudge — query count must be identical.
  const a = makeTiles([]);
  const b = makeTiles([]);
  c.step(entity({ x: 0, y: 0, w: 16, h: 16, vx: 5, vy: 5 }), a);
  c.step(entity({ x: 1024, y: 1024, w: 16, h: 16, vx: 5, vy: 5 }), b);
  assert.equal(a.queryCount(), b.queryCount(),
    'identical-shaped entities at tile-aligned positions must query identically');
  // Whatever that number is, it must be bounded — never O(world).
  assert.ok(a.queryCount() < 50, 'queries (' + a.queryCount() + ') must be O(1) per step');
});

// ---------- additional invariants ----------
test('step throws if entity or tileQuery missing', () => {
  const c = createCollision();
  assert.throws(() => c.step(null, () => null), TypeError);
  assert.throws(() => c.step(entity(), null), TypeError);
});

test('step with no velocity and no nearby solids leaves entity unchanged', () => {
  const c = createCollision();
  const tiles = makeTiles([]);
  const e = entity({ x: 10, y: 10, vx: 0, vy: 0 });
  c.step(e, tiles);
  assert.equal(e.x, 10);
  assert.equal(e.y, 10);
  assert.equal(e.onGround, false);
});

test('onWall callback fires with the offending tile and side', () => {
  const c = createCollision({ tileSize: 16 });
  const tiles = makeTiles([[2, 0]]);
  const calls = [];
  const e = entity({ x: 0, y: 0, vx: 50 });
  c.step(e, tiles, {
    onWall: function (ent, info) { calls.push({ tx: info.tx, ty: info.ty, side: info.side }); },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { tx: 2, ty: 0, side: 'right' });
});

test('onLand callback fires when entity lands on a tile', () => {
  const c = createCollision({ tileSize: 16 });
  const tiles = makeTiles([[0, 5]]);
  const calls = [];
  const e = entity({ x: 0, y: 0, vy: 100 });
  c.step(e, tiles, { onLand: function (ent, info) { calls.push(info); } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { tx: 0, ty: 5 });
});

test('onCeiling callback fires when entity hits a ceiling', () => {
  const c = createCollision({ tileSize: 16 });
  const tiles = makeTiles([[0, 0]]);
  const calls = [];
  const e = entity({ x: 0, y: 32, vy: -100 });
  c.step(e, tiles, { onCeiling: function (ent, info) { calls.push(info); } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { tx: 0, ty: 0 });
});

test('isOverlappingSolid returns the hit tile coords when overlapping', () => {
  const c = createCollision({ tileSize: 16 });
  const tiles = makeTiles([[2, 2]]);
  const e = entity({ x: 32, y: 32 }); // entity occupies tile (2,2)
  const hit = c.isOverlappingSolid(e, tiles);
  assert.ok(hit);
  assert.equal(hit.tx, 2);
  assert.equal(hit.ty, 2);
});

test('isOverlappingSolid returns null for empty space', () => {
  const c = createCollision({ tileSize: 16 });
  const tiles = makeTiles([[2, 2]]);
  const e = entity({ x: 100, y: 100 });
  assert.equal(c.isOverlappingSolid(e, tiles), null);
});

test('tileBounds computes inclusive AABB tile range', () => {
  const c = createCollision({ tileSize: 16 });
  const b = c.tileBounds({ x: 8, y: 8, w: 16, h: 16 });
  assert.deepEqual(b, { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test('non-solid tiles in the entity path are ignored', () => {
  const c = createCollision({ tileSize: 16 });
  function tiles(tx, ty) {
    if (tx === 2 && ty === 0) return { solid: false, decoration: 'grass' };
    return null;
  }
  const e = entity({ x: 0, y: 0, vx: 50 });
  c.step(e, tiles);
  assert.equal(e.vx, 50, 'should pass through non-solid tile');
  assert.equal(e.x, 50);
});

test('entity standing still on a platform keeps onGround across frames', () => {
  const c = createCollision({ tileSize: 16 });
  const tiles = makeTiles([[0, 5], [1, 5], [2, 5]]);
  // Land first, then stand still.
  const e = entity({ x: 16, y: 64, vy: 0, onGround: true });
  c.step(e, tiles); // standing still
  assert.equal(e.onGround, true, 'standing-still on ground must remain onGround');
});
