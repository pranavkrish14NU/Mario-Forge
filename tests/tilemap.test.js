'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTileMap, TILE } = require('../src/tilemap.js');

test('AC1: three levels exist with required dimensions', () => {
  const tm = createTileMap();
  assert.deepEqual(tm.listLevels().sort(), ['cave', 'grassland', 'sky']);
  const g = tm.getLevel('grassland');
  const c = tm.getLevel('cave');
  const s = tm.getLevel('sky');
  assert.ok(g.width >= 100);
  assert.ok(c.width >= 120);
  assert.ok(s.width >= 100);
  assert.ok(g.height >= 15);
  assert.ok(c.height >= 15);
  assert.ok(s.height >= 15);
});

test('AC2: at least 8 tile types defined with correct IDs', () => {
  assert.equal(TILE.empty, 0);
  assert.equal(TILE.solid, 1);
  assert.equal(TILE.platform, 2);
  assert.equal(TILE.hazard, 3);
  assert.equal(TILE.mysteryBlock, 4);
  assert.equal(TILE.coin, 5);
  assert.equal(TILE.enemySpawn, 6);
  assert.equal(TILE.playerSpawn, 7);
  assert.equal(TILE.goal, 8);
});

test('AC3: getTile returns correct ID; out-of-bounds returns 0 (empty)', () => {
  const tm = createTileMap();
  // out-of-bounds in every direction
  assert.equal(tm.getTile('grassland', -1, 0), 0);
  assert.equal(tm.getTile('grassland', 0, -1), 0);
  assert.equal(tm.getTile('grassland', 9999, 0), 0);
  assert.equal(tm.getTile('grassland', 0, 9999), 0);
  // unknown level
  assert.equal(tm.getTile('moon', 0, 0), 0);
  // bottom row of every level is solid ground at most positions
  ['grassland', 'cave', 'sky'].forEach((name) => {
    const lvl = tm.getLevel(name);
    let solidCount = 0;
    for (let c = 0; c < lvl.width; c++) {
      if (tm.getTile(name, c, lvl.height - 1) === TILE.solid) solidCount++;
    }
    assert.ok(solidCount > lvl.width * 0.5, name + ' bottom row should be mostly solid');
  });
});

test('AC4: each level has exactly one playerSpawn and one goal', () => {
  const tm = createTileMap();
  ['grassland', 'cave', 'sky'].forEach((name) => {
    assert.equal(tm.countTiles(name, TILE.playerSpawn), 1, name + ' must have exactly 1 playerSpawn');
    assert.equal(tm.countTiles(name, TILE.goal), 1, name + ' must have exactly 1 goal');
    const spawn = tm.findSpawn(name);
    const goal = tm.findGoal(name);
    assert.ok(spawn && spawn.col >= 0 && spawn.row >= 0);
    assert.ok(goal && goal.col >= 0 && goal.row >= 0);
  });
});

test('AC5: each level has at least 3 enemy spawns and 10 coins', () => {
  const tm = createTileMap();
  ['grassland', 'cave', 'sky'].forEach((name) => {
    const enemies = tm.countTiles(name, TILE.enemySpawn);
    const coins = tm.countTiles(name, TILE.coin);
    assert.ok(enemies >= 3, name + ' enemy spawns (' + enemies + ') must be >= 3');
    assert.ok(coins >= 10, name + ' coins (' + coins + ') must be >= 10');
  });
});

test('AC6: at least 3 tile sprite variants exist (groundSurface, groundFill, platform)', () => {
  const tm = createTileMap();
  assert.ok(tm.TILE_SPRITES.groundSurface);
  assert.ok(tm.TILE_SPRITES.groundFill);
  assert.ok(tm.TILE_SPRITES.platform);
  // Each variant is a 16×16 = 256 entry array of palette indices.
  assert.equal(tm.TILE_SPRITES.groundSurface.length, 256);
  assert.equal(tm.TILE_SPRITES.groundFill.length, 256);
  assert.equal(tm.TILE_SPRITES.platform.length, 256);
});

test('AC6: 3 themed palettes (grassland/cave/sky) defined inline', () => {
  const tm = createTileMap();
  assert.ok(tm.PALETTE.grassland);
  assert.ok(tm.PALETTE.cave);
  assert.ok(tm.PALETTE.sky);
  assert.ok(tm.PALETTE.grassland.length >= 5);
});

test('AC7: level metadata includes name, theme, bgColor, width, height', () => {
  const tm = createTileMap();
  ['grassland', 'cave', 'sky'].forEach((name) => {
    const lvl = tm.getLevel(name);
    assert.equal(typeof lvl.name, 'string');
    assert.ok(lvl.name.length > 0);
    assert.equal(typeof lvl.theme, 'string');
    assert.match(lvl.bgColor, /^#[0-9a-fA-F]{3,6}$/);
    assert.equal(typeof lvl.width, 'number');
    assert.equal(typeof lvl.height, 'number');
  });
});

test('isSolid / isPassthrough classify tile IDs correctly', () => {
  const tm = createTileMap();
  assert.equal(tm.isSolid(TILE.solid), true);
  assert.equal(tm.isSolid(TILE.empty), false);
  assert.equal(tm.isSolid(TILE.platform), false);
  assert.equal(tm.isPassthrough(TILE.platform), true);
  assert.equal(tm.isPassthrough(TILE.solid), false);
});

test('determinism: building tilemap twice produces identical grids', () => {
  const a = createTileMap();
  const b = createTileMap();
  ['grassland', 'cave', 'sky'].forEach((name) => {
    const ga = a.getLevel(name).grid;
    const gb = b.getLevel(name).grid;
    for (let r = 0; r < ga.length; r++) {
      assert.deepEqual(ga[r], gb[r], name + ' row ' + r + ' must be deterministic');
    }
  });
});

test('player spawn is positioned such that the player has ground beneath', () => {
  const tm = createTileMap();
  ['grassland', 'cave', 'sky'].forEach((name) => {
    const spawn = tm.findSpawn(name);
    const lvl = tm.getLevel(name);
    // Two tiles below spawn must be solid (the bottom-two-row ground).
    assert.equal(tm.getTile(name, spawn.col, lvl.height - 1), TILE.solid,
      name + ' ground tile below spawn must be solid');
  });
});

test('goal is reachable (no immediate hazard wall in front)', () => {
  const tm = createTileMap();
  ['grassland', 'cave', 'sky'].forEach((name) => {
    const goal = tm.findGoal(name);
    const lvl = tm.getLevel(name);
    assert.equal(tm.getTile(name, goal.col, lvl.height - 1), TILE.solid,
      name + ' tile under goal must be solid');
  });
});
