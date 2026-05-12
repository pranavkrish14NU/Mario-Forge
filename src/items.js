/**
 * Items — coins + mystery blocks (WO-011, REQ-007 + REQ-008).
 *
 * Pools:
 *   - coin: up to 80 active slots, pre-allocated. spawnCoin() flips a slot
 *     active; update() animates the rotation cycle and AABB-tests vs the
 *     player; on collect, the slot deactivates and player.score += 100.
 *   - mystery: up to 16 slots tied to a (tx, ty) tile cell. tileAt(tx, ty)
 *     reports an unused-or-used mystery block as solid so the collision
 *     module behaves as if the cell is a normal solid tile; onCeilingHit
 *     turns an unused block into a "used" one, spawns a popup coin that
 *     auto-collects after a short rise, and is then idempotent for repeat
 *     hits.
 *
 * Renderer feed:
 *   getActive() returns the merged set of active coins + mystery blocks,
 *   each with a `draw(ctx, sx, sy, e)` function the Renderer's entities[]
 *   hook calls. No additional code in the Renderer is needed.
 *
 * Tilemap collaboration:
 *   tileAt(tx, ty) is meant to be composed with tilemap.tileAt() by the
 *   caller — a thin combinedTileAt wrapper in index.html lets collision
 *   treat mystery blocks as solid without baking them into the static
 *   tilemap.
 */
(function (root) {
  'use strict';

  const TYPE_COIN = 'coin';
  const TYPE_MYSTERY = 'mystery';
  const TYPE_POWERUP = 'powerup';
  const SPAWN_CHAR_COIN = 'c';
  const SPAWN_CHAR_MYSTERY = 'M';

  const DEFAULTS = Object.freeze({
    coinCapacity: 80,
    mysteryCapacity: 16,
    powerupCapacity: 8,
    tileSize: 16,
    coinScore: 100,
    coinFrameInterval: 6,        // ≈ 10 FPS spin
    mysteryFrameInterval: 10,    // gentle pulse
    popupRiseSpeed: 2.0,         // px / frame, popup coin moves up
    popupLifetimeFrames: 24,     // auto-collected after this
    powerupRiseSpeed: 1.0,       // float upward briefly before collectible
    powerupFloatFrames: 18,      // not yet collectible during this window
    powerupAnimInterval: 8,      // pulse
    mysteryHitInterval: 3,       // every Nth mystery hit yields a power-up
    poweredSize: 24,             // grown bounding box (1.5× of 16)
    normalSize: 16,
  });

  // --------------------------------------------------------------------------
  // Sprite data
  // --------------------------------------------------------------------------
  // Palette: 0=transparent, 1=outline, 2=white, 3=yellow, 4=brown,
  //          5=light orange, 6=dim, 7=cream, 8=power-up red, 9=power-up green
  const PALETTE = ['transparent', '#1a0e07', '#fff', '#fc3', '#a82', '#fa3', '#852', '#fff7c0', '#d23', '#3b6'];
  const CHAR_MAP = { '.': 0, K: 1, W: 2, Y: 3, B: 4, O: 5, D: 6, L: 7, R: 8, G: 9 };

  function r(str, width) {
    const w = width || 16;
    const out = new Array(w);
    for (let i = 0; i < w; i++) {
      const ch = i < str.length ? str[i] : '.';
      out[i] = CHAR_MAP[ch] != null ? CHAR_MAP[ch] : 0;
    }
    return out;
  }
  function flat(rows) { return rows.flat(); }

  // Coin — 4-frame spin cycle. Each frame shows the coin from a different
  // angle (front, three-quarter, edge, three-quarter mirrored).
  const SPRITES_COIN = [
    // Frame 0 — facing forward (round disc)
    flat([
      r('................'),
      r('................'),
      r('....KKKKKK......'),
      r('...KYYYYYYK.....'),
      r('..KYYLLLLYYK....'),
      r('..KYLLYYLLYYK...'),
      r('..KYLLYYLLYYK...'),
      r('..KYLLYYLLYYK...'),
      r('..KYLLYYLLYYK...'),
      r('..KYYLLLLYYK....'),
      r('...KYYYYYYK.....'),
      r('....KKKKKK......'),
      r('................'),
      r('................'),
      r('................'),
      r('................'),
    ]),
    // Frame 1 — three-quarter rotation (compressed horizontally)
    flat([
      r('................'),
      r('................'),
      r('.....KKKKK......'),
      r('....KYYYYYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYYYYYK.....'),
      r('.....KKKKK......'),
      r('................'),
      r('................'),
      r('................'),
      r('................'),
      r('................'),
    ]),
    // Frame 2 — edge-on (thin)
    flat([
      r('................'),
      r('................'),
      r('......KKK.......'),
      r('......KYK.......'),
      r('......KYK.......'),
      r('......KYK.......'),
      r('......KYK.......'),
      r('......KYK.......'),
      r('......KYK.......'),
      r('......KYK.......'),
      r('......KKK.......'),
      r('................'),
      r('................'),
      r('................'),
      r('................'),
      r('................'),
    ]),
    // Frame 3 — three-quarter mirrored
    flat([
      r('................'),
      r('................'),
      r('.....KKKKK......'),
      r('....KYYYYYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYLLLYK.....'),
      r('....KYYYYYK.....'),
      r('.....KKKKK......'),
      r('................'),
      r('................'),
      r('................'),
      r('................'),
      r('................'),
    ]),
  ];

  // Mystery block — 2-frame pulse (bright / dim) + 1 used frame.
  const SPRITES_MYSTERY_UNUSED = [
    flat([
      r('KKKKKKKKKKKKKKKK'),
      r('KOOOOOOOOOOOOOOK'),
      r('KOOLLLLLLLLLLOOK'),
      r('KOLLOOOOOOOOLLOK'),
      r('KOLLOOOLOOOOLLOK'),
      r('KOLLOOLOOOOOLLOK'),
      r('KOLLOOLOOOOOLLOK'),
      r('KOLLOOLLLLOOLLOK'),
      r('KOLLOOOOOLOOLLOK'),
      r('KOLLOOOOOLOOLLOK'),
      r('KOLLOOOOOLOOLLOK'),
      r('KOLLOOOLLLOOLLOK'),
      r('KOLLOOOOOOOOLLOK'),
      r('KOOLLLLLLLLLLOOK'),
      r('KOOOOOOOOOOOOOOK'),
      r('KKKKKKKKKKKKKKKK'),
    ]),
    flat([
      r('KKKKKKKKKKKKKKKK'),
      r('KOOOOOOOOOOOOOOK'),
      r('KOWWWWWWWWWWWWOK'),
      r('KOWLOOOOOOOOLWOK'),
      r('KOWLOOOLOOOOLWOK'),
      r('KOWLOOLOOOOOLWOK'),
      r('KOWLOOLOOOOOLWOK'),
      r('KOWLOOLLLLOOLWOK'),
      r('KOWLOOOOOLOOLWOK'),
      r('KOWLOOOOOLOOLWOK'),
      r('KOWLOOOOOLOOLWOK'),
      r('KOWLOOOLLLOOLWOK'),
      r('KOWLOOOOOOOOLWOK'),
      r('KOWWWWWWWWWWWWOK'),
      r('KOOOOOOOOOOOOOOK'),
      r('KKKKKKKKKKKKKKKK'),
    ]),
  ];

  const SPRITES_MYSTERY_USED = [
    flat([
      r('KKKKKKKKKKKKKKKK'),
      r('KDDDDDDDDDDDDDDK'),
      r('KDDDDDDDDDDDDDDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDD..........DDK'),
      r('KDDDDDDDDDDDDDDK'),
      r('KDDDDDDDDDDDDDDK'),
      r('KKKKKKKKKKKKKKKK'),
    ]),
  ];

  // Power-up — a mushroom-style item: red cap with cream spots, white stem.
  // Original design: 16×16, 2-frame pulse via dark-spot rotation.
  const SPRITES_POWERUP = [
    flat([
      r('................'),
      r('................'),
      r('....KKKKKKKK....'),
      r('...KRRRRRRRRK...'),
      r('..KRLLLRRLLLRK..'),
      r('..KRLLRRRRLLRK..'),
      r('..KRLLRRRRLLRK..'),
      r('..KRLLLRRLLLRK..'),
      r('..KRRRRRRRRRRK..'),
      r('..KKKKKKKKKKKK..'),
      r('...KWWWWWWWWK...'),
      r('....KWWWWWWK....'),
      r('....KWWWWWWK....'),
      r('....KWWWWWWK....'),
      r('....KKKKKKKK....'),
      r('................'),
    ]),
    flat([
      r('................'),
      r('................'),
      r('....KKKKKKKK....'),
      r('...KRRRRRRRRK...'),
      r('..KRRLLLLLLRRK..'),
      r('..KRLLLRRLLLRK..'),
      r('..KRLLLRRLLLRK..'),
      r('..KRRLLLLLLRRK..'),
      r('..KRRRRRRRRRRK..'),
      r('..KKKKKKKKKKKK..'),
      r('...KWWWWWWWWK...'),
      r('....KWWWWWWK....'),
      r('....KWWWWWWK....'),
      r('....KWWWWWWK....'),
      r('....KKKKKKKK....'),
      r('................'),
    ]),
  ];

  function drawSprite16(ctx, frame, dx, dy) {
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const idx = frame[py * 16 + px];
        if (idx === 0) continue;
        const color = PALETTE[idx] || '#f0f';
        ctx.fillStyle = color;
        ctx.fillRect(dx + px, dy + py, 1, 1);
      }
    }
  }

  function drawPowerup(ctx, sx, sy, e) {
    const frame = SPRITES_POWERUP[e.animFrame % SPRITES_POWERUP.length] || SPRITES_POWERUP[0];
    drawSprite16(ctx, frame, sx, sy);
  }

  function drawCoin(ctx, sx, sy, e) {
    const frame = SPRITES_COIN[e.animFrame % SPRITES_COIN.length] || SPRITES_COIN[0];
    drawSprite16(ctx, frame, sx, sy);
  }

  function drawMystery(ctx, sx, sy, e) {
    if (e.used) {
      drawSprite16(ctx, SPRITES_MYSTERY_USED[0], sx, sy);
      return;
    }
    const frame = SPRITES_MYSTERY_UNUSED[e.animFrame % SPRITES_MYSTERY_UNUSED.length] || SPRITES_MYSTERY_UNUSED[0];
    drawSprite16(ctx, frame, sx, sy);
  }

  // --------------------------------------------------------------------------
  // Pools
  // --------------------------------------------------------------------------

  function makeCoinSlot() {
    return {
      active: false,
      type: TYPE_COIN,
      x: 0, y: 0,
      w: 16, h: 16,
      vy: 0,
      animFrame: 0,
      animTimer: 0,
      isPopup: false,
      popupTimer: 0,
      draw: drawCoin,
    };
  }
  function makeMysterySlot() {
    return {
      active: false,
      type: TYPE_MYSTERY,
      x: 0, y: 0,
      w: 16, h: 16,
      tx: 0, ty: 0,
      used: false,
      animFrame: 0,
      animTimer: 0,
      draw: drawMystery,
    };
  }
  function makePowerupSlot() {
    return {
      active: false,
      type: TYPE_POWERUP,
      x: 0, y: 0,
      w: 16, h: 16,
      vy: 0,
      floatTimer: 0,
      collectable: false,
      animFrame: 0,
      animTimer: 0,
      draw: drawPowerup,
    };
  }

  function createItems(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (cfg.coinCapacity <= 0) throw new RangeError('createItems: coinCapacity must be > 0');
    if (cfg.mysteryCapacity <= 0) throw new RangeError('createItems: mysteryCapacity must be > 0');

    const coins = new Array(cfg.coinCapacity);
    for (let i = 0; i < cfg.coinCapacity; i++) coins[i] = makeCoinSlot();
    const mysteries = new Array(cfg.mysteryCapacity);
    for (let i = 0; i < cfg.mysteryCapacity; i++) mysteries[i] = makeMysterySlot();
    const powerups = new Array(cfg.powerupCapacity);
    for (let i = 0; i < cfg.powerupCapacity; i++) powerups[i] = makePowerupSlot();

    let mysteryHitCount = 0;

    // Fast index from (tx, ty) → mystery slot, for tileAt() solidity check.
    const mysteryByTile = new Map();
    function tileKey(tx, ty) { return tx + ',' + ty; }

    function findFree(pool) {
      for (let i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
      return null;
    }

    function spawnCoin(x, y, opts) {
      const slot = findFree(coins);
      if (!slot) return null;
      slot.active = true;
      slot.x = x;
      slot.y = y;
      slot.vy = (opts && opts.vy) || 0;
      slot.animFrame = 0;
      slot.animTimer = 0;
      slot.isPopup = !!(opts && opts.isPopup);
      slot.popupTimer = slot.isPopup ? cfg.popupLifetimeFrames : 0;
      return slot;
    }

    function spawnPowerup(x, y, opts) {
      const slot = findFree(powerups);
      if (!slot) return null;
      slot.active = true;
      slot.x = x;
      slot.y = y;
      slot.vy = -cfg.powerupRiseSpeed;
      slot.floatTimer = (opts && opts.floatFrames) || cfg.powerupFloatFrames;
      slot.collectable = false;
      slot.animFrame = 0;
      slot.animTimer = 0;
      return slot;
    }

    // Public for tests: apply / remove powered state on a player entity.
    // Symmetric: grow keeps feet on ground (y up by 8), revert lowers it.
    function applyPowerup(player) {
      if (!player || player.powered) return;
      player.powered = true;
      player.w = cfg.poweredSize;
      player.h = cfg.poweredSize;
      player.y -= (cfg.poweredSize - cfg.normalSize);
    }
    function removePowerup(player) {
      if (!player || !player.powered) return;
      player.powered = false;
      player.w = cfg.normalSize;
      player.h = cfg.normalSize;
      player.y += (cfg.poweredSize - cfg.normalSize);
    }

    function spawnMystery(x, y, opts) {
      const slot = findFree(mysteries);
      if (!slot) return null;
      slot.active = true;
      slot.x = x;
      slot.y = y;
      slot.tx = Math.floor(x / cfg.tileSize);
      slot.ty = Math.floor(y / cfg.tileSize);
      slot.used = !!(opts && opts.used);
      slot.animFrame = 0;
      slot.animTimer = 0;
      mysteryByTile.set(tileKey(slot.tx, slot.ty), slot);
      return slot;
    }

    function despawn(item) {
      if (!item) return;
      if (item.type === TYPE_MYSTERY) {
        mysteryByTile.delete(tileKey(item.tx, item.ty));
      }
      item.active = false;
    }

    // Composable with tilemap.tileAt — caller should fall back to tilemap
    // when this returns null.
    function tileAt(tx, ty) {
      const m = mysteryByTile.get(tileKey(tx, ty));
      if (!m || !m.active) return null;
      // Both used and unused mystery blocks remain solid platforms.
      return { solid: true, ch: SPAWN_CHAR_MYSTERY, type: 'mystery', used: m.used };
    }

    // Wraps a tilemap tile-query so collision treats mystery cells as solid.
    function combineTileQuery(tilemap) {
      return function (tx, ty) {
        const m = tileAt(tx, ty);
        if (m) return m;
        return tilemap.tileAt(tx, ty);
      };
    }

    // Called from collision.step's onCeiling callback. When a mystery block
    // is the ceiling that was hit, spend it: spawn either a popup coin
    // (most of the time) or a power-up (every mysteryHitInterval-th hit
    // across the whole pool). The block flips to used and subsequent hits
    // on the same tile are no-ops regardless.
    function onCeilingHit(entity, info) {
      if (!info) return null;
      const m = mysteryByTile.get(tileKey(info.tx, info.ty));
      if (!m || !m.active || m.used) return null;
      m.used = true;
      m.animFrame = 0;
      m.animTimer = 0;
      mysteryHitCount++;
      const isPowerupHit = (mysteryHitCount % cfg.mysteryHitInterval) === 0;
      if (isPowerupHit) {
        const power = spawnPowerup(m.x, m.y - cfg.tileSize);
        return { mystery: m, powerup: power, popup: null };
      }
      const popup = spawnCoin(m.x, m.y - cfg.tileSize, { isPopup: true, vy: -cfg.popupRiseSpeed });
      return { mystery: m, popup: popup, powerup: null };
    }

    function collectCoin(coin, player, onCoinCollected) {
      coin.active = false;
      if (player) player.score = (player.score || 0) + cfg.coinScore;
      if (typeof onCoinCollected === 'function') onCoinCollected(player, coin);
    }

    function aabbHit(a, b) {
      return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
      );
    }

    function advanceAnim(slot, interval, frameCount) {
      slot.animTimer++;
      if (slot.animTimer >= interval) {
        slot.animTimer = 0;
        slot.animFrame = (slot.animFrame + 1) % frameCount;
      }
    }

    function update(context) {
      const c = context || {};
      const player = c.player;

      // Animate + collect coins.
      for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        if (!coin.active) continue;
        advanceAnim(coin, cfg.coinFrameInterval, SPRITES_COIN.length);
        if (coin.isPopup) {
          coin.y += coin.vy;
          coin.popupTimer--;
          if (coin.popupTimer <= 0) {
            collectCoin(coin, player, c.onCoinCollected);
            continue;
          }
        }
        if (player && aabbHit(coin, player)) {
          collectCoin(coin, player, c.onCoinCollected);
        }
      }

      // Animate mystery blocks (used blocks stay on frame 0).
      for (let i = 0; i < mysteries.length; i++) {
        const m = mysteries[i];
        if (!m.active || m.used) continue;
        advanceAnim(m, cfg.mysteryFrameInterval, SPRITES_MYSTERY_UNUSED.length);
      }

      // Power-ups: rise during float window, become collectible, AABB-test
      // vs player. Collection applies the powered state.
      for (let i = 0; i < powerups.length; i++) {
        const p = powerups[i];
        if (!p.active) continue;
        advanceAnim(p, cfg.powerupAnimInterval, SPRITES_POWERUP.length);
        if (p.floatTimer > 0) {
          p.floatTimer--;
          p.y += p.vy;
        } else {
          // Settled — collectable. Slow drift to zero.
          p.vy = 0;
          p.collectable = true;
        }
        if (p.collectable && player && aabbHit(p, player)) {
          p.active = false;
          applyPowerup(player);
          if (typeof c.onPowerupCollected === 'function') c.onPowerupCollected(player, p);
        }
      }
    }

    function getActive() {
      const out = [];
      for (let i = 0; i < mysteries.length; i++) if (mysteries[i].active) out.push(mysteries[i]);
      for (let i = 0; i < powerups.length; i++) if (powerups[i].active) out.push(powerups[i]);
      for (let i = 0; i < coins.length; i++) if (coins[i].active) out.push(coins[i]);
      return out;
    }

    function activePowerupCount() {
      let n = 0;
      for (let i = 0; i < powerups.length; i++) if (powerups[i].active) n++;
      return n;
    }

    function activeCoinCount() {
      let n = 0;
      for (let i = 0; i < coins.length; i++) if (coins[i].active) n++;
      return n;
    }

    function activeMysteryCount() {
      let n = 0;
      for (let i = 0; i < mysteries.length; i++) if (mysteries[i].active) n++;
      return n;
    }

    function parseSpawnsFromTilemap(tm) {
      const out = [];
      if (!tm || typeof tm.charAt !== 'function') return out;
      for (let ty = 0; ty < tm.rows; ty++) {
        for (let tx = 0; tx < tm.cols; tx++) {
          const ch = tm.charAt(tx, ty);
          if (ch === SPAWN_CHAR_COIN) {
            out.push({ type: TYPE_COIN, x: tx * tm.tileSize, y: ty * tm.tileSize });
          } else if (ch === SPAWN_CHAR_MYSTERY) {
            out.push({ type: TYPE_MYSTERY, x: tx * tm.tileSize, y: ty * tm.tileSize });
          }
        }
      }
      return out;
    }

    function spawnAllFromTilemap(tm) {
      const list = parseSpawnsFromTilemap(tm);
      const spawned = [];
      for (let i = 0; i < list.length; i++) {
        const s = list[i].type === TYPE_MYSTERY
          ? spawnMystery(list[i].x, list[i].y)
          : spawnCoin(list[i].x, list[i].y);
        if (s) spawned.push(s);
      }
      return spawned;
    }

    return {
      spawnCoin: spawnCoin,
      spawnMystery: spawnMystery,
      spawnPowerup: spawnPowerup,
      applyPowerup: applyPowerup,
      removePowerup: removePowerup,
      despawn: despawn,
      update: update,
      onCeilingHit: onCeilingHit,
      tileAt: tileAt,
      combineTileQuery: combineTileQuery,
      parseSpawnsFromTilemap: parseSpawnsFromTilemap,
      spawnAllFromTilemap: spawnAllFromTilemap,
      getActive: getActive,
      activeCoinCount: activeCoinCount,
      activeMysteryCount: activeMysteryCount,
      activePowerupCount: activePowerupCount,
      coinCapacity: function () { return coins.length; },
      mysteryCapacity: function () { return mysteries.length; },
      powerupCapacity: function () { return powerups.length; },
      // Test hooks
      _coins: coins,
      _mysteries: mysteries,
      _powerups: powerups,
      _mysteryHitCount: function () { return mysteryHitCount; },
      constants: Object.freeze(Object.assign({}, cfg)),
      SPRITES_COIN: SPRITES_COIN,
      SPRITES_MYSTERY_UNUSED: SPRITES_MYSTERY_UNUSED,
      SPRITES_MYSTERY_USED: SPRITES_MYSTERY_USED,
      SPRITES_POWERUP: SPRITES_POWERUP,
    };
  }

  const api = {
    createItems: createItems,
    drawCoin: drawCoin,
    drawMystery: drawMystery,
    drawPowerup: drawPowerup,
    SPRITES_COIN: SPRITES_COIN,
    SPRITES_MYSTERY_UNUSED: SPRITES_MYSTERY_UNUSED,
    SPRITES_MYSTERY_USED: SPRITES_MYSTERY_USED,
    SPRITES_POWERUP: SPRITES_POWERUP,
    DEFAULTS: DEFAULTS,
    TYPE_COIN: TYPE_COIN,
    TYPE_MYSTERY: TYPE_MYSTERY,
    TYPE_POWERUP: TYPE_POWERUP,
    SPAWN_CHAR_COIN: SPAWN_CHAR_COIN,
    SPAWN_CHAR_MYSTERY: SPAWN_CHAR_MYSTERY,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ItemsModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
