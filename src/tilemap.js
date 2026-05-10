/**
 * Tilemap — tiny hand-built map for the integration spike. The proper data
 * format, level loading, and themed levels are owned by WO-007.
 *
 * Map is a 2D array of single-character codes; `solidChars` defines which
 * characters block movement.
 *
 *   .  empty (sky)
 *   #  ground / solid platform
 *   =  floating platform
 *   G  goal (non-solid sensor — placeholder; later WOs handle this)
 */
(function (root) {
  'use strict';

  const DEFAULT_MAP = [
    '................................',
    '................................',
    '................................',
    '................................',
    '........=====...................',
    '................................',
    '................=====...........',
    '................................',
    '....======......................',
    '..........................G.....',
    '................................',
    '################################',
    '################################',
  ];

  const SOLID_CHARS = new Set(['#', '=']);

  function createTilemap(config) {
    const cfg = Object.assign({ tileSize: 16, map: DEFAULT_MAP }, config || {});
    const map = cfg.map;
    const tileSize = cfg.tileSize;
    const cols = map.reduce((m, row) => Math.max(m, row.length), 0);
    const rows = map.length;

    function charAt(tx, ty) {
      if (ty < 0 || ty >= rows) return '.';
      const row = map[ty];
      if (tx < 0 || tx >= row.length) return '.';
      return row.charAt(tx) || '.';
    }

    function tileAt(tx, ty) {
      const ch = charAt(tx, ty);
      if (SOLID_CHARS.has(ch)) return { solid: true, ch: ch };
      if (ch === '.') return null;
      return { solid: false, ch: ch };
    }

    function draw(ctx) {
      for (let ty = 0; ty < rows; ty++) {
        const row = map[ty];
        for (let tx = 0; tx < row.length; tx++) {
          const ch = row.charAt(tx);
          if (ch === '.') continue;
          const x = tx * tileSize;
          const y = ty * tileSize;
          if (ch === '#') {
            ctx.fillStyle = '#5a3a1a';
            ctx.fillRect(x, y, tileSize, tileSize);
            // grass top
            if (ty === 0 || charAt(tx, ty - 1) === '.') {
              ctx.fillStyle = '#3b6';
              ctx.fillRect(x, y, tileSize, 3);
            }
          } else if (ch === '=') {
            ctx.fillStyle = '#8a5';
            ctx.fillRect(x, y, tileSize, tileSize / 2);
          } else if (ch === 'G') {
            // goal flag
            ctx.fillStyle = '#fff';
            ctx.fillRect(x + 6, y, 2, tileSize);
            ctx.fillStyle = '#d23';
            ctx.fillRect(x + 8, y + 1, 6, 5);
          }
        }
      }
    }

    return {
      tileAt: tileAt,
      charAt: charAt,
      draw: draw,
      cols: cols,
      rows: rows,
      tileSize: tileSize,
      pixelWidth: cols * tileSize,
      pixelHeight: rows * tileSize,
    };
  }

  const api = {
    createTilemap: createTilemap,
    DEFAULT_MAP: DEFAULT_MAP,
    SOLID_CHARS: SOLID_CHARS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TilemapModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
