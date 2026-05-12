/**
 * Camera — dead-zone scrolling follow camera (WO-008, REQ-003).
 *
 * The camera tracks a target (typically the player) in world coordinates and
 * exposes an offset that the Renderer (WO-009) subtracts from world coords
 * to produce screen coords: screenX = worldX - offset.x.
 *
 * Dead-zone follow:
 *   The viewport contains a centred rectangle (default 40% width × 30%
 *   height) inside which the target can move freely without scrolling. Only
 *   when the target pushes past a dead-zone edge does the camera shift, and
 *   even then it eases into the new position with a per-frame lerp so small
 *   adjustments do not produce jittery motion (AC1 + AC2).
 *
 * Vertical "panic line":
 *   To avoid the camera bouncing during normal jumps, vertical tracking is
 *   gated on either (a) the target being grounded, or (b) the target's lower
 *   edge falling below the dead-zone bottom — the panic line. This keeps
 *   the camera still while the player is mid-jump but rescues the framing
 *   when they fall off a ledge (AC4).
 *
 * Clamping:
 *   The camera clamps to [0, level.pixelWidth - viewport.width] horizontally
 *   and [0, level.pixelHeight - viewport.height] vertically so empty space
 *   beyond the level edges is never shown. When the level is smaller than
 *   the viewport on either axis the camera locks at 0 on that axis (AC3).
 *
 * Parallax:
 *   getParallaxOffset(factor) returns the camera offset scaled by `factor`.
 *   The Renderer applies this when drawing background layers so they scroll
 *   slower than the foreground (factor in [0,1)). The actual layer rendering
 *   is owned by WO-009 — this module just produces the offset.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    deadZoneWidthFactor: 0.4,
    deadZoneHeightFactor: 0.3,
    lerp: 0.15,
    snapEpsilon: 0.01,
  });

  function clamp(v, lo, hi) {
    if (hi < lo) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function createCamera(config) {
    const cfg = config || {};
    if (!cfg.viewport || typeof cfg.viewport.width !== 'number' || typeof cfg.viewport.height !== 'number') {
      throw new TypeError('createCamera: viewport {width, height} required');
    }
    if (!cfg.level || typeof cfg.level.pixelWidth !== 'number' || typeof cfg.level.pixelHeight !== 'number') {
      throw new TypeError('createCamera: level {pixelWidth, pixelHeight} required');
    }

    const viewport = { width: cfg.viewport.width, height: cfg.viewport.height };
    const level = { pixelWidth: cfg.level.pixelWidth, pixelHeight: cfg.level.pixelHeight };
    const dzW = cfg.deadZoneWidthFactor != null ? cfg.deadZoneWidthFactor : DEFAULTS.deadZoneWidthFactor;
    const dzH = cfg.deadZoneHeightFactor != null ? cfg.deadZoneHeightFactor : DEFAULTS.deadZoneHeightFactor;
    const lerp = cfg.lerp != null ? cfg.lerp : DEFAULTS.lerp;
    const snapEpsilon = cfg.snapEpsilon != null ? cfg.snapEpsilon : DEFAULTS.snapEpsilon;

    if (dzW <= 0 || dzW >= 1) throw new RangeError('createCamera: deadZoneWidthFactor must be in (0,1)');
    if (dzH <= 0 || dzH >= 1) throw new RangeError('createCamera: deadZoneHeightFactor must be in (0,1)');
    if (lerp <= 0 || lerp > 1) throw new RangeError('createCamera: lerp must be in (0,1]');

    const initial = cfg.initial || { x: 0, y: 0 };
    let x = initial.x;
    let y = initial.y;
    let targetX = x;
    let targetY = y;

    function maxX() {
      const m = level.pixelWidth - viewport.width;
      return m > 0 ? m : 0;
    }
    function maxY() {
      const m = level.pixelHeight - viewport.height;
      return m > 0 ? m : 0;
    }
    function applyClamp() {
      x = clamp(x, 0, maxX());
      y = clamp(y, 0, maxY());
      targetX = clamp(targetX, 0, maxX());
      targetY = clamp(targetY, 0, maxY());
    }

    // Dead zone is computed relative to the current camera position so it
    // tracks the viewport. Returns world-space rectangle.
    function getDeadZone() {
      const dzWidth = viewport.width * dzW;
      const dzHeight = viewport.height * dzH;
      const dzLeft = x + (viewport.width - dzWidth) / 2;
      const dzTop = y + (viewport.height - dzHeight) / 2;
      return {
        left: dzLeft,
        top: dzTop,
        right: dzLeft + dzWidth,
        bottom: dzTop + dzHeight,
        width: dzWidth,
        height: dzHeight,
      };
    }

    function targetBounds(target) {
      const tw = (target.width != null) ? target.width : 0;
      const th = (target.height != null) ? target.height : 0;
      return {
        left: target.x,
        right: target.x + tw,
        top: target.y,
        bottom: target.y + th,
        width: tw,
        height: th,
      };
    }

    function computeTarget(target) {
      const t = targetBounds(target);
      const dz = getDeadZone();

      // Horizontal: shift only when the target pushes a dead-zone edge.
      let nextTargetX = x;
      if (t.right > dz.right) nextTargetX = x + (t.right - dz.right);
      else if (t.left < dz.left) nextTargetX = x + (t.left - dz.left);

      // Vertical: engage when grounded OR when fallen past the panic line.
      const belowPanic = t.bottom > dz.bottom;
      const engageVertical = target.onGround === true || belowPanic;
      let nextTargetY = y;
      if (engageVertical) {
        if (t.bottom > dz.bottom) nextTargetY = y + (t.bottom - dz.bottom);
        else if (t.top < dz.top) nextTargetY = y + (t.top - dz.top);
      }

      return { x: nextTargetX, y: nextTargetY };
    }

    function update(target) {
      if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
        throw new TypeError('Camera.update: target {x, y} required');
      }
      const t = computeTarget(target);
      targetX = clamp(t.x, 0, maxX());
      targetY = clamp(t.y, 0, maxY());

      x += (targetX - x) * lerp;
      y += (targetY - y) * lerp;

      // Snap to target when the residual is below epsilon so the lerp can
      // settle exactly (otherwise tiny floating-point drift can persist).
      if (Math.abs(targetX - x) < snapEpsilon) x = targetX;
      if (Math.abs(targetY - y) < snapEpsilon) y = targetY;

      applyClamp();
    }

    // Centre camera on target instantly. Useful at level load to avoid the
    // camera lerping in from (0,0) on the first frame.
    function snapTo(target) {
      if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
        throw new TypeError('Camera.snapTo: target {x, y} required');
      }
      const t = targetBounds(target);
      x = (t.left + t.right) / 2 - viewport.width / 2;
      y = (t.top + t.bottom) / 2 - viewport.height / 2;
      targetX = x;
      targetY = y;
      applyClamp();
    }

    function getOffset() {
      return { x: x, y: y };
    }

    // Parallax: backgrounds use factor < 1 (slower scroll), foreground = 1.
    // factor = 0 means the layer is locked to the screen (sky).
    function getParallaxOffset(factor) {
      const f = (factor == null) ? 1 : factor;
      return { x: x * f, y: y * f };
    }

    function setLevelSize(size) {
      if (!size || typeof size.pixelWidth !== 'number' || typeof size.pixelHeight !== 'number') {
        throw new TypeError('Camera.setLevelSize: {pixelWidth, pixelHeight} required');
      }
      level.pixelWidth = size.pixelWidth;
      level.pixelHeight = size.pixelHeight;
      applyClamp();
    }

    function setViewport(size) {
      if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') {
        throw new TypeError('Camera.setViewport: {width, height} required');
      }
      viewport.width = size.width;
      viewport.height = size.height;
      applyClamp();
    }

    function getPosition() {
      return { x: x, y: y };
    }

    function getTarget() {
      return { x: targetX, y: targetY };
    }

    applyClamp();

    return {
      update: update,
      snapTo: snapTo,
      getOffset: getOffset,
      getParallaxOffset: getParallaxOffset,
      getDeadZone: getDeadZone,
      getPosition: getPosition,
      getTarget: getTarget,
      setLevelSize: setLevelSize,
      setViewport: setViewport,
      constants: Object.freeze({
        deadZoneWidthFactor: dzW,
        deadZoneHeightFactor: dzH,
        lerp: lerp,
        snapEpsilon: snapEpsilon,
      }),
    };
  }

  const api = {
    createCamera: createCamera,
    DEFAULTS: DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CameraModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
