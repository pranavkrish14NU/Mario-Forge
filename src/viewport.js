/**
 * Viewport — responsive canvas scaling + orientation support (WO-020).
 *
 * The game canvas has a fixed internal resolution (e.g. 512×208) and never
 * resizes its drawing surface — that would clear and re-allocate the pixel
 * buffer and break the renderer's coordinate system. Instead, we adjust the
 * canvas's CSS display size (style.width / style.height) so the browser
 * scales the rendered pixels up or down to fit the viewport while preserving
 * aspect ratio. The letterbox / pillarbox bars come for free from the body's
 * black background.
 *
 * Scale selection:
 *   scaleFit  = min(viewportW / internalW, viewportH / internalH)
 *   If preferInteger is true AND scaleFit >= 1, we floor to the nearest
 *   integer multiple (1x, 2x, 3x, …) so each game pixel maps to exactly N
 *   screen pixels — sharpest possible scaling. For sub-1 scales (a 320 px
 *   phone vs a 512 px canvas) we always use the fractional scale because the
 *   alternative is rendering at 0× (invisible).
 *
 * image-rendering:
 *   We do NOT touch the canvas's image-rendering style — that belongs in CSS
 *   so it is set early in the page lifecycle and is not undone by JS. This
 *   module also writes an explicit `image-rendering: pixelated` so legacy
 *   browsers that pick up the property at element-style level still get it.
 *
 * Re-scale triggers:
 *   resize, orientationchange — both call recompute() on the next animation
 *   frame so multiple rapid events coalesce into one DOM write. AC5
 *   ("rotating a mobile device … triggers re-scaling within 1 frame") is
 *   met by using requestAnimationFrame; tests bypass the rAF batching via
 *   recomputeSync() so they can assert deterministically.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    internalWidth: 512,
    internalHeight: 208,
    preferInteger: true,
    setImageRendering: true,
  });

  function getRoot() {
    if (typeof window !== 'undefined') return window;
    return globalThis;
  }

  function getDocument(target) {
    if (target && target.document) return target.document;
    if (typeof document !== 'undefined') return document;
    return null;
  }

  function readViewport(target) {
    const t = target || getRoot();
    let w = t.innerWidth;
    let h = t.innerHeight;
    // Some test environments use documentElement.clientWidth instead.
    if (typeof w !== 'number' || typeof h !== 'number') {
      const doc = getDocument(t);
      if (doc && doc.documentElement) {
        w = doc.documentElement.clientWidth;
        h = doc.documentElement.clientHeight;
      }
    }
    return { w: w || 0, h: h || 0 };
  }

  // Compute the CSS display rect for a canvas of size internalW × internalH
  // that should fit inside viewportW × viewportH while preserving aspect
  // ratio. If preferInteger is true and scale >= 1, scale is floored to the
  // nearest integer multiple for pixel-perfect rendering. The result rect is
  // centered inside the viewport — the surrounding area becomes the
  // letterbox.
  function computeDisplayRect(internalW, internalH, viewportW, viewportH, preferInteger) {
    if (!internalW || !internalH || !viewportW || !viewportH) {
      return { width: 0, height: 0, offsetX: 0, offsetY: 0, scale: 0 };
    }
    let scale = Math.min(viewportW / internalW, viewportH / internalH);
    if (preferInteger && scale >= 1) {
      scale = Math.floor(scale);
    }
    const width = internalW * scale;
    const height = internalH * scale;
    const offsetX = (viewportW - width) / 2;
    const offsetY = (viewportH - height) / 2;
    return { width: width, height: height, offsetX: offsetX, offsetY: offsetY, scale: scale };
  }

  function createViewport(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    const canvas = cfg.canvas;
    if (!canvas || !canvas.style) {
      throw new TypeError('createViewport: canvas with a style property is required');
    }
    const target = cfg.target || getRoot();
    if (!target || typeof target.addEventListener !== 'function') {
      throw new TypeError('createViewport: target must support addEventListener');
    }
    const internalW = cfg.internalWidth;
    const internalH = cfg.internalHeight;
    // The pending rAF handle — coalesces back-to-back resize events.
    let rafHandle = null;
    let lastRect = { width: 0, height: 0, offsetX: 0, offsetY: 0, scale: 0 };
    const listeners = [];

    function applyRect(rect) {
      lastRect = rect;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      if (cfg.setImageRendering) {
        canvas.style.imageRendering = 'pixelated';
      }
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i](rect); } catch (e) {}
      }
    }

    function recomputeSync() {
      const vp = readViewport(target);
      const rect = computeDisplayRect(internalW, internalH, vp.w, vp.h, cfg.preferInteger);
      applyRect(rect);
      return rect;
    }

    function recompute() {
      if (rafHandle !== null) return;
      const raf = target.requestAnimationFrame || (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
      if (typeof raf !== 'function') {
        // No rAF (test env / non-browser) — recompute synchronously.
        recomputeSync();
        return;
      }
      rafHandle = raf.call(target, function () {
        rafHandle = null;
        recomputeSync();
      });
    }

    function onResize() { recompute(); }
    function onOrientationChange() { recompute(); }

    target.addEventListener('resize', onResize);
    target.addEventListener('orientationchange', onOrientationChange);

    // Initial computation so the canvas is sized correctly on first paint
    // without waiting for a resize event.
    recomputeSync();

    return {
      recompute: recompute,
      recomputeSync: recomputeSync,
      getDisplayRect: function () { return Object.assign({}, lastRect); },
      getScale: function () { return lastRect.scale; },
      getInternalSize: function () { return { w: internalW, h: internalH }; },
      onChange: function (fn) {
        if (typeof fn === 'function') listeners.push(fn);
        return function () {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      detach: function () {
        target.removeEventListener('resize', onResize);
        target.removeEventListener('orientationchange', onOrientationChange);
        if (rafHandle !== null) {
          const caf = target.cancelAnimationFrame || (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null);
          if (typeof caf === 'function') {
            try { caf.call(target, rafHandle); } catch (e) {}
          }
          rafHandle = null;
        }
      },
      // Test hook.
      _pending: function () { return rafHandle; },
    };
  }

  const api = {
    createViewport: createViewport,
    computeDisplayRect: computeDisplayRect,
    DEFAULTS: DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ViewportModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
