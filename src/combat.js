/**
 * Combat — player↔enemy interaction layer (WO-012, REQ-002/006/012).
 *
 * Stomp detection:
 *   A stomp is registered when (a) the player and enemy AABBs overlap, AND
 *   (b) the player's vy is positive (falling), AND (c) the player's bottom
 *   edge is inside the top `stompTopFraction` of the enemy's hitbox. Side
 *   and below contacts therefore can never trigger a stomp by accident
 *   even on the same frame as a brushing collision.
 *
 * Damage + invincibility:
 *   Non-stomp contact while not invincible reduces the player's `lives` by
 *   1, sets an `invincibilityTimer` (default 120 frames = 2s at 60fps), and
 *   gives the player a brief upward bounce so they don't immediately re-
 *   collide. During invincibility the module toggles `player.visible` every
 *   `flashInterval` frames so the renderer can flicker the sprite.
 *
 * Squish anim:
 *   A defeated enemy is flagged `defeated = true`, has its render swapped
 *   to a squashed-half-height sprite, and is despawned from the pool after
 *   `squishDurationFrames`. The Enemy module skips defeated enemies in its
 *   own update loop so they don't continue patrolling.
 *
 * Game over:
 *   When lives reach 0, the module calls `stateManager.changeScene('gameOver')`
 *   exactly once (guarded so multiple damage events on the same death frame
 *   don't fire the transition repeatedly).
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    stompTopFraction: 0.25,
    stompBounceVelocity: 8,
    stompScore: 200,
    damageBounceVelocity: 6,
    invincibilityFrames: 120,
    flashInterval: 4,
    squishDurationFrames: 18,
    gameOverScene: 'gameOver',
  });

  function aabbOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  // Replaces the active enemy's `draw` function with one that squashes the
  // sprite vertically. Cheap "squish" effect — every other row is skipped
  // and the visual is anchored to the bottom of the original tile.
  function makeSquishedDraw(originalDraw) {
    return function (ctx, sx, sy, e) {
      // Draw at squished height: vertical scale 0.5 by translating the
      // origin down and clipping rows. We delegate to the original draw
      // function by routing every column through it via a custom ctx that
      // skips alternate y rows. Simpler: write rectangles manually — but
      // the cheapest visual is just a flat block.
      ctx.fillStyle = e.squishColor || '#724';
      ctx.fillRect(sx, sy + e.h / 2, e.w, e.h / 2);
      // Outline (matches the K palette key in enemy sprites).
      ctx.fillStyle = '#1a0e07';
      ctx.fillRect(sx, sy + e.h / 2, e.w, 1);
      ctx.fillRect(sx, sy + e.h - 1, e.w, 1);
      ctx.fillRect(sx, sy + e.h / 2, 1, e.h / 2);
      ctx.fillRect(sx + e.w - 1, sy + e.h / 2, 1, e.h / 2);
      // Reference originalDraw to keep the param meaningful for inspection.
      e._squishedFrom = originalDraw;
    };
  }

  function createCombat(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});

    function applyStomp(player, enemy, pool, hooks) {
      enemy.defeated = true;
      enemy.squishTimer = cfg.squishDurationFrames;
      enemy.h = Math.max(8, Math.floor(enemy.h / 2));
      enemy.draw = makeSquishedDraw(enemy.draw);
      player.vy = -cfg.stompBounceVelocity;
      player.score = (player.score || 0) + cfg.stompScore;
      if (hooks && hooks.onStomp) hooks.onStomp(player, enemy);
    }

    function applyDamage(player, hooks) {
      player.lives = Math.max(0, (player.lives || 0) - 1);
      player.vy = -cfg.damageBounceVelocity;
      state.invincibilityTimer = cfg.invincibilityFrames;
      state.flashCounter = 0;
      player.visible = true;
      if (hooks && hooks.onDamage) hooks.onDamage(player);
    }

    const state = {
      invincibilityTimer: 0,
      flashCounter: 0,
      gameOverFired: false,
    };

    function isInvincible() {
      return state.invincibilityTimer > 0;
    }

    function detectStomp(player, enemy) {
      // Falling AND player's bottom inside the top fraction of enemy's hitbox.
      if (player.vy <= 0) return false;
      const playerBottom = player.y + player.h;
      const stompBandBottom = enemy.y + enemy.h * cfg.stompTopFraction;
      return playerBottom <= stompBandBottom + 0.5; // tiny tolerance
    }

    function update(context) {
      const c = context || {};
      const player = c.player;
      if (!player) return;

      // Tick invincibility and flicker. Visibility is computed BEFORE the
      // counter increments so the first `flashInterval` frames after damage
      // are visible — gives the flash a clean rhythm aligned to the damage
      // frame rather than starting mid-window.
      if (state.invincibilityTimer > 0) {
        player.visible = Math.floor(state.flashCounter / cfg.flashInterval) % 2 === 0;
        state.flashCounter++;
        state.invincibilityTimer--;
        if (state.invincibilityTimer <= 0) {
          player.visible = true;
          state.flashCounter = 0;
        }
      } else if (player.visible === undefined) {
        player.visible = true;
      }

      const pool = c.pool;
      const enemies = c.enemies || (pool && pool.getActive());
      if (enemies) {
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (!e || !e.active) continue;

          // Tick squish despawn first — defeated enemies don't damage.
          if (e.defeated) {
            e.squishTimer = (e.squishTimer || 0) - 1;
            if (e.squishTimer <= 0 && pool) pool.despawn(e);
            continue;
          }

          if (!aabbOverlap(player, e)) continue;
          if (detectStomp(player, e)) {
            applyStomp(player, e, pool, c.hooks);
          } else if (!isInvincible()) {
            applyDamage(player, c.hooks);
          }
        }
      }

      // Game over once lives hit zero (idempotent).
      if (!state.gameOverFired && player.lives === 0 && c.stateManager &&
          typeof c.stateManager.changeScene === 'function') {
        state.gameOverFired = true;
        try {
          c.stateManager.changeScene(cfg.gameOverScene);
        } catch (err) {
          // Allow callers without the gameOver scene registered to no-op.
          state.gameOverFired = false;
        }
      }
    }

    function reset() {
      state.invincibilityTimer = 0;
      state.flashCounter = 0;
      state.gameOverFired = false;
    }

    return {
      update: update,
      reset: reset,
      isInvincible: isInvincible,
      detectStomp: detectStomp,
      _state: state,
      constants: Object.freeze(Object.assign({}, cfg)),
    };
  }

  const api = {
    createCombat: createCombat,
    DEFAULTS: DEFAULTS,
    aabbOverlap: aabbOverlap,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CombatModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
