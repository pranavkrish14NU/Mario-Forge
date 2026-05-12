/**
 * Collision — AABB collision detection and per-axis resolution against a
 * tile map (WO-005).
 *
 * Per-axis resolution:
 *   We integrate movement on X and Y separately, snapping the entity back
 *   to the offending tile edge before integrating the other axis. Without
 *   this split, a diagonal slide into an inside corner gets ambiguous and
 *   the entity sticks or tunnels.
 *
 * Entity contract:
 *   Plain objects with shape { x, y, w, h, vx, vy, onGround? }. We mutate
 *   x/y/vx/vy/onGround and never touch other properties — keeps Collision
 *   reusable for player, enemies, projectiles.
 *
 * Tile-map plug:
 *   Callers pass a `tileQuery(tileX, tileY)` function returning either null
 *   (empty space) or an object whose `.solid` field decides whether the
 *   entity stops on it. The data structure behind it (2D array, hash map,
 *   chunks…) is owned by WO-007 — Collision doesn't care.
 *
 * Spatial query:
 *   We only test the small set of tiles the entity's AABB currently overlaps
 *   (typically 4 tiles for a 16×16 entity on a 16×16 grid). Cost is O(1) per
 *   step regardless of map size (AC6).
 */
(function (root) {
  'use strict';

  function aabbOverlap(a, b) {
    if (!a || !b) throw new TypeError('aabbOverlap: a and b are required');
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function createCollision(options) {
    const cfg = Object.assign({ tileSize: 16 }, options || {});
    const tileSize = cfg.tileSize;

    function tileBounds(entity) {
      // Inclusive tile range the entity's AABB overlaps. Subtract 1 epsilon
      // on the trailing edge so an entity perfectly aligned to a tile
      // boundary doesn't claim to overlap the next tile over.
      return {
        x0: Math.floor(entity.x / tileSize),
        y0: Math.floor(entity.y / tileSize),
        x1: Math.floor((entity.x + entity.w - 0.0001) / tileSize),
        y1: Math.floor((entity.y + entity.h - 0.0001) / tileSize),
      };
    }

    // Returns true if any tile in the entity's footprint is solid.
    function isOverlappingSolid(entity, tileQuery) {
      const b = tileBounds(entity);
      for (let ty = b.y0; ty <= b.y1; ty++) {
        for (let tx = b.x0; tx <= b.x1; tx++) {
          const t = tileQuery(tx, ty);
          if (t && t.solid) return { tx: tx, ty: ty, tile: t };
        }
      }
      return null;
    }

    // Sub-stepped integration prevents tunneling when an entity's per-frame
    // velocity exceeds tileSize. Each sub-step moves at most one tile, then
    // re-tests for overlap. Bounded by ceil(|v| / tileSize) iterations.
    function resolveX(entity, vx, tileQuery, callbacks) {
      if (vx === 0) return;
      let remaining = vx;
      while (remaining !== 0) {
        const stepMag = Math.min(Math.abs(remaining), tileSize);
        const step = Math.sign(remaining) * stepMag;
        entity.x += step;
        remaining -= step;
        const hit = isOverlappingSolid(entity, tileQuery);
        if (!hit) continue;
        if (step > 0) {
          entity.x = hit.tx * tileSize - entity.w;
        } else {
          entity.x = (hit.tx + 1) * tileSize;
        }
        entity.vx = 0;
        if (callbacks && callbacks.onWall) {
          callbacks.onWall(entity, { tx: hit.tx, ty: hit.ty, side: vx > 0 ? 'right' : 'left' });
        }
        return;
      }
    }

    function resolveY(entity, vy, tileQuery, callbacks) {
      if (vy === 0) return;
      let remaining = vy;
      while (remaining !== 0) {
        const stepMag = Math.min(Math.abs(remaining), tileSize);
        const step = Math.sign(remaining) * stepMag;
        entity.y += step;
        remaining -= step;
        const hit = isOverlappingSolid(entity, tileQuery);
        if (!hit) continue;
        if (step > 0) {
          entity.y = hit.ty * tileSize - entity.h;
          entity.vy = 0;
          entity.onGround = true;
          if (callbacks && callbacks.onLand) callbacks.onLand(entity, { tx: hit.tx, ty: hit.ty });
        } else {
          entity.y = (hit.ty + 1) * tileSize;
          entity.vy = 0;
          if (callbacks && callbacks.onCeiling) callbacks.onCeiling(entity, { tx: hit.tx, ty: hit.ty });
        }
        return;
      }
    }

    function step(entity, tileQuery, callbacks) {
      if (!entity) throw new TypeError('Collision.step: entity is required');
      if (typeof tileQuery !== 'function') {
        throw new TypeError('Collision.step: tileQuery must be a function');
      }

      const vx = entity.vx || 0;
      const vy = entity.vy || 0;

      // Per-axis: X first then Y. Order matters for diagonal-into-corner
      // resolution — by resolving X first, an entity moving right+down into
      // a floor tile will stop on the floor (Y-resolve) instead of getting
      // pushed sideways. Most platformers prefer X-first so the player can
      // slide along walls while falling.
      resolveX(entity, vx, tileQuery, callbacks);

      // Reset before the Y step. If we end up not landing, onGround stays
      // false — which produces the "walk off ledge" behavior (AC4).
      const wasOnGround = entity.onGround;
      entity.onGround = false;
      resolveY(entity, vy, tileQuery, callbacks);

      // If we didn't move in Y and we were on ground, do a 1-pixel probe
      // downward to check we're still standing on something. Otherwise an
      // entity standing still on a platform would lose onGround the moment
      // it stops integrating Y.
      if (vy === 0 && wasOnGround) {
        const probe = { x: entity.x, y: entity.y + 1, w: entity.w, h: entity.h };
        if (isOverlappingSolid(probe, tileQuery)) entity.onGround = true;
      }
    }

    return {
      step: step,
      resolveX: resolveX,
      resolveY: resolveY,
      isOverlappingSolid: isOverlappingSolid,
      tileBounds: tileBounds,
      constants: Object.freeze({ tileSize: tileSize }),
    };
  }

  const api = {
    createCollision: createCollision,
    aabbOverlap: aabbOverlap,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CollisionModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
