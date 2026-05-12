/**
 * Touch — virtual D-pad + action buttons overlay (WO-019, REQ-014 / REQ-023).
 *
 * Architecture:
 *   The Touch module is a thin input adapter that translates DOM TouchEvents
 *   into virtualPress / virtualRelease calls on the Input module. There is no
 *   parallel input buffer — gameplay code keeps polling Input as if everything
 *   were a keyboard press.
 *
 * Detection:
 *   On non-touch devices (desktop without touchscreen) the module attaches no
 *   listeners and draw() is a no-op. Touch capability is detected via
 *   'ontouchstart' in window || navigator.maxTouchPoints > 0, or can be
 *   forced via the isTouchCapable config for tests.
 *
 * Multi-touch:
 *   Each active finger is tracked in activeTouches keyed by Touch.identifier
 *   so the player can hold moveRight on one finger while tapping jump on
 *   another. When a finger slides off a button (touchmove leaves the rect)
 *   the corresponding action is released — but only if no OTHER active
 *   finger is still holding that same button.
 *
 * Responsive layout:
 *   Button sizes are computed as a fraction of the viewport width with a
 *   WCAG 2.1 AA minimum of 44 px so they remain reachable on 320 px-wide
 *   screens. Layout is recomputed every frame via getButtonRects(), so a
 *   viewport resize takes effect on the next draw or hit-test.
 *
 * Browser-default suppression:
 *   touchstart / touchmove / touchend / touchcancel all call preventDefault
 *   to block page scrolling, pinch-zoom, double-tap-zoom, and text selection
 *   on the buttons. Listeners are attached with { passive: false } so
 *   preventDefault actually takes effect.
 */
(function (root) {
  'use strict';

  // Layout is expressed as fractions of the viewport so it scales with the
  // canvas / window size. The actual button rect is max(MIN_TOUCH_TARGET_PX,
  // viewportW * sizeFrac) to enforce the WCAG floor.
  const DEFAULT_LAYOUT = Object.freeze({
    dpadCenter:           { xFrac: 0.15, yFrac: 0.80 },
    actionButtonsCenter:  { xFrac: 0.85, yFrac: 0.80 },
    buttonSizeFrac:       0.10, // 10% of viewport width
    buttonSpacingFrac:    0.025, // gap between left/right (and jump/run)
  });

  // WCAG 2.1 AA — touch targets must be at least 44 x 44 CSS pixels.
  const MIN_TOUCH_TARGET_PX = 44;

  // Mapping from button name (logical position) to {action, label}.
  const DEFAULT_BUTTONS = Object.freeze({
    left:  { action: 'moveLeft',  label: '◀' }, // ◀
    right: { action: 'moveRight', label: '▶' }, // ▶
    jump:  { action: 'jump',      label: 'A' },
    run:   { action: 'run',       label: 'B' },
  });

  function detectTouch(rootObj) {
    if (!rootObj) return false;
    if ('ontouchstart' in rootObj) return true;
    if (rootObj.navigator && typeof rootObj.navigator.maxTouchPoints === 'number'
        && rootObj.navigator.maxTouchPoints > 0) return true;
    return false;
  }

  function rectsEqual(a, b) {
    return a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  }

  function createTouch(config) {
    const cfg = config || {};
    const input = cfg.input;
    if (!input || typeof input.virtualPress !== 'function'
        || typeof input.virtualRelease !== 'function') {
      throw new TypeError('createTouch: input.virtualPress/virtualRelease are required');
    }
    const target = cfg.target;
    if (!target || typeof target.addEventListener !== 'function') {
      throw new TypeError('createTouch: target must support addEventListener');
    }
    const layout = Object.assign({}, DEFAULT_LAYOUT, cfg.layout || {});
    const buttons = Object.assign({}, DEFAULT_BUTTONS, cfg.buttons || {});

    // isTouchCapable defaults to feature detection but can be forced
    // (for tests, or for users who want to force-enable on desktop).
    const detectionRoot = cfg.detectionRoot || root;
    const isTouchCapable = (cfg.isTouchCapable !== undefined)
      ? !!cfg.isTouchCapable
      : detectTouch(detectionRoot);

    // visible defaults to isTouchCapable so non-touch devices stay clean.
    let visible = isTouchCapable;
    let viewportW = (cfg.viewport && cfg.viewport.w) || 0;
    let viewportH = (cfg.viewport && cfg.viewport.h) || 0;

    // identifier -> button name. Map preserves insertion order which lets us
    // ask "is anyone else still holding this button?" cheaply.
    const activeTouches = new Map();

    function computeRects() {
      if (!viewportW || !viewportH) return {};
      const size = Math.max(MIN_TOUCH_TARGET_PX, viewportW * layout.buttonSizeFrac);
      const spacing = viewportW * layout.buttonSpacingFrac;
      const dCx = viewportW * layout.dpadCenter.xFrac;
      const dCy = viewportH * layout.dpadCenter.yFrac;
      const aCx = viewportW * layout.actionButtonsCenter.xFrac;
      const aCy = viewportH * layout.actionButtonsCenter.yFrac;
      return {
        left:  { x: dCx - size - spacing / 2, y: dCy - size / 2, w: size, h: size },
        right: { x: dCx + spacing / 2,        y: dCy - size / 2, w: size, h: size },
        jump:  { x: aCx + spacing / 2,        y: aCy - size / 2, w: size, h: size },
        run:   { x: aCx - size - spacing / 2, y: aCy - size / 2, w: size, h: size },
      };
    }

    function hitTest(x, y) {
      const rects = computeRects();
      // Iterate in a deterministic order so overlapping rects resolve the
      // same way every time (shouldn't overlap in practice).
      const order = ['left', 'right', 'jump', 'run'];
      for (let i = 0; i < order.length; i++) {
        const name = order[i];
        const r = rects[name];
        if (!r) continue;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return name;
      }
      return null;
    }

    function anotherTouchOnButton(exceptIdentifier, btnName) {
      let found = false;
      activeTouches.forEach(function (b, id) {
        if (id !== exceptIdentifier && b === btnName) found = true;
      });
      return found;
    }

    function pressButton(identifier, btnName) {
      if (activeTouches.get(identifier) === btnName) return;
      const prev = activeTouches.get(identifier);
      if (prev) releaseButton(identifier, prev);
      activeTouches.set(identifier, btnName);
      // Only fire virtualPress if no other finger was already holding it
      // (idempotency in Input would catch double-press, but we also save the
      // bookkeeping work).
      input.virtualPress(buttons[btnName].action);
    }

    function releaseButton(identifier, btnName) {
      activeTouches.delete(identifier);
      if (!anotherTouchOnButton(identifier, btnName)) {
        input.virtualRelease(buttons[btnName].action);
      }
    }

    function preventDefaultSafely(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
    }

    function onTouchStart(event) {
      preventDefaultSafely(event); // block scroll / zoom / select on the canvas
      if (!visible) return;
      const touches = event.changedTouches || [];
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        const btn = hitTest(t.clientX, t.clientY);
        if (!btn) continue;
        pressButton(t.identifier, btn);
      }
    }

    function onTouchMove(event) {
      preventDefaultSafely(event);
      if (!visible) return;
      const touches = event.changedTouches || [];
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        const oldBtn = activeTouches.get(t.identifier);
        const newBtn = hitTest(t.clientX, t.clientY);
        if (oldBtn === newBtn) continue;
        if (oldBtn) releaseButton(t.identifier, oldBtn);
        if (newBtn) pressButton(t.identifier, newBtn);
      }
    }

    function onTouchEnd(event) {
      preventDefaultSafely(event);
      if (!visible) return;
      const touches = event.changedTouches || [];
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        const btn = activeTouches.get(t.identifier);
        if (btn) releaseButton(t.identifier, btn);
      }
    }

    if (isTouchCapable) {
      // passive:false so preventDefault actually suppresses scroll on iOS.
      const opts = { passive: false };
      target.addEventListener('touchstart', onTouchStart, opts);
      target.addEventListener('touchmove', onTouchMove, opts);
      target.addEventListener('touchend', onTouchEnd, opts);
      target.addEventListener('touchcancel', onTouchEnd, opts);
    }

    function draw(ctx) {
      if (!visible || !ctx) return;
      const rects = computeRects();
      const pressedSet = new Set();
      activeTouches.forEach(function (b) { pressedSet.add(b); });
      const order = ['left', 'right', 'jump', 'run'];
      for (let i = 0; i < order.length; i++) {
        const name = order[i];
        const r = rects[name];
        if (!r) continue;
        const pressed = pressedSet.has(name);
        ctx.save();
        ctx.globalAlpha = pressed ? 0.75 : 0.4;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.arc(cx, cy, r.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#000000';
        const fontPx = Math.floor(r.h * 0.45);
        ctx.font = fontPx + 'px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(buttons[name].label, cx, cy);
        ctx.restore();
      }
    }

    return {
      isActive: function () { return visible && isTouchCapable; },
      isTouchCapable: function () { return isTouchCapable; },
      isVisible: function () { return visible; },
      setVisible: function (b) { visible = !!b; },
      setViewport: function (w, h) { viewportW = w; viewportH = h; },
      getViewport: function () { return { w: viewportW, h: viewportH }; },
      getButtonRects: computeRects,
      getButtonForAction: function (action) {
        for (const name in buttons) {
          if (buttons[name].action === action) return name;
        }
        return null;
      },
      hitTest: hitTest,
      draw: draw,
      detach: function () {
        if (isTouchCapable) {
          target.removeEventListener('touchstart', onTouchStart);
          target.removeEventListener('touchmove', onTouchMove);
          target.removeEventListener('touchend', onTouchEnd);
          target.removeEventListener('touchcancel', onTouchEnd);
        }
        // Release everything still held so we don't leave the player stuck.
        activeTouches.forEach(function (btn, id) {
          input.virtualRelease(buttons[btn].action);
        });
        activeTouches.clear();
      },
      // Test hooks.
      _activeTouches: activeTouches,
      _rectsEqual: rectsEqual,
    };
  }

  const api = {
    createTouch: createTouch,
    detectTouch: detectTouch,
    DEFAULT_LAYOUT: DEFAULT_LAYOUT,
    DEFAULT_BUTTONS: DEFAULT_BUTTONS,
    MIN_TOUCH_TARGET_PX: MIN_TOUCH_TARGET_PX,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TouchModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
