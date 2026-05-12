/**
 * Player — entity + controller + sprite data (WO-006 minimal integration).
 *
 * This is the integration spike version: a small subset of WO-006's scope
 * sufficient to make the game playable. Full sprite art, death animations,
 * lives system, etc. are owned by their own work orders.
 *
 * Architecture:
 *   - createPlayer() returns a plain entity object the Physics & Collision
 *     modules can mutate (x, y, w, h, vx, vy, ax, ay, onGround).
 *   - createPlayerController({ input, physics }) returns an update(player)
 *     function that reads the polling Input module and writes intent
 *     (acceleration, jump) onto the entity. Physics then integrates.
 *   - PLAYER_SPRITES are inline color arrays — no external images.
 *
 * Coyote time & jump buffering: small "grace windows" that make jumping
 * feel fair. Coyote = remember-onGround-for-N-frames-after-leaving so the
 * player can still jump just after stepping off a ledge. Buffer = remember
 * jump-press-for-N-frames so a slightly-early press still triggers a jump
 * on landing.
 */
(function (root) {
  'use strict';

  // 16×16 pixel-art sprites, defined as arrays of palette indices.
  // 0 = transparent. Other indices reference PALETTE below.
  const PALETTE = ['transparent', '#1a0e07', '#fff', '#d23', '#fa3', '#3b6', '#5cd', '#724'];

  function s(rows) {
    // Helper to flatten a 16×16 row spec into a single 256-entry array.
    return rows.flat();
  }

  // Each row is 16 indices. Below uses compact char shorthand mapped via
  // makeRow() so the art is legible inline. Letters: . transparent,
  // K=1 outline, W=2 white, R=3 red, O=4 orange, G=5 green, B=6 blue, P=7 purple.
  const CHAR_MAP = { '.': 0, K: 1, W: 2, R: 3, O: 4, G: 5, B: 6, P: 7 };
  function r(str) {
    // 16-char row → array of indices
    const out = new Array(16);
    for (let i = 0; i < 16; i++) {
      const ch = i < str.length ? str[i] : '.';
      out[i] = CHAR_MAP[ch] != null ? CHAR_MAP[ch] : 0;
    }
    return out;
  }

  const PLAYER_SPRITES = {
    // idle: arms at sides, eyes forward — 2 frames (subtle bob)
    idle: [
      s([
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRRRRRRRK....'),
        r('..KRWKRRKWRK....'),
        r('..KRWWRRWWRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....KOOOOK......'),
        r('...OOOOOOOO.....'),
        r('..OOOOOOOOOO....'),
        r('..OO.OOOO.OO....'),
        r('..OO.OOOO.OO....'),
        r('..KK..KK..KK....'),
        r('................'),
        r('................'),
      ]),
      s([
        r('................'),
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRRRRRRRK....'),
        r('..KRWKRRKWRK....'),
        r('..KRWWRRWWRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....KOOOOK......'),
        r('...OOOOOOOO.....'),
        r('..OOOOOOOOOO....'),
        r('..OO.OOOO.OO....'),
        r('..KK..KK..KK....'),
        r('................'),
        r('................'),
      ]),
    ],
    // run: legs alternate — 4 frames
    run: [
      s([
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRRRRRRRK....'),
        r('..KRWKRRKWRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....KOOOOK......'),
        r('...OOOOOOOO.....'),
        r('..OOOOOOOOOO....'),
        r('..OO.OOOOOOO....'),
        r('..OO..OO.OO.....'),
        r('..KK..OO.OO.....'),
        r('......KK.KK.....'),
        r('................'),
        r('................'),
      ]),
      s([
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRRRRRRRK....'),
        r('..KRWKRRKWRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....KOOOOK......'),
        r('...OOOOOOOO.....'),
        r('..OOOOOOOOOO....'),
        r('...OOOOOOOO.....'),
        r('...OOOO.OOO.....'),
        r('...KK....OO.....'),
        r('..........KK....'),
        r('................'),
        r('................'),
      ]),
      s([
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRRRRRRRK....'),
        r('..KRWKRRKWRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....KOOOOK......'),
        r('...OOOOOOOO.....'),
        r('..OOOOOOOOOO....'),
        r('...OOO.OOOOO....'),
        r('....OO..OOO.....'),
        r('....OO...KK.....'),
        r('....KK..........'),
        r('................'),
        r('................'),
      ]),
      s([
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRRRRRRRK....'),
        r('..KRWKRRKWRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....KOOOOK......'),
        r('...OOOOOOOO.....'),
        r('..OOOOOOOOOO....'),
        r('....OOOOOOO.....'),
        r('....OOOOOOOO....'),
        r('....OO....OO....'),
        r('....KK....KK....'),
        r('................'),
        r('................'),
      ]),
    ],
    // jump: arms up, legs tucked — 1 frame
    jump: [
      s([
        r('................'),
        r('..K............K'),
        r('...K..........K.'),
        r('....KKKKKKKKKK..'),
        r('...KRRRRRRRRK...'),
        r('..KRRRRRRRRRRK..'),
        r('..KRWKRRKWRRRK..'),
        r('..KRRRRRRRRRRK..'),
        r('...KRRRRRRRRK...'),
        r('....KOOOOOOK....'),
        r('...OOOOOOOOOO...'),
        r('..OOOOOOOOOOOO..'),
        r('..OO.OOOOOO.OO..'),
        r('..OO..OOOO..OO..'),
        r('..KK..KKKK..KK..'),
        r('................'),
      ]),
    ],
    // death: x-eyes, fallen pose — 2 frames
    death: [
      s([
        r('................'),
        r('................'),
        r('................'),
        r('................'),
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRRRRRRRK....'),
        r('..KRRKRRKRRK....'),
        r('..KRKRRRRKRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....OOOOOO......'),
        r('..OOOOOOOOOO....'),
        r('................'),
        r('................'),
      ]),
      s([
        r('................'),
        r('................'),
        r('................'),
        r('................'),
        r('................'),
        r('................'),
        r('....KKKKKK......'),
        r('...KRRRRRRK.....'),
        r('..KRRKRRKRRK....'),
        r('..KRKRRRRKRK....'),
        r('..KRRRRRRRRK....'),
        r('...KRRRRRRK.....'),
        r('....OOOOOO......'),
        r('..OOOOOOOOOO....'),
        r('................'),
        r('................'),
      ]),
    ],
  };

  function createPlayer(opts) {
    const o = opts || {};
    return {
      x: o.x || 0,
      y: o.y || 0,
      w: 16,
      h: 16,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      onGround: false,
      lives: 3,
      score: 0,
      animState: 'idle',     // 'idle' | 'run' | 'jump' | 'death'
      animFrame: 0,          // index into the current state's sprite array
      animTimer: 0,          // counts up; advances frame at animFrameInterval
      facing: 'right',       // 'left' | 'right' — used to flip sprite
    };
  }

  function createPlayerController(config) {
    if (!config || !config.input) {
      throw new TypeError('createPlayerController: input is required');
    }
    const input = config.input;
    const physics = config.physics || null;
    const cfg = Object.assign({
      coyoteFrames: 6,
      jumpBufferFrames: 6,
      walkAccel: 0.3,
      runAccelMultiplier: 1.5,
      walkMaxSpeed: 3,
      runMaxSpeed: 4.5,
      jumpVelocity: 12,
      animFrameInterval: 7,
    }, config.options || {});

    // Internal controller state — separate from the entity so the entity
    // stays "pure data" the Physics/Collision modules can serialize.
    const state = {
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      wasOnGround: false,
    };

    function update(player) {
      // Coyote: tick down each frame; reset to coyoteFrames whenever onGround.
      if (player.onGround) {
        state.coyoteTimer = cfg.coyoteFrames;
      } else if (state.coyoteTimer > 0) {
        state.coyoteTimer--;
      }

      // Jump buffer: if jump pressed this frame, set buffer to N frames.
      if (input.justPressed('jump')) {
        state.jumpBufferTimer = cfg.jumpBufferFrames;
      } else if (state.jumpBufferTimer > 0) {
        state.jumpBufferTimer--;
      }

      const running = input.isHeld('run');
      const maxSpeed = running ? cfg.runMaxSpeed : cfg.walkMaxSpeed;
      const accel = cfg.walkAccel * (running ? cfg.runAccelMultiplier : 1);

      const left = input.isHeld('moveLeft');
      const right = input.isHeld('moveRight');

      // Horizontal: set ax based on input direction; PlayerController owns
      // the clamp so the run-speed boost actually takes effect (the Physics
      // module's maxSpeedX is intentionally not respected here).
      if (left && !right) {
        player.ax = -accel;
        player.facing = 'left';
      } else if (right && !left) {
        player.ax = accel;
        player.facing = 'right';
      } else {
        player.ax = 0;
        // Friction is applied in this branch only (no input). Snap to zero
        // below threshold so the entity actually stops.
        player.vx *= 0.7;
        if (Math.abs(player.vx) < 0.1) player.vx = 0;
      }
      // Accelerate.
      player.vx += player.ax;
      if (player.vx > maxSpeed) player.vx = maxSpeed;
      else if (player.vx < -maxSpeed) player.vx = -maxSpeed;

      // Jump: eligible if onGround OR coyote window still open.
      const canJump = state.coyoteTimer > 0;
      if (state.jumpBufferTimer > 0 && canJump) {
        player.vy = -cfg.jumpVelocity;
        state.coyoteTimer = 0;
        state.jumpBufferTimer = 0;
        player.onGround = false;
      }

      // Cut jump: release the jump key while still rising → shorter jump.
      if (input.justReleased('jump') && player.vy < 0) {
        player.vy *= 0.4;
      }

      // Animation state.
      if (!player.onGround) {
        player.animState = 'jump';
      } else if (Math.abs(player.vx) > 0.5) {
        player.animState = 'run';
      } else {
        player.animState = 'idle';
      }

      // Animation frame advance.
      player.animTimer++;
      const frames = PLAYER_SPRITES[player.animState] || PLAYER_SPRITES.idle;
      if (player.animTimer >= cfg.animFrameInterval) {
        player.animTimer = 0;
        player.animFrame = (player.animFrame + 1) % frames.length;
      }
      if (player.animFrame >= frames.length) player.animFrame = 0;

      state.wasOnGround = player.onGround;
    }

    return {
      update: update,
      _state: state, // exposed for tests; not part of the public contract
      constants: Object.freeze(Object.assign({}, cfg)),
    };
  }

  // Render a 16×16 sprite frame to an existing canvas 2D context. Honors
  // facing direction by flipping the pixel iteration order.
  function drawSprite(ctx, frame, dx, dy, facing) {
    const flip = facing === 'left';
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const idx = frame[py * 16 + px];
        if (idx === 0) continue;
        const color = PALETTE[idx] || '#f0f';
        const sx = flip ? 15 - px : px;
        ctx.fillStyle = color;
        ctx.fillRect(dx + sx, dy + py, 1, 1);
      }
    }
  }

  function drawPlayer(ctx, player) {
    const frames = PLAYER_SPRITES[player.animState] || PLAYER_SPRITES.idle;
    const frame = frames[player.animFrame] || frames[0];
    drawSprite(ctx, frame, Math.round(player.x), Math.round(player.y), player.facing);
  }

  const api = {
    createPlayer: createPlayer,
    createPlayerController: createPlayerController,
    drawPlayer: drawPlayer,
    PLAYER_SPRITES: PLAYER_SPRITES,
    PALETTE: PALETTE,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PlayerModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
