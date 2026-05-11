/**
 * TileMap — level data and tile type registry (WO-007).
 *
 * Each level is a 2D array of tile-type IDs. Tiles are 16x16 in game space.
 * Levels and tile pixel-art data are inline so the single-file delivery
 * constraint (FR-1) is upheld.
 *
 * Procedural level generation:
 *   The three required levels (~100 tiles wide each) would be tedious to
 *   author by hand and bulky to inline literally. We seed a tiny PRNG with
 *   a per-level constant so the layout is deterministic across runs but
 *   still varied. Each level is built up by composing primitives (flat
 *   ground, gap, floating platform, hazard, mystery, coin trail) chosen
 *   from a theme-specific weighted bag. Determinism keeps gameplay
 *   reproducible without storing thousands of explicit cell values.
 */
(function (root) {
  'use strict';

  // Tile types — IDs are stable; renderer (WO-009) keys off them.
  const TILE = Object.freeze({
    empty: 0,
    solid: 1,
    platform: 2,
    hazard: 3,
    mysteryBlock: 4,
    coin: 5,
    enemySpawn: 6,
    playerSpawn: 7,
    goal: 8,
  });
  const SOLID_IDS = new Set([TILE.solid]);
  const PASSTHROUGH_IDS = new Set([TILE.platform]); // pass-through from below

  // --- 16x16 tile pixel-art (palette indices) ---------------------------
  // Palettes are per-theme so the same tile id renders differently.
  const PALETTE = {
    grassland: ['transparent', '#5a3a1a', '#3b6', '#fff', '#fa3', '#d23'],
    cave:      ['transparent', '#2a1a0a', '#444', '#aaa', '#fa3', '#d23'],
    sky:       ['transparent', '#5cd', '#fff', '#fa3', '#fa0', '#d23'],
  };

  function row(str) {
    const out = new Array(16);
    const map = { '.': 0, K: 1, G: 2, W: 3, Y: 4, R: 5 };
    for (let i = 0; i < 16; i++) {
      const ch = i < str.length ? str[i] : '.';
      out[i] = map[ch] != null ? map[ch] : 0;
    }
    return out;
  }
  function sprite(rows) { return rows.flat(); }

  // Three minimal variants per tile: ground surface (with grass/dirt top),
  // ground fill (interior block), platform.
  function buildTileSprites() {
    const groundSurface = sprite([
      row('GGGGGGGGGGGGGGGG'),
      row('GGGGGGGGGGGGGGGG'),
      row('GGGGGGGGGGGGGGGG'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
    ]);
    const groundFill = sprite([
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
    ]);
    const platformSprite = sprite([
      row('YYYYYYYYYYYYYYYY'),
      row('YYYYYYYYYYYYYYYY'),
      row('YYYYYYYYYYYYYYYY'),
      row('KKKKKKKKKKKKKKKK'),
      row('KKKKKKKKKKKKKKKK'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
      row('................'),
    ]);
    return {
      groundSurface: groundSurface,
      groundFill: groundFill,
      platform: platformSprite,
    };
  }
  const TILE_SPRITES = buildTileSprites();

  // --- tiny deterministic PRNG (mulberry32) -----------------------------
  function makeRng(seed) {
    let s = seed >>> 0;
    return function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rng, weights) {
    const total = weights.reduce((s, w) => s + w[1], 0);
    let r = rng() * total;
    for (const [val, w] of weights) {
      r -= w;
      if (r <= 0) return val;
    }
    return weights[weights.length - 1][0];
  }
  function range(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  // --- level builders ---------------------------------------------------
  // Each builder returns a width×height grid of tile IDs. Layout strategy:
  // - solid ground stretches across the bottom 2 rows with occasional gaps
  // - floating platforms / mystery blocks / coin trails sprinkled above
  // - one playerSpawn at the start, one goal at the end
  // - hazards/enemies/coins seeded by theme weighting
  function buildGrid(width, height, fill) {
    const g = new Array(height);
    for (let y = 0; y < height; y++) {
      g[y] = new Array(width).fill(fill);
    }
    return g;
  }

  function buildLevel(spec) {
    const { width, height, seed, theme } = spec;
    const rng = makeRng(seed);
    const g = buildGrid(width, height, TILE.empty);

    // Solid ground in bottom 2 rows, with gaps every ~14-20 tiles.
    let x = 0;
    while (x < width) {
      const run = range(rng, 6, 14);
      const gap = (x + run < width - 4) ? range(rng, 2, 4) : 0;
      // ground span
      for (let i = 0; i < run && (x + i) < width; i++) {
        g[height - 1][x + i] = TILE.solid;
        g[height - 2][x + i] = TILE.solid;
      }
      // hazard sprinkled in the gap
      for (let i = 0; i < gap; i++) {
        const gx = x + run + i;
        if (gx >= 0 && gx < width) {
          g[height - 1][gx] = TILE.hazard;
        }
      }
      x += run + gap;
    }

    // Floating platforms, mystery blocks, coin trails, enemies.
    const platformDensity = { grassland: 0.04, cave: 0.06, sky: 0.09 }[theme] || 0.05;
    const hazardBonus     = { grassland: 0.00, cave: 0.04, sky: 0.02 }[theme] || 0.0;
    let placedCoins = 0, placedEnemies = 0;

    for (let i = 2; i < width - 3; i++) {
      // Platforms — chains of 2-4 tiles at random heights.
      if (rng() < platformDensity) {
        const py = range(rng, 4, height - 4);
        const len = range(rng, 2, 4);
        for (let j = 0; j < len && (i + j) < width - 3; j++) {
          g[py][i + j] = TILE.platform;
          // place a coin trail one row above
          if (py - 1 >= 0 && g[py - 1][i + j] === TILE.empty) {
            g[py - 1][i + j] = TILE.coin;
            placedCoins++;
          }
        }
        i += len; // skip past
      }
      // Mystery blocks at varied heights.
      else if (rng() < 0.02) {
        const my = range(rng, 5, height - 6);
        g[my][i] = TILE.mysteryBlock;
      }
      // Extra hazards on the ground (cave/sky theme bias).
      else if (rng() < hazardBonus) {
        if (g[height - 1][i] === TILE.solid) g[height - 1][i] = TILE.hazard;
      }
      // Enemy spawns on ground.
      else if (rng() < 0.015 && g[height - 1][i] === TILE.solid && i > 6) {
        g[height - 2][i] = TILE.empty; // ensure walkable
        g[height - 3][i] = TILE.enemySpawn;
        placedEnemies++;
      }
      // Standalone coins floating in air.
      else if (rng() < 0.04) {
        const cy = range(rng, 3, height - 5);
        if (g[cy][i] === TILE.empty) {
          g[cy][i] = TILE.coin;
          placedCoins++;
        }
      }
    }

    // Guarantee minimums: enemies and coins.
    let safety = 0;
    while (placedEnemies < 4 && safety++ < 200) {
      const ex = range(rng, 6, width - 6);
      if (g[height - 1][ex] === TILE.solid && g[height - 3][ex] === TILE.empty) {
        g[height - 3][ex] = TILE.enemySpawn;
        placedEnemies++;
      }
    }
    safety = 0;
    while (placedCoins < 12 && safety++ < 400) {
      const cx = range(rng, 4, width - 5);
      const cy = range(rng, 3, height - 4);
      if (g[cy][cx] === TILE.empty) {
        g[cy][cx] = TILE.coin;
        placedCoins++;
      }
    }

    // Player spawn (left) and goal (right).
    const spawnX = 2;
    g[height - 3][spawnX] = TILE.playerSpawn;
    // Ensure ground under spawn
    g[height - 1][spawnX] = TILE.solid;
    g[height - 2][spawnX] = TILE.solid;
    // Clear hazards near spawn
    for (let i = 0; i <= 3; i++) {
      if (g[height - 1][i] === TILE.hazard) g[height - 1][i] = TILE.solid;
    }

    const goalX = width - 3;
    g[height - 3][goalX] = TILE.goal;
    g[height - 1][goalX] = TILE.solid;
    g[height - 2][goalX] = TILE.solid;

    return g;
  }

  // --- factory ----------------------------------------------------------
  function createTileMap(options) {
    const cfg = Object.assign({ tileSize: 16 }, options || {});

    const LEVELS = {
      grassland: {
        name: 'Sunny Plains',
        theme: 'grassland',
        bgColor: '#5cd',
        width: 100,
        height: 15,
        musicTempo: 110,
        seed: 0xA11CE1,
      },
      cave: {
        name: 'Damp Caverns',
        theme: 'cave',
        bgColor: '#222',
        width: 120,
        height: 15,
        musicTempo: 95,
        seed: 0xCAFE07,
      },
      sky: {
        name: 'Cloud Climb',
        theme: 'sky',
        bgColor: '#8df',
        width: 100,
        height: 15,
        musicTempo: 125,
        seed: 0x5BAEEF,
      },
    };
    // Eagerly build grids — they're only built once and the levels are small.
    Object.keys(LEVELS).forEach((k) => {
      LEVELS[k].grid = buildLevel(LEVELS[k]);
    });

    function getLevel(name) {
      return LEVELS[name] || null;
    }

    // getTile(levelName, col, row) — returns TILE id; 0 (empty) for OOB.
    function getTile(levelName, col, row) {
      const lvl = LEVELS[levelName];
      if (!lvl) return TILE.empty;
      if (row < 0 || row >= lvl.height) return TILE.empty;
      const r = lvl.grid[row];
      if (!r) return TILE.empty;
      if (col < 0 || col >= lvl.width) return TILE.empty;
      return r[col];
    }

    function isSolid(tileId) { return SOLID_IDS.has(tileId); }
    function isPassthrough(tileId) { return PASSTHROUGH_IDS.has(tileId); }

    // Find the playerSpawn cell in a level (col, row in tile units).
    function findSpawn(levelName) {
      const lvl = LEVELS[levelName];
      if (!lvl) return null;
      for (let r = 0; r < lvl.height; r++) {
        for (let c = 0; c < lvl.width; c++) {
          if (lvl.grid[r][c] === TILE.playerSpawn) return { col: c, row: r };
        }
      }
      return null;
    }

    function findGoal(levelName) {
      const lvl = LEVELS[levelName];
      if (!lvl) return null;
      for (let r = 0; r < lvl.height; r++) {
        for (let c = 0; c < lvl.width; c++) {
          if (lvl.grid[r][c] === TILE.goal) return { col: c, row: r };
        }
      }
      return null;
    }

    // Count occurrences of a tile id — useful for tests / debugging.
    function countTiles(levelName, tileId) {
      const lvl = LEVELS[levelName];
      if (!lvl) return 0;
      let n = 0;
      for (let r = 0; r < lvl.height; r++) {
        for (let c = 0; c < lvl.width; c++) {
          if (lvl.grid[r][c] === tileId) n++;
        }
      }
      return n;
    }

    function listLevels() { return Object.keys(LEVELS); }

    return {
      TILE: TILE,
      TILE_SPRITES: TILE_SPRITES,
      PALETTE: PALETTE,
      getLevel: getLevel,
      getTile: getTile,
      findSpawn: findSpawn,
      findGoal: findGoal,
      countTiles: countTiles,
      listLevels: listLevels,
      isSolid: isSolid,
      isPassthrough: isPassthrough,
      tileSize: cfg.tileSize,
    };
  }

  const api = {
    createTileMap: createTileMap,
    TILE: TILE,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TileMapModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
