/**
 * Renderer — assembles a single rendered frame to a Canvas 2D context.
 * (WO-009, REQ-004 + REQ-017.)
 *
 * Responsibilities:
 *   - Clear the viewport to the base background.
 *   - Draw parallax background layers via Camera.getParallaxOffset(factor).
 *   - Draw tile geometry from the Tilemap, culled to the camera viewport
 *     (plus a 1-tile margin so tiles entering from the edge are never
 *     mid-revealed). Tile pixel logic lives here, not in Tilemap, so the
 *     Tilemap module stays pure data.
 *   - Draw the player sprite at world-minus-camera-offset.
 *   - Draw additional entities the caller passes in (placeholder hook for
 *     the enemy/item WOs — empty array is fine).
 *   - Draw the HUD at fixed screen coordinates (NOT camera-affected).
 *
 * Coordinate convention:
 *   screenX = round(worldX - camera.offset.x)
 *   screenY = round(worldY - camera.offset.y)
 *   Math.round (not floor) keeps the pixel-art crisp without bias.
 *
 * Stats:
 *   getLastFrameStats() returns the counts from the most recent render()
 *   so AC tests can verify culling (drawn vs total) and draw-call growth.
 */
(function (root) {
  'use strict';

  // Default tile palette mirrors the colours that the integration-spike
  // Tilemap module hard-coded in its now-deprecated draw() helper.
  const DEFAULT_TILE_PALETTE = Object.freeze({
    sky: '#5cd',
    ground: '#5a3a1a',
    grassTop: '#3b6',
    platform: '#8a5',
    goalPole: '#fff',
    goalFlag: '#d23',
  });

  function drawTile(ctx, ch, sx, sy, tileSize, charAbove, palette) {
    if (ch === '#') {
      ctx.fillStyle = palette.ground;
      ctx.fillRect(sx, sy, tileSize, tileSize);
      // Grass cap: only on the top exposed row.
      if (charAbove === '.' || charAbove === null) {
        ctx.fillStyle = palette.grassTop;
        ctx.fillRect(sx, sy, tileSize, 3);
      }
    } else if (ch === '=') {
      ctx.fillStyle = palette.platform;
      ctx.fillRect(sx, sy, tileSize, tileSize / 2);
    } else if (ch === 'G') {
      ctx.fillStyle = palette.goalPole;
      ctx.fillRect(sx + 6, sy, 2, tileSize);
      ctx.fillStyle = palette.goalFlag;
      ctx.fillRect(sx + 8, sy + 1, 6, 5);
    }
  }

  function createRenderer(config) {
    const cfg = config || {};
    if (!cfg.ctx) throw new TypeError('createRenderer: ctx is required');
    if (!cfg.viewport || typeof cfg.viewport.width !== 'number' || typeof cfg.viewport.height !== 'number') {
      throw new TypeError('createRenderer: viewport {width, height} is required');
    }
    if (!cfg.camera || typeof cfg.camera.getOffset !== 'function' || typeof cfg.camera.getParallaxOffset !== 'function') {
      throw new TypeError('createRenderer: camera with getOffset/getParallaxOffset is required');
    }
    if (!cfg.tilemap || typeof cfg.tilemap.charAt !== 'function') {
      throw new TypeError('createRenderer: tilemap with charAt is required');
    }

    const ctx = cfg.ctx;
    const viewport = { width: cfg.viewport.width, height: cfg.viewport.height };
    const camera = cfg.camera;
    const tilemap = cfg.tilemap;
    const palette = Object.assign({}, DEFAULT_TILE_PALETTE, cfg.palette || {});
    // Backgrounds are drawn in order; each layer can render either a flat
    // colour, a custom function (drawn at its parallax offset), or both.
    const backgrounds = Array.isArray(cfg.backgrounds) ? cfg.backgrounds.slice() : [
      { factor: 0, color: palette.sky },
    ];
    const drawPlayer = cfg.drawPlayer || (root.PlayerModule && root.PlayerModule.drawPlayer);
    if (typeof drawPlayer !== 'function') {
      throw new TypeError('createRenderer: drawPlayer is required (pass cfg.drawPlayer or load PlayerModule first)');
    }

    let stats = { drawCalls: 0, tilesDrawn: 0, totalTiles: 0, entitiesDrawn: 0 };

    function resetStats() {
      stats = { drawCalls: 0, tilesDrawn: 0, totalTiles: 0, entitiesDrawn: 0 };
    }

    function fillRect(x, y, w, h) {
      ctx.fillRect(x, y, w, h);
      stats.drawCalls++;
    }

    function clear() {
      // First background pass: full-viewport fill so the canvas resets
      // every frame even when no parallax layer covers it (sky default).
      if (typeof ctx.clearRect === 'function') {
        ctx.clearRect(0, 0, viewport.width, viewport.height);
      }
    }

    function renderBackgrounds() {
      for (let i = 0; i < backgrounds.length; i++) {
        const layer = backgrounds[i];
        const factor = typeof layer.factor === 'number' ? layer.factor : 0;
        if (layer.color) {
          ctx.fillStyle = layer.color;
          fillRect(0, 0, viewport.width, viewport.height);
        }
        if (typeof layer.draw === 'function') {
          const off = camera.getParallaxOffset(factor);
          layer.draw(ctx, { x: off.x, y: off.y }, viewport);
          stats.drawCalls++;
        }
      }
    }

    function renderTiles() {
      const offset = camera.getOffset();
      const ts = tilemap.tileSize;
      const cols = tilemap.cols;
      const rows = tilemap.rows;
      stats.totalTiles = cols * rows;

      // Margin of 1 tile so we never reveal a tile mid-scroll. floor/ceil
      // pair guarantees we cover all touched tiles even with sub-pixel
      // camera positions.
      const txMin = Math.max(0, Math.floor(offset.x / ts) - 1);
      const tyMin = Math.max(0, Math.floor(offset.y / ts) - 1);
      const txMax = Math.min(cols - 1, Math.ceil((offset.x + viewport.width) / ts) + 1);
      const tyMax = Math.min(rows - 1, Math.ceil((offset.y + viewport.height) / ts) + 1);

      for (let ty = tyMin; ty <= tyMax; ty++) {
        for (let tx = txMin; tx <= txMax; tx++) {
          const ch = tilemap.charAt(tx, ty);
          if (ch === '.') continue;
          const sx = Math.round(tx * ts - offset.x);
          const sy = Math.round(ty * ts - offset.y);
          const above = ty > 0 ? tilemap.charAt(tx, ty - 1) : '.';
          drawTile(ctx, ch, sx, sy, ts, above, palette);
          stats.tilesDrawn++;
          stats.drawCalls++;
        }
      }
    }

    function renderPlayer(player) {
      if (!player) return;
      const offset = camera.getOffset();
      // Clone with rounded screen coords so drawPlayer (which reads .x/.y)
      // renders at integer pixels regardless of the player's world position.
      const screenPlayer = Object.assign({}, player, {
        x: Math.round(player.x - offset.x),
        y: Math.round(player.y - offset.y),
      });
      drawPlayer(ctx, screenPlayer);
      stats.drawCalls++;
    }

    function renderEntities(entities) {
      if (!entities || !entities.length) return;
      const offset = camera.getOffset();
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e || typeof e.draw !== 'function') continue;
        const sx = Math.round((e.x || 0) - offset.x);
        const sy = Math.round((e.y || 0) - offset.y);
        e.draw(ctx, sx, sy, e);
        stats.drawCalls++;
        stats.entitiesDrawn++;
      }
    }

    // HUD is drawn last so it overlays everything. Screen-fixed: never
    // shifted by the camera offset.
    function renderHud(hud) {
      if (!hud) return;
      if ('font' in ctx) ctx.font = (hud.font || '10px monospace');
      ctx.fillStyle = hud.color || '#fff';
      const parts = [];
      if (hud.levelName) parts.push(hud.levelName.toUpperCase());
      if (hud.score != null) parts.push('SCORE ' + hud.score);
      if (hud.lives != null) parts.push('LIVES ' + hud.lives);
      const line = parts.join('   ');
      if (typeof ctx.fillText === 'function' && line) {
        ctx.fillText(line, hud.x != null ? hud.x : 4, hud.y != null ? hud.y : 12);
        stats.drawCalls++;
      }
    }

    function render(frame) {
      const f = frame || {};
      resetStats();
      clear();
      renderBackgrounds();
      renderTiles();
      renderEntities(f.entities);
      renderPlayer(f.player);
      renderHud(f.hud);
    }

    function getLastFrameStats() {
      return {
        drawCalls: stats.drawCalls,
        tilesDrawn: stats.tilesDrawn,
        totalTiles: stats.totalTiles,
        entitiesDrawn: stats.entitiesDrawn,
      };
    }

    return {
      render: render,
      getLastFrameStats: getLastFrameStats,
      // Internal helpers exposed so dependent modules / tests can stage
      // a single phase without running the whole frame.
      _renderBackgrounds: renderBackgrounds,
      _renderTiles: renderTiles,
      _renderPlayer: renderPlayer,
      _renderHud: renderHud,
      constants: Object.freeze({
        viewport: Object.freeze({ width: viewport.width, height: viewport.height }),
        tilePalette: Object.freeze(Object.assign({}, palette)),
      }),
    };
  }

  const api = {
    createRenderer: createRenderer,
    DEFAULT_TILE_PALETTE: DEFAULT_TILE_PALETTE,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RendererModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
