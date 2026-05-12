'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRenderer, DEFAULT_TILE_PALETTE } = require('../src/renderer.js');
const { createCamera } = require('../src/camera.js');
const { createTilemap } = require('../src/tilemap.js');
const { createPlayer } = require('../src/player.js');

// Minimal Canvas2D mock that records every state change and draw call.
// Tests inspect `calls` to assert behaviour without a real DOM.
function makeMockCtx() {
  const calls = [];
  let fillStyle = '#000';
  let font = '';
  return {
    get fillStyle() { return fillStyle; },
    set fillStyle(v) { fillStyle = v; calls.push({ op: 'fillStyle', value: v }); },
    get font() { return font; },
    set font(v) { font = v; calls.push({ op: 'font', value: v }); },
    fillRect(x, y, w, h) { calls.push({ op: 'fillRect', x, y, w, h, fillStyle }); },
    clearRect(x, y, w, h) { calls.push({ op: 'clearRect', x, y, w, h }); },
    fillText(text, x, y) { calls.push({ op: 'fillText', text, x, y, fillStyle, font }); },
    _calls: calls,
  };
}

// Returns true if every fillRect / fillText / clearRect uses integer coords.
function allIntegerCoords(calls) {
  for (const c of calls) {
    if (c.op === 'fillRect' || c.op === 'clearRect') {
      if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || !Number.isInteger(c.w) || !Number.isInteger(c.h)) {
        return { ok: false, call: c };
      }
    }
    if (c.op === 'fillText') {
      if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) {
        return { ok: false, call: c };
      }
    }
  }
  return { ok: true };
}

// A 32×13 tilemap (DEFAULT_MAP) extended to 64 cols to give us off-screen
// tiles for the culling assertions.
function makeWideMap() {
  const rows = [];
  for (let y = 0; y < 13; y++) {
    let r = '';
    for (let x = 0; x < 64; x++) {
      if (y === 11 || y === 12) r += '#';
      else if (y === 8 && x >= 4 && x <= 9) r += '=';
      else r += '.';
    }
    rows.push(r);
  }
  return rows;
}

const VIEWPORT = { width: 256, height: 208 };

function makeRig(opts) {
  const o = opts || {};
  const ctx = makeMockCtx();
  const tilemap = createTilemap({ tileSize: 16, map: o.map || makeWideMap() });
  const camera = createCamera({
    viewport: VIEWPORT,
    level: { pixelWidth: tilemap.pixelWidth, pixelHeight: tilemap.pixelHeight },
    initial: o.initial || { x: 0, y: 0 },
  });
  const drawPlayerCalls = [];
  function drawPlayer(ctx, p) {
    drawPlayerCalls.push({ x: p.x, y: p.y, animState: p.animState, animFrame: p.animFrame, facing: p.facing });
  }
  const renderer = createRenderer({
    ctx: ctx,
    viewport: VIEWPORT,
    camera: camera,
    tilemap: tilemap,
    backgrounds: o.backgrounds,
    palette: o.palette,
    drawPlayer: drawPlayer,
  });
  return { ctx, camera, tilemap, renderer, drawPlayerCalls };
}

// ---------- factory & validation ----------

test('createRenderer exposes the public API', () => {
  const { renderer } = makeRig();
  assert.equal(typeof renderer.render, 'function');
  assert.equal(typeof renderer.getLastFrameStats, 'function');
});

test('createRenderer rejects missing ctx', () => {
  assert.throws(() => createRenderer({}), TypeError);
});

test('createRenderer rejects missing viewport', () => {
  assert.throws(() => createRenderer({ ctx: makeMockCtx() }), TypeError);
});

test('createRenderer rejects missing camera', () => {
  assert.throws(() => createRenderer({
    ctx: makeMockCtx(),
    viewport: VIEWPORT,
  }), TypeError);
});

test('createRenderer rejects missing tilemap', () => {
  const cam = createCamera({ viewport: VIEWPORT, level: { pixelWidth: 1024, pixelHeight: 240 } });
  assert.throws(() => createRenderer({
    ctx: makeMockCtx(),
    viewport: VIEWPORT,
    camera: cam,
  }), TypeError);
});

test('createRenderer requires drawPlayer when PlayerModule is unloaded on root', () => {
  // Use a real-shaped tilemap and camera, but force no drawPlayer either via
  // config or via root — this verifies the error path even when PlayerModule
  // is unavailable in the global env.
  const cam = createCamera({ viewport: VIEWPORT, level: { pixelWidth: 1024, pixelHeight: 240 } });
  const tm = createTilemap({ tileSize: 16, map: makeWideMap() });
  // Stash and clear the global hook PlayerModule.drawPlayer may have set.
  const stash = globalThis.PlayerModule;
  globalThis.PlayerModule = undefined;
  try {
    assert.throws(() => createRenderer({
      ctx: makeMockCtx(),
      viewport: VIEWPORT,
      camera: cam,
      tilemap: tm,
    }), TypeError);
  } finally {
    globalThis.PlayerModule = stash;
  }
});

test('constants are frozen', () => {
  const { renderer } = makeRig();
  assert.throws(() => { renderer.constants.viewport.width = 1; }, TypeError);
  assert.throws(() => { renderer.constants.tilePalette.sky = '#000'; }, TypeError);
});

// ---------- AC: grassland renders ground + platforms + sky ----------

test('AC: render fills sky background and draws ground tiles', () => {
  const { renderer, ctx } = makeRig();
  renderer.render({});
  // First, a clearRect to wipe the previous frame.
  assert.ok(ctx._calls.some(c => c.op === 'clearRect'), 'expected clearRect at start of frame');
  // Sky fill covers the entire viewport.
  const skyFill = ctx._calls.find(c => c.op === 'fillRect' && c.x === 0 && c.y === 0 && c.w === VIEWPORT.width && c.h === VIEWPORT.height);
  assert.ok(skyFill, 'expected full-viewport sky fill');
  assert.equal(skyFill.fillStyle, DEFAULT_TILE_PALETTE.sky);
  // Ground tile fill (chocolate-brown). Must appear at least once.
  assert.ok(
    ctx._calls.some(c => c.op === 'fillRect' && c.fillStyle === DEFAULT_TILE_PALETTE.ground && c.w === 16 && c.h === 16),
    'expected at least one ground tile fill'
  );
  // Grass-cap fill on the top exposed row.
  assert.ok(
    ctx._calls.some(c => c.op === 'fillRect' && c.fillStyle === DEFAULT_TILE_PALETTE.grassTop && c.h === 3),
    'expected at least one grass-cap fill'
  );
});

// ---------- AC: culling — only viewport tiles (+1 margin) drawn ----------

test('AC: culling — tilesDrawn far less than totalTiles, ratio matches viewport coverage', () => {
  const { renderer } = makeRig();
  renderer.render({});
  const s = renderer.getLastFrameStats();
  assert.equal(s.totalTiles, 64 * 13, 'expected totalTiles = cols * rows');
  // Viewport is 256 wide ÷ 16 tile = 16 cols + 1 margin each side ≈ 18 cols.
  // Map only has tiles in 8 rows (=row + 2 ground rows + sparse). Drawn tiles
  // should be well under 100, and definitely well under totalTiles.
  assert.ok(s.tilesDrawn > 0, 'expected some tiles drawn');
  assert.ok(s.tilesDrawn < s.totalTiles / 3, 'tilesDrawn (' + s.tilesDrawn + ') should be a small fraction of totalTiles (' + s.totalTiles + ')');
});

test('AC: culling — panning the camera right reveals new columns and hides others', () => {
  const { renderer, camera } = makeRig();
  renderer.render({});
  const before = renderer.getLastFrameStats().tilesDrawn;
  camera.snapTo({ x: 400, y: 100, width: 16, height: 16 });
  renderer.render({});
  const after = renderer.getLastFrameStats().tilesDrawn;
  // Both frames should draw roughly the same number of tiles since the
  // viewport width is constant and the level is uniformly dense at this y.
  assert.ok(after > 0);
  assert.ok(Math.abs(after - before) <= 4, 'culled count should be stable across pans (' + before + ' vs ' + after + ')');
});

test('AC: culling — tiles outside viewport are not drawn', () => {
  const { renderer, ctx } = makeRig();
  renderer.render({});
  // Map is 64 cols wide × 16 px each = 1024 px. Viewport (camera at 0) covers
  // x in [0, 256]. A tile at tx=40 (px 640) is far off-screen.
  // No fillRect should land at sx >= 256 + 16 (16 = 1-tile margin).
  for (const c of ctx._calls) {
    if (c.op === 'fillRect' && c.w === 16) {
      // 1-tile margin: a tile whose left edge sits at sx == viewport+16 is
      // still within the permitted band; reject only sx > that.
      assert.ok(c.x <= VIEWPORT.width + 16, 'unexpected tile fillRect at sx=' + c.x + ' (off-screen right)');
    }
  }
});

// ---------- AC: player sprite at camera-offset position ----------

test('AC: player drawn at world-x minus camera offset, integer coords', () => {
  const { renderer, camera, drawPlayerCalls } = makeRig();
  camera.snapTo({ x: 500, y: 100, width: 16, height: 16 });
  const off = camera.getOffset();
  const player = createPlayer({ x: 507.6, y: 100.4 });
  player.animState = 'run';
  player.animFrame = 2;
  player.facing = 'right';
  renderer.render({ player });
  assert.equal(drawPlayerCalls.length, 1, 'drawPlayer should be called once');
  const dp = drawPlayerCalls[0];
  assert.equal(dp.x, Math.round(507.6 - off.x));
  assert.equal(dp.y, Math.round(100.4 - off.y));
  assert.equal(dp.animState, 'run');
  assert.equal(dp.animFrame, 2);
  assert.equal(dp.facing, 'right');
});

test('AC: render forwards player animation frame as-is (renderer does not mutate frame)', () => {
  const { renderer, drawPlayerCalls } = makeRig();
  // Each call sees the current animFrame the controller set.
  for (let f = 0; f < 4; f++) {
    const p = createPlayer({ x: 32, y: 100 });
    p.animState = 'run';
    p.animFrame = f;
    renderer.render({ player: p });
  }
  assert.deepEqual(drawPlayerCalls.map(d => d.animFrame), [0, 1, 2, 3]);
});

// ---------- AC: integer coordinates everywhere ----------

test('AC: every draw call lands on integer screen coordinates (no sub-pixel blur)', () => {
  const { renderer, ctx, camera } = makeRig();
  camera.snapTo({ x: 73.7, y: 31.2, width: 16, height: 16 });
  const player = createPlayer({ x: 80.4, y: 100.9 });
  renderer.render({
    player: player,
    hud: { score: 1234, lives: 3, levelName: 'World 1-1' },
  });
  const r = allIntegerCoords(ctx._calls);
  assert.ok(r.ok, 'non-integer coord found in call: ' + JSON.stringify(r.call));
});

// ---------- AC: parallax backgrounds scroll at different rates ----------

test('AC: parallax — two background layers receive different offsets', () => {
  const drawCalls = [];
  const sky = (ctx, off) => { drawCalls.push({ layer: 'sky', x: off.x, y: off.y }); };
  const hills = (ctx, off) => { drawCalls.push({ layer: 'hills', x: off.x, y: off.y }); };
  const { renderer, camera } = makeRig({
    backgrounds: [
      { factor: 0, color: '#5cd', draw: sky },
      { factor: 0.3, draw: hills },
      { factor: 0.6, draw: function (ctx, off) { drawCalls.push({ layer: 'mid', x: off.x, y: off.y }); } },
    ],
  });
  camera.snapTo({ x: 500, y: 100, width: 16, height: 16 });
  const camOff = camera.getOffset();
  renderer.render({});
  // Three layer draws, each with offset = camOff * factor.
  const byLayer = Object.fromEntries(drawCalls.map(d => [d.layer, d]));
  assert.equal(byLayer.sky.x, 0, 'sky factor 0 ⇒ offset 0');
  assert.equal(byLayer.hills.x, camOff.x * 0.3);
  assert.equal(byLayer.mid.x, camOff.x * 0.6);
  // Background layer offsets must differ.
  assert.notEqual(byLayer.sky.x, byLayer.hills.x);
  assert.notEqual(byLayer.hills.x, byLayer.mid.x);
});

test('parallax background "color" fills are stacked in declaration order', () => {
  const { renderer, ctx } = makeRig({
    backgrounds: [
      { factor: 0, color: '#000' },
      { factor: 0, color: '#5cd' }, // overlay
    ],
  });
  renderer.render({});
  const fills = ctx._calls.filter(c => c.op === 'fillRect' && c.x === 0 && c.y === 0 && c.w === VIEWPORT.width && c.h === VIEWPORT.height);
  assert.equal(fills.length, 2);
  assert.equal(fills[0].fillStyle, '#000');
  assert.equal(fills[1].fillStyle, '#5cd');
});

// ---------- AC: HUD fixed in screen space ----------

test('AC: HUD renders at fixed screen position regardless of camera pan', () => {
  const { renderer, ctx, camera } = makeRig();
  renderer.render({ hud: { score: 0, lives: 3, levelName: 'world 1-1' } });
  const t1 = ctx._calls.find(c => c.op === 'fillText');
  camera.snapTo({ x: 500, y: 200, width: 16, height: 16 });
  renderer.render({ hud: { score: 0, lives: 3, levelName: 'world 1-1' } });
  // Second fillText is the one for the new frame.
  const allText = ctx._calls.filter(c => c.op === 'fillText');
  const t2 = allText[allText.length - 1];
  assert.equal(t1.x, t2.x, 'HUD x must not shift with camera');
  assert.equal(t1.y, t2.y, 'HUD y must not shift with camera');
});

test('AC: HUD displays score, lives, and level name (uppercase) in one line', () => {
  const { renderer, ctx } = makeRig();
  renderer.render({ hud: { score: 42, lives: 2, levelName: 'world 1-1' } });
  const t = ctx._calls.find(c => c.op === 'fillText');
  assert.ok(t, 'expected an HUD fillText');
  assert.match(t.text, /WORLD 1-1/);
  assert.match(t.text, /SCORE 42/);
  assert.match(t.text, /LIVES 2/);
});

test('HUD honours custom x, y, font, and color overrides', () => {
  const { renderer, ctx } = makeRig();
  renderer.render({
    hud: { score: 1, lives: 1, levelName: 'L', x: 100, y: 200, font: '8px sans', color: '#0f0' },
  });
  const t = ctx._calls.find(c => c.op === 'fillText');
  assert.equal(t.x, 100);
  assert.equal(t.y, 200);
  assert.equal(t.font, '8px sans');
  assert.equal(t.fillStyle, '#0f0');
});

test('omitting hud skips fillText entirely', () => {
  const { renderer, ctx } = makeRig();
  renderer.render({});
  assert.equal(ctx._calls.filter(c => c.op === 'fillText').length, 0);
});

// ---------- AC: animation frame is approximately 8 FPS via the player controller ----------

test('AC: animation frame interval is in the 7-8 game-frame band (≈ 8 FPS at 60 fps tick)', () => {
  const { createPlayerController } = require('../src/player.js');
  const input = {
    isHeld: () => false,
    justPressed: () => false,
    justReleased: () => false,
  };
  const ctl = createPlayerController({ input: input });
  // 8 FPS at 60 fps game tick = every 7.5 frames. Default config must sit
  // in the {7, 8} integer band to satisfy the AC literally.
  assert.ok(ctl.constants.animFrameInterval >= 7 && ctl.constants.animFrameInterval <= 8,
    'animFrameInterval ' + ctl.constants.animFrameInterval + ' outside 7-8 band');
});

// ---------- stats accounting ----------

test('getLastFrameStats reports per-frame counts, resetting each render', () => {
  const { renderer } = makeRig();
  renderer.render({});
  const s1 = renderer.getLastFrameStats();
  assert.ok(s1.drawCalls > 0);
  assert.ok(s1.tilesDrawn > 0);
  // Render an empty frame (no map) — stats reset and start anew.
  const tinyTilemap = createTilemap({
    tileSize: 16,
    map: ['................', '................'],
  });
  const cam = createCamera({
    viewport: VIEWPORT,
    level: { pixelWidth: tinyTilemap.pixelWidth, pixelHeight: tinyTilemap.pixelHeight },
  });
  const ctx2 = makeMockCtx();
  const r2 = createRenderer({
    ctx: ctx2, viewport: VIEWPORT, camera: cam, tilemap: tinyTilemap,
    drawPlayer: () => {},
  });
  r2.render({});
  const s2 = r2.getLastFrameStats();
  assert.equal(s2.tilesDrawn, 0, 'empty map ⇒ zero tiles drawn');
});

test('entities array — each item with .draw is invoked once per frame', () => {
  const { renderer } = makeRig();
  let calls = 0;
  const ent = { x: 80, y: 100, draw: (ctx, sx, sy) => { calls++; } };
  renderer.render({ entities: [ent, ent, ent] });
  assert.equal(calls, 3);
  assert.equal(renderer.getLastFrameStats().entitiesDrawn, 3);
});

test('entities without .draw are silently skipped', () => {
  const { renderer } = makeRig();
  renderer.render({ entities: [{ x: 0, y: 0 }, { x: 16, y: 16 }] });
  assert.equal(renderer.getLastFrameStats().entitiesDrawn, 0);
});

test('passing no frame argument is equivalent to an empty frame', () => {
  const { renderer } = makeRig();
  renderer.render();
  assert.equal(renderer.getLastFrameStats().entitiesDrawn, 0);
});

// ---------- camera-offset application ----------

test('tile screen positions account for camera offset', () => {
  const { renderer, ctx, camera, tilemap } = makeRig({ initial: { x: 0, y: 0 } });
  renderer.render({});
  // Capture the screen-x of the first ground tile fill.
  const firstGround1 = ctx._calls.find(c => c.op === 'fillRect' && c.fillStyle === DEFAULT_TILE_PALETTE.ground);
  // Pan the camera enough that the offset is unambiguously > 0 (snapTo
  // centres on the target, so we need to be well past viewport.width/2).
  camera.snapTo({ x: 400, y: 100, width: 16, height: 16 });
  const camOff = camera.getOffset();
  assert.ok(camOff.x > 0, 'camera should have panned right');
  const startCalls = ctx._calls.length;
  renderer.render({});
  const afterCalls = ctx._calls.slice(startCalls);
  const firstGround2 = afterCalls.find(c => c.op === 'fillRect' && c.fillStyle === DEFAULT_TILE_PALETTE.ground);
  assert.notEqual(firstGround1.x, undefined);
  assert.notEqual(firstGround2.x, undefined);
  // The first ground tile's world sx for tile tx=0 was at screen x=0; after
  // panning, that tile is offscreen-left and the leftmost drawn ground tile
  // now belongs to a different tx — its sx should differ from before unless
  // the offset is a perfect multiple of tileSize starting at tx=0 (it isn't).
  assert.notEqual(firstGround1.x, firstGround2.x);
});

test('drawing a tile at the right-edge margin still falls within the viewport+margin band', () => {
  const { renderer, ctx } = makeRig({ initial: { x: 0, y: 0 } });
  renderer.render({});
  for (const c of ctx._calls) {
    if (c.op === 'fillRect' && c.w === 16) {
      // 1-tile margin allowed on each side.
      assert.ok(c.x >= -16, 'tile sx ' + c.x + ' too far left');
      assert.ok(c.x <= VIEWPORT.width + 16, 'tile sx ' + c.x + ' too far right');
    }
  }
});

test('clearRect always runs before any drawing each frame', () => {
  const { renderer, ctx } = makeRig();
  renderer.render({});
  const clearIdx = ctx._calls.findIndex(c => c.op === 'clearRect');
  const firstFillIdx = ctx._calls.findIndex(c => c.op === 'fillRect');
  assert.notEqual(clearIdx, -1);
  assert.notEqual(firstFillIdx, -1);
  assert.ok(clearIdx < firstFillIdx, 'clearRect should precede first fillRect');
});
