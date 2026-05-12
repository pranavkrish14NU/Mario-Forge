/**
 * Physics — fixed-timestep velocity integration with gravity, friction,
 * acceleration clamping, terminal velocity, and variable-height jumping.
 *
 * Timestep contract:
 *   Constants are tuned for 60fps (16.67ms / frame). update(entity, dt) takes
 *   a dt expressed as fractions of one fixed step — pass 1 each frame in a
 *   normal game loop. Sub-stepping is supported but not required.
 *
 * Entity contract:
 *   Physics mutates plain objects with shape { x, y, vx, vy, ax?, ay? }.
 *   Missing ax/ay are treated as 0. The module never reads or writes any
 *   other property — keeps it reusable for player, enemies, projectiles.
 *
 * Why ax-driven horizontal motion:
 *   When ax is non-zero (input pressed) we integrate acceleration so peak
 *   speed is reached over 8–12 frames (AC5). When ax is zero we apply a
 *   per-frame friction multiplier so velocity decays to zero within ~10
 *   frames (AC1). The two paths are mutually exclusive: friction would
 *   fight acceleration if applied together, producing a sluggish feel.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    gravity: 0.5,
    terminalVelocityY: 8,
    friction: 0.65,
    stopThreshold: 0.1,
    maxSpeedX: 3,
    jumpVelocity: 12,
    jumpCutFactor: 0.4,
  });

  function createPhysics(options) {
    const cfg = Object.assign({}, DEFAULTS, options || {});

    function update(entity, dt) {
      if (!entity) throw new TypeError('Physics.update: entity is required');
      const step = dt == null ? 1 : dt;

      const ax = entity.ax || 0;
      const ay = entity.ay || 0;

      // Horizontal: accel when input present, friction when idle.
      if (ax !== 0) {
        entity.vx += ax * step;
      } else {
        // Per-frame friction; raised to the step power so sub-stepping
        // produces the same exponential decay as full-frame updates.
        entity.vx *= Math.pow(cfg.friction, step);
        if (Math.abs(entity.vx) < cfg.stopThreshold) entity.vx = 0;
      }

      // Clamp horizontal speed.
      if (entity.vx > cfg.maxSpeedX) entity.vx = cfg.maxSpeedX;
      else if (entity.vx < -cfg.maxSpeedX) entity.vx = -cfg.maxSpeedX;

      // Vertical: gravity + any explicit ay (e.g., wind, water).
      entity.vy += (cfg.gravity + ay) * step;
      if (entity.vy > cfg.terminalVelocityY) entity.vy = cfg.terminalVelocityY;

      // Integrate position last so velocity changes apply this frame.
      entity.x += entity.vx * step;
      entity.y += entity.vy * step;
    }

    function jump(entity) {
      if (!entity) throw new TypeError('Physics.jump: entity is required');
      entity.vy = -cfg.jumpVelocity;
    }

    // Variable-height jump: clamps upward velocity when the jump key is
    // released early. Lets the player short-hop by tapping vs. holding.
    function cutJump(entity) {
      if (!entity) throw new TypeError('Physics.cutJump: entity is required');
      const cutCap = -cfg.jumpVelocity * cfg.jumpCutFactor;
      if (entity.vy < cutCap) entity.vy = cutCap;
    }

    return {
      update: update,
      jump: jump,
      cutJump: cutJump,
      constants: Object.freeze(Object.assign({}, cfg)),
    };
  }

  const api = {
    createPhysics: createPhysics,
    DEFAULTS: DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PhysicsModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
