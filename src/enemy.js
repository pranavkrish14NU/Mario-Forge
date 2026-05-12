/**
 * Enemy — pooled enemy entities with patrol AI (WO-010, REQ-006 + REQ-004).
 *
 * Pool architecture:
 *   The pool pre-allocates `capacity` slots at construction time. spawn()
 *   activates the first inactive slot and despawn() flips it back. No new
 *   enemy objects are created during gameplay — this is the object-pooling
 *   discipline the architecture calls out for steady-state GC pauses.
 *
 * Two enemy types:
 *   - 'ground': walks left/right on a platform. Reverses direction when it
 *     hits a solid wall horizontally or when the next horizontal step would
 *     leave it walking off a platform edge (no solid tile beneath the step).
 *     The ledge check keeps it on the platform without a path-finder.
 *   - 'flying': moves horizontally in a sinusoidal pattern within a defined
 *     range around an anchor point. Pure position-based — no gravity.
 *
 * Proximity gating:
 *   update() skips enemies whose horizontal distance from the camera is
 *   greater than `cullDistanceFactor * viewport.width` (default 2 widths).
 *   Off-screen enemies hold position until they re-enter the wake band —
 *   prevents wasted simulation in long levels.
 *
 * Spawning from the level:
 *   parseSpawnsFromTilemap walks the tilemap and yields spawn descriptors
 *   for the 'g' (ground patrol) and 'f' (flying patrol) marker chars. The
 *   tilemap reports these as non-solid sensors via its existing tileAt
 *   contract; the renderer ignores them since they're not in its draw set.
 */
(function (root) {
  'use strict';

  const TYPE_GROUND = 'ground';
  const TYPE_FLYING = 'flying';
  const SPAWN_CHAR_GROUND = 'g';
  const SPAWN_CHAR_FLYING = 'f';

  const DEFAULTS = Object.freeze({
    capacity: 24,
    tileSize: 16,
    cullDistanceFactor: 2,
    groundWalkSpeed: 0.6,
    groundWidth: 16,
    groundHeight: 16,
    flyingAmplitude: 48,
    flyingFrequency: 0.05,
    flyingWidth: 16,
    flyingHeight: 12,
    animFrameInterval: 12,
  });

  // --------------------------------------------------------------------------
  // Sprite data — 16×16 (16×12 for flying) inline pixel arrays. Each row
  // string is mapped via CHAR_MAP to palette indices; 0 is transparent.
  // --------------------------------------------------------------------------
  const PALETTE = ['transparent', '#1a0e07', '#fff', '#3a1', '#724', '#bf3', '#5cd', '#fa3'];
  const CHAR_MAP = { '.': 0, K: 1, W: 2, G: 3, P: 4, L: 5, B: 6, O: 7 };

  function r(str, width) {
    const w = width || 16;
    const out = new Array(w);
    for (let i = 0; i < w; i++) {
      const ch = i < str.length ? str[i] : '.';
      out[i] = CHAR_MAP[ch] != null ? CHAR_MAP[ch] : 0;
    }
    return out;
  }
  function s16(rows) { return rows.flat(); }

  // Ground patrol — a green, two-legged walking blob with white eyes.
  const SPRITES_GROUND = [
    s16([
      r('................'),
      r('....KKKKKKKK....'),
      r('...KGGGGGGGGK...'),
      r('..KGGGGGGGGGGK..'),
      r('..KGWKGGGGKWGK..'),
      r('..KGWWGGGGWWGK..'),
      r('..KGGGGKKGGGGK..'),
      r('..KGGGGGGGGGGK..'),
      r('..KGGLLLLLLGGK..'),
      r('..KGGGGGGGGGGK..'),
      r('..KGGGGGGGGGGK..'),
      r('...KGGKKKKGGK...'),
      r('....KKK..KKK....'),
      r('................'),
      r('................'),
      r('................'),
    ]),
    s16([
      r('................'),
      r('....KKKKKKKK....'),
      r('...KGGGGGGGGK...'),
      r('..KGGGGGGGGGGK..'),
      r('..KGWKGGGGKWGK..'),
      r('..KGWWGGGGWWGK..'),
      r('..KGGGGKKGGGGK..'),
      r('..KGGGGGGGGGGK..'),
      r('..KGGLLLLLLGGK..'),
      r('..KGGGGGGGGGGK..'),
      r('..KGGGGGGGGGGK..'),
      r('....KKGGGGKK....'),
      r('...KKK....KKK...'),
      r('................'),
      r('................'),
      r('................'),
    ]),
  ];

  // Flying patrol — a purple bat-shape with cyan wings and orange eyes.
  // Drawn as 16 wide × 12 tall for a stubbier silhouette.
  const SPRITES_FLYING = [
    s16([
      r('................'),
      r('..B..........B..'),
      r('.BBB........BBB.'),
      r('BBBBBBBBBBBBBBBB'),
      r('.BPPPPPPPPPPPPB.'),
      r('..PPPOPPPPOPPP..'),
      r('..PPPPPPPPPPPP..'),
      r('..PPPPKKKKPPPP..'),
      r('...PPPPPPPPPP...'),
      r('....KKK..KKK....'),
      r('................'),
      r('................'),
    ]),
    s16([
      r('................'),
      r('.BB..........BB.'),
      r('BBBB........BBBB'),
      r('.BBBBBBBBBBBBBB.'),
      r('..BPPPPPPPPPPB..'),
      r('..PPPOPPPPOPPP..'),
      r('..PPPPPPPPPPPP..'),
      r('..PPPPKKKKPPPP..'),
      r('...PPPPPPPPPP...'),
      r('....KKK..KKK....'),
      r('................'),
      r('................'),
    ]),
  ];

  function drawEnemySprite(ctx, frame, dx, dy, w, h, facing) {
    const flip = facing === 'left';
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = frame[py * w + px];
        if (idx === 0) continue;
        const color = PALETTE[idx] || '#f0f';
        const sx = flip ? (w - 1) - px : px;
        ctx.fillStyle = color;
        ctx.fillRect(dx + sx, dy + py, 1, 1);
      }
    }
  }

  function drawEnemy(ctx, sx, sy, e) {
    const frames = e.type === TYPE_FLYING ? SPRITES_FLYING : SPRITES_GROUND;
    const frame = frames[e.animFrame % frames.length] || frames[0];
    drawEnemySprite(ctx, frame, sx, sy, e.w, e.h, e.facing);
  }

  // --------------------------------------------------------------------------
  // Pool
  // --------------------------------------------------------------------------

  function makeEnemySlot() {
    return {
      active: false,
      type: null,
      x: 0, y: 0,
      vx: 0, vy: 0,
      w: 0, h: 0,
      facing: 'right',
      animState: 'walk',
      animFrame: 0,
      animTimer: 0,
      // Type-specific parameters.
      walkSpeed: 0,
      anchorX: 0, anchorY: 0,
      amplitude: 0, frequency: 0,
      phase: 0,
      draw: drawEnemy,
    };
  }

  function createEnemyPool(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (cfg.capacity <= 0) throw new RangeError('createEnemyPool: capacity must be > 0');

    const pool = new Array(cfg.capacity);
    for (let i = 0; i < cfg.capacity; i++) pool[i] = makeEnemySlot();

    let allocations = 0; // grows only at construction — used by tests

    function findFreeSlot() {
      for (let i = 0; i < pool.length; i++) {
        if (!pool[i].active) return pool[i];
      }
      return null;
    }

    function resetGround(slot, x, y, opts) {
      slot.type = TYPE_GROUND;
      slot.x = x;
      slot.y = y;
      slot.w = (opts && opts.width) || cfg.groundWidth;
      slot.h = (opts && opts.height) || cfg.groundHeight;
      slot.walkSpeed = (opts && opts.walkSpeed) || cfg.groundWalkSpeed;
      slot.facing = (opts && opts.facing) || 'left';
      slot.vx = slot.facing === 'left' ? -slot.walkSpeed : slot.walkSpeed;
      slot.vy = 0;
      slot.amplitude = 0;
      slot.frequency = 0;
      slot.phase = 0;
      slot.anchorX = x;
      slot.anchorY = y;
      slot.animFrame = 0;
      slot.animTimer = 0;
    }

    function resetFlying(slot, x, y, opts) {
      slot.type = TYPE_FLYING;
      slot.x = x;
      slot.y = y;
      slot.w = (opts && opts.width) || cfg.flyingWidth;
      slot.h = (opts && opts.height) || cfg.flyingHeight;
      slot.amplitude = (opts && opts.amplitude) || cfg.flyingAmplitude;
      slot.frequency = (opts && opts.frequency) || cfg.flyingFrequency;
      slot.phase = (opts && opts.phase) || 0;
      slot.anchorX = x;
      slot.anchorY = y;
      slot.walkSpeed = 0;
      slot.vx = 0;
      slot.vy = 0;
      slot.facing = 'right';
      slot.animFrame = 0;
      slot.animTimer = 0;
    }

    function spawn(type, x, y, opts) {
      const slot = findFreeSlot();
      if (!slot) return null;
      slot.active = true;
      if (type === TYPE_FLYING) resetFlying(slot, x, y, opts);
      else resetGround(slot, x, y, opts);
      return slot;
    }

    function despawn(enemy) {
      if (!enemy) return;
      enemy.active = false;
      enemy.type = null;
    }

    function activeCount() {
      let n = 0;
      for (let i = 0; i < pool.length; i++) if (pool[i].active) n++;
      return n;
    }

    function getActive() {
      const out = [];
      for (let i = 0; i < pool.length; i++) if (pool[i].active) out.push(pool[i]);
      return out;
    }

    // Probe a single tile's solidity via the tilemap. Returns true when the
    // tile at the given pixel position is a solid platform/wall char.
    function isSolidAtPx(px, py) {
      const tm = cfg.tilemap;
      if (!tm) return false;
      const tx = Math.floor(px / cfg.tileSize);
      const ty = Math.floor(py / cfg.tileSize);
      const t = tm.tileAt(tx, ty);
      return !!(t && t.solid);
    }

    function updateGround(e) {
      const tile = cfg.tileSize;
      const nextX = e.x + e.vx;
      // Wall check — sample at the leading edge.
      const leadX = e.vx < 0 ? nextX : nextX + e.w;
      const midY = e.y + e.h / 2;
      if (isSolidAtPx(leadX, midY)) {
        e.vx = -e.vx;
        e.facing = e.vx < 0 ? 'left' : 'right';
        return; // don't move into a wall this frame
      }
      // Edge check — sample just below the leading foot of the NEXT step.
      const probeX = e.vx < 0 ? nextX + 1 : nextX + e.w - 1;
      const probeY = e.y + e.h + 1;
      if (cfg.tilemap && !isSolidAtPx(probeX, probeY)) {
        e.vx = -e.vx;
        e.facing = e.vx < 0 ? 'left' : 'right';
        return;
      }
      e.x = nextX;
    }

    function updateFlying(e) {
      e.phase += e.frequency;
      e.x = e.anchorX + Math.sin(e.phase) * e.amplitude;
      // Subtle vertical bob so it doesn't look pinned to one row — half the
      // amplitude, faster phase. Cheap and adds life.
      e.y = e.anchorY + Math.sin(e.phase * 2) * (e.amplitude * 0.1);
      e.facing = Math.cos(e.phase) >= 0 ? 'right' : 'left';
    }

    function inWakeBand(e, cameraOffsetX, viewportWidth) {
      const wake = viewportWidth * cfg.cullDistanceFactor;
      const cameraCenter = cameraOffsetX + viewportWidth / 2;
      return Math.abs((e.x + e.w / 2) - cameraCenter) <= wake;
    }

    function advanceAnimation(e) {
      e.animTimer++;
      if (e.animTimer >= cfg.animFrameInterval) {
        e.animTimer = 0;
        e.animFrame = (e.animFrame + 1) % 2;
      }
    }

    function update(context) {
      const c = context || {};
      const camOffX = (c.cameraOffset && c.cameraOffset.x) || 0;
      const vw = (c.viewport && c.viewport.width) || 0;
      for (let i = 0; i < pool.length; i++) {
        const e = pool[i];
        if (!e.active) continue;
        // Defeated enemies hold position while Combat plays their squish
        // animation and despawns them.
        if (e.defeated) continue;
        if (vw > 0 && !inWakeBand(e, camOffX, vw)) continue;
        if (e.type === TYPE_FLYING) updateFlying(e);
        else updateGround(e);
        advanceAnimation(e);
      }
    }

    function parseSpawnsFromTilemap(tm) {
      const out = [];
      if (!tm || typeof tm.charAt !== 'function') return out;
      for (let ty = 0; ty < tm.rows; ty++) {
        for (let tx = 0; tx < tm.cols; tx++) {
          const ch = tm.charAt(tx, ty);
          if (ch === SPAWN_CHAR_GROUND) {
            out.push({ type: TYPE_GROUND, x: tx * tm.tileSize, y: ty * tm.tileSize });
          } else if (ch === SPAWN_CHAR_FLYING) {
            out.push({ type: TYPE_FLYING, x: tx * tm.tileSize, y: ty * tm.tileSize });
          }
        }
      }
      return out;
    }

    function spawnAllFromTilemap(tm, opts) {
      const list = parseSpawnsFromTilemap(tm);
      const spawned = [];
      for (let i = 0; i < list.length; i++) {
        const s = spawn(list[i].type, list[i].x, list[i].y, opts);
        if (s) spawned.push(s);
        else break; // pool full
      }
      return spawned;
    }

    return {
      spawn: spawn,
      despawn: despawn,
      update: update,
      getActive: getActive,
      activeCount: activeCount,
      capacity: function () { return pool.length; },
      parseSpawnsFromTilemap: parseSpawnsFromTilemap,
      spawnAllFromTilemap: spawnAllFromTilemap,
      // Test hooks — expose internal pool ref so allocation-discipline tests
      // can verify slot reuse without the public API.
      _pool: pool,
      _allocations: function () { return allocations; },
      constants: Object.freeze(Object.assign({}, cfg, { tilemap: undefined })),
      SPRITES_GROUND: SPRITES_GROUND,
      SPRITES_FLYING: SPRITES_FLYING,
    };
  }

  const api = {
    createEnemyPool: createEnemyPool,
    drawEnemy: drawEnemy,
    SPRITES_GROUND: SPRITES_GROUND,
    SPRITES_FLYING: SPRITES_FLYING,
    PALETTE: PALETTE,
    DEFAULTS: DEFAULTS,
    TYPE_GROUND: TYPE_GROUND,
    TYPE_FLYING: TYPE_FLYING,
    SPAWN_CHAR_GROUND: SPAWN_CHAR_GROUND,
    SPAWN_CHAR_FLYING: SPAWN_CHAR_FLYING,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.EnemyModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
