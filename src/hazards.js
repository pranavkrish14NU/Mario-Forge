/**
 * Hazards — spikes, pit-fall death, moving platforms (WO-014, REQ-015 + REQ-026).
 *
 * Spikes:
 *   Non-solid sensor tiles. The player walks through them physically but the
 *   `spikeContact(player, tilemap)` helper returns true when the player's
 *   AABB overlaps any tile char === 's'. The caller routes this through the
 *   same damage path used for enemy side-hits.
 *
 * Pit death:
 *   `pitFall(player, level)` returns true when the player's top edge has
 *   passed the level's pixelHeight. Caller is responsible for the lose-life
 *   and respawn — checkpoint logic itself is WO-017's territory.
 *
 * Moving platforms:
 *   Lightweight entity pool with two path types — 'horizontal' (back-and-
 *   forth along x) and 'vertical' (up-and-down along y). Each platform is
 *   `width` × tile-height with a `direction` flag flipping at `range` from
 *   the anchor. Platforms are SOLID via tileAt(tx, ty) overlay against the
 *   collision module — same composition trick the Items module uses for
 *   mystery blocks. Player-carry: after the platform moves, the helper
 *   `carryPlayerOnPlatform(player, platform, dt)` advances the player's x/y
 *   by the platform's frame delta if the player is standing on top.
 *
 * Spawn chars:
 *   's' — spike tile (rendered by the Renderer's drawTile path)
 *   'h' — horizontal moving platform anchor (left edge)
 *   'v' — vertical moving platform anchor (top edge)
 */
(function (root) {
  'use strict';

  const SPIKE_CHAR = 's';
  const HORIZONTAL_CHAR = 'h';
  const VERTICAL_CHAR = 'v';

  const DEFAULTS = Object.freeze({
    tileSize: 16,
    platformCapacity: 8,
    platformWidth: 32,   // 2 tiles wide
    platformHeight: 8,   // half tile tall
    horizontalRange: 48, // ±48px from anchor
    verticalRange: 32,
    platformSpeed: 0.75,
  });

  function aabbOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function makePlatformSlot() {
    return {
      active: false,
      type: 'platform',
      pathType: HORIZONTAL_CHAR,
      x: 0, y: 0,
      w: 0, h: 0,
      anchorX: 0, anchorY: 0,
      range: 0,
      speed: 0,
      direction: 1, // +1 / -1
      lastDx: 0, lastDy: 0,
      draw: drawPlatform,
    };
  }

  function drawPlatform(ctx, sx, sy, e) {
    // Pixel-art block: dark base, lighter top stripe.
    ctx.fillStyle = '#62b';
    ctx.fillRect(sx, sy, e.w, e.h);
    ctx.fillStyle = '#9c5';
    ctx.fillRect(sx, sy, e.w, 2);
    // Side caps.
    ctx.fillStyle = '#1a0e07';
    ctx.fillRect(sx, sy + e.h - 1, e.w, 1);
    ctx.fillRect(sx, sy, 1, e.h);
    ctx.fillRect(sx + e.w - 1, sy, 1, e.h);
  }

  function createHazards(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});

    const platforms = new Array(cfg.platformCapacity);
    for (let i = 0; i < cfg.platformCapacity; i++) platforms[i] = makePlatformSlot();

    function findFree() {
      for (let i = 0; i < platforms.length; i++) if (!platforms[i].active) return platforms[i];
      return null;
    }

    function spawnPlatform(pathType, x, y, opts) {
      const slot = findFree();
      if (!slot) return null;
      slot.active = true;
      slot.pathType = (pathType === VERTICAL_CHAR) ? VERTICAL_CHAR : HORIZONTAL_CHAR;
      slot.x = x;
      slot.y = y;
      slot.anchorX = x;
      slot.anchorY = y;
      slot.w = (opts && opts.width) || cfg.platformWidth;
      slot.h = (opts && opts.height) || cfg.platformHeight;
      slot.range = (opts && opts.range) ||
        (slot.pathType === VERTICAL_CHAR ? cfg.verticalRange : cfg.horizontalRange);
      slot.speed = (opts && opts.speed) || cfg.platformSpeed;
      slot.direction = (opts && opts.direction) || 1;
      slot.lastDx = 0;
      slot.lastDy = 0;
      return slot;
    }

    function despawnPlatform(p) {
      if (!p) return;
      p.active = false;
    }

    // Spike sensor — returns true if the player's AABB overlaps any spike
    // tile in its footprint. Uses `tilemap.charAt` which exists since WO-007.
    function spikeContact(entity, tilemap) {
      if (!tilemap || typeof tilemap.charAt !== 'function') return false;
      const ts = tilemap.tileSize || cfg.tileSize;
      const tx0 = Math.floor(entity.x / ts);
      const ty0 = Math.floor(entity.y / ts);
      const tx1 = Math.floor((entity.x + entity.w - 0.0001) / ts);
      const ty1 = Math.floor((entity.y + entity.h - 0.0001) / ts);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (tilemap.charAt(tx, ty) === SPIKE_CHAR) return true;
        }
      }
      return false;
    }

    function pitFall(entity, level) {
      if (!level || typeof level.pixelHeight !== 'number') return false;
      return entity.y > level.pixelHeight;
    }

    function updatePlatforms() {
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (!p.active) continue;
        if (p.pathType === HORIZONTAL_CHAR) {
          const nextX = p.x + p.speed * p.direction;
          if (nextX > p.anchorX + p.range) {
            p.x = p.anchorX + p.range;
            p.direction = -1;
          } else if (nextX < p.anchorX - p.range) {
            p.x = p.anchorX - p.range;
            p.direction = 1;
          } else {
            p.lastDx = nextX - p.x;
            p.lastDy = 0;
            p.x = nextX;
            continue;
          }
          p.lastDx = p.x - (p.x - p.speed * (-p.direction));
          p.lastDy = 0;
        } else {
          const nextY = p.y + p.speed * p.direction;
          if (nextY > p.anchorY + p.range) {
            p.y = p.anchorY + p.range;
            p.direction = -1;
          } else if (nextY < p.anchorY - p.range) {
            p.y = p.anchorY - p.range;
            p.direction = 1;
          } else {
            p.lastDx = 0;
            p.lastDy = nextY - p.y;
            p.y = nextY;
            continue;
          }
          p.lastDx = 0;
          p.lastDy = p.y - (p.y - p.speed * (-p.direction));
        }
      }
    }

    // Player rides a platform when its feet sit on the top edge. The
    // landing band is widened by the platform's frame delta (lastDy) so a
    // vertically-moving platform doesn't slip out from under a player whose
    // bottom was at the platform's previous top before this frame's move.
    function resolvePlayerOnPlatforms(player) {
      let landed = false;
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (!p.active) continue;
        if (player.vy >= 0) {
          const playerBottom = player.y + player.h;
          const platformTop = p.y;
          // Window above the platform: catches landings when the platform
          // moved away vertically this frame.
          const lookback = Math.abs(p.lastDy) + 1;
          // Window below: catches the player descending into the platform.
          const overshoot = Math.max(2, Math.abs(player.vy)) + 2;
          if (
            playerBottom >= platformTop - lookback &&
            playerBottom <= platformTop + overshoot &&
            player.x + player.w > p.x &&
            player.x < p.x + p.w
          ) {
            player.y = platformTop - player.h;
            player.vy = 0;
            player.onGround = true;
            player.x += p.lastDx;
            player.y += p.lastDy;
            landed = true;
          }
        }
      }
      return landed;
    }

    function getActive() {
      const out = [];
      for (let i = 0; i < platforms.length; i++) if (platforms[i].active) out.push(platforms[i]);
      return out;
    }

    function activePlatformCount() {
      let n = 0;
      for (let i = 0; i < platforms.length; i++) if (platforms[i].active) n++;
      return n;
    }

    function parseSpawnsFromTilemap(tm) {
      const out = [];
      if (!tm || typeof tm.charAt !== 'function') return out;
      for (let ty = 0; ty < tm.rows; ty++) {
        for (let tx = 0; tx < tm.cols; tx++) {
          const ch = tm.charAt(tx, ty);
          if (ch === HORIZONTAL_CHAR || ch === VERTICAL_CHAR) {
            out.push({ pathType: ch, x: tx * tm.tileSize, y: ty * tm.tileSize });
          }
        }
      }
      return out;
    }

    function spawnAllFromTilemap(tm) {
      const list = parseSpawnsFromTilemap(tm);
      const spawned = [];
      for (let i = 0; i < list.length; i++) {
        const p = spawnPlatform(list[i].pathType, list[i].x, list[i].y);
        if (p) spawned.push(p);
      }
      return spawned;
    }

    function update(context) {
      updatePlatforms();
      if (context && context.player) {
        resolvePlayerOnPlatforms(context.player);
      }
    }

    return {
      spawnPlatform: spawnPlatform,
      despawnPlatform: despawnPlatform,
      update: update,
      updatePlatforms: updatePlatforms,
      resolvePlayerOnPlatforms: resolvePlayerOnPlatforms,
      spikeContact: spikeContact,
      pitFall: pitFall,
      getActive: getActive,
      activePlatformCount: activePlatformCount,
      platformCapacity: function () { return platforms.length; },
      parseSpawnsFromTilemap: parseSpawnsFromTilemap,
      spawnAllFromTilemap: spawnAllFromTilemap,
      _platforms: platforms,
      constants: Object.freeze(Object.assign({}, cfg)),
    };
  }

  const api = {
    createHazards: createHazards,
    drawPlatform: drawPlatform,
    aabbOverlap: aabbOverlap,
    DEFAULTS: DEFAULTS,
    SPIKE_CHAR: SPIKE_CHAR,
    HORIZONTAL_CHAR: HORIZONTAL_CHAR,
    VERTICAL_CHAR: VERTICAL_CHAR,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.HazardsModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
