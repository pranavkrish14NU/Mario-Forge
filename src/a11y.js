/**
 * A11y — WCAG 2.1 AA accessibility hooks (WO-022, REQ-019).
 *
 * Canvas content is opaque to assistive tech, so accessibility is layered
 * across three concerns kept in one closure so they share state cleanly:
 *
 *   1. ARIA live region announcements (level start, score milestones,
 *      damage, game over, victory, pause/resume) — written to a DOM node
 *      with aria-live="polite" so screen readers narrate game state.
 *      Throttled to ≤ 1 announcement / second to avoid drowning the user.
 *
 *   2. Palette switching for high-contrast mode — exposes a getPalette()
 *      whose tile + screen colour tables flip when toggled. Toggle is bound
 *      to the H key in index.html (PRD FR-16). Callers (renderer + screens)
 *      are rebuilt on the onChange callback because both bake the palette
 *      at construction.
 *
 *   3. prefers-reduced-motion detection + manual override. isReducedMotion()
 *      drives index.html into a non-parallax background path and shrinks the
 *      pulse cadence on screens (rendered as instant text, not flickering).
 *
 * A fourth concern, runtime control remapping, is implemented as a small
 * "next keydown wins" capture mode that calls input.remap(key, action) on
 * the captured key. The controls UI lives in src/screens.js; this module
 * owns the capture state machine so the screen stays presentational.
 *
 * Session scope (WO-022 AC5): remapped controls live only in the Input
 * module's keymap, not in localStorage. WO-023 will add persistence; the
 * RTM drift between PRD FR-16 ("persist in localStorage") and this WO is
 * intentional and documented in the WO description.
 */
(function (root) {
  'use strict';

  // Default UI palette — mirrors src/screens.js DEFAULTS so a non-high-
  // contrast a11y instance is a no-op visually.
  const DEFAULT_SCREEN_PALETTE = Object.freeze({
    bgColor: '#102',
    titleColor: '#fc3',
    bodyColor: '#fff',
    promptColor: '#5cd',
    overlayColor: 'rgba(0,0,0,0.55)',
  });

  // Default tile palette — mirrors src/renderer.js DEFAULT_TILE_PALETTE.
  const DEFAULT_TILE_PALETTE = Object.freeze({
    sky: '#5cd',
    ground: '#5a3a1a',
    grassTop: '#3b6',
    platform: '#8a5',
    goalPole: '#fff',
    goalFlag: '#d23',
    spike: '#bbb',
    spikeShadow: '#666',
  });

  // High-contrast palette — pure black/white/yellow scheme that satisfies
  // WCAG AA (≥ 4.5:1 normal text, ≥ 3:1 large text). Yellow on black is
  // ~19:1 contrast, white on black is 21:1. Every tile and entity is forced
  // to a fully-saturated colour so colour-blind users still see distinct
  // silhouettes against the black backdrop.
  const HIGH_CONTRAST_SCREEN_PALETTE = Object.freeze({
    bgColor: '#000',
    titleColor: '#ff0',
    bodyColor: '#fff',
    promptColor: '#0ff',
    overlayColor: 'rgba(0,0,0,0.85)',
  });

  const HIGH_CONTRAST_TILE_PALETTE = Object.freeze({
    sky: '#000',
    ground: '#fff',
    grassTop: '#ff0',
    platform: '#0ff',
    goalPole: '#ff0',
    goalFlag: '#f0f',
    spike: '#f00',
    spikeShadow: '#fff',
  });

  // Keys the remap-capture flow refuses to bind. Modifiers alone are
  // useless as actions, Escape is reserved to abort remap, and Tab is the
  // browser focus-traversal key we don't want to clobber.
  const NON_BINDABLE_KEYS = Object.freeze({
    Escape: true, Tab: true,
    Shift: true, Control: true, Alt: true, Meta: true,
    ShiftLeft: true, ShiftRight: true,
    ControlLeft: true, ControlRight: true,
    AltLeft: true, AltRight: true,
    MetaLeft: true, MetaRight: true,
  });

  function detectPrefersReducedMotion(win) {
    if (!win || typeof win.matchMedia !== 'function') return false;
    try {
      const mq = win.matchMedia('(prefers-reduced-motion: reduce)');
      return !!(mq && mq.matches);
    } catch (e) {
      return false;
    }
  }

  function createA11y(config) {
    const cfg = config || {};
    const doc = cfg.doc || (typeof document !== 'undefined' ? document : null);
    const win = cfg.win || (typeof window !== 'undefined' ? window : null);
    const input = cfg.input || null;
    const throttleMs = (typeof cfg.throttleMs === 'number') ? cfg.throttleMs : 1000;
    const nowFn = cfg.nowFn || (function () { return Date.now(); });

    if (!doc || typeof doc.createElement !== 'function') {
      throw new TypeError('createA11y: doc with createElement is required');
    }

    // ---- ARIA live region ----------------------------------------------
    let liveRegion = cfg.liveRegion || null;
    if (!liveRegion) {
      liveRegion = doc.createElement('div');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.setAttribute('role', 'status');
      // Visually hidden but readable by screen readers. Avoids "display:none"
      // (which AT skips) and clip-path quirks across older browsers.
      if (liveRegion.style) {
        liveRegion.style.position = 'absolute';
        liveRegion.style.width = '1px';
        liveRegion.style.height = '1px';
        liveRegion.style.padding = '0';
        liveRegion.style.margin = '-1px';
        liveRegion.style.overflow = 'hidden';
        liveRegion.style.clip = 'rect(0,0,0,0)';
        liveRegion.style.whiteSpace = 'nowrap';
        liveRegion.style.border = '0';
      }
      if (doc.body && typeof doc.body.appendChild === 'function') {
        doc.body.appendChild(liveRegion);
      }
    }

    let lastAnnounceAt = -Infinity;
    let lastText = '';
    function announce(text, opts) {
      if (typeof text !== 'string' || !text) return false;
      const force = !!(opts && opts.force);
      const now = nowFn();
      // Throttle: drop announcements that arrive faster than throttleMs.
      // Identical-text re-announcements within the throttle window are
      // dropped even with force=true so screen readers don't repeat.
      if (!force && now - lastAnnounceAt < throttleMs) return false;
      if (text === lastText && now - lastAnnounceAt < throttleMs) return false;
      lastAnnounceAt = now;
      lastText = text;
      // Re-set textContent each time — same string twice in a row would
      // otherwise be skipped by some screen readers. Toggle aria-busy
      // around the write so the update is announced as a single chunk.
      try { liveRegion.setAttribute('aria-busy', 'true'); } catch (e) { /* ignore */ }
      liveRegion.textContent = '';
      liveRegion.textContent = text;
      try { liveRegion.setAttribute('aria-busy', 'false'); } catch (e) { /* ignore */ }
      return true;
    }

    // ---- State + change notifications ----------------------------------
    let highContrast = !!cfg.initialHighContrast;
    let reducedMotion = (typeof cfg.initialReducedMotion === 'boolean')
      ? cfg.initialReducedMotion
      : detectPrefersReducedMotion(win);
    const listeners = [];
    function emitChange(reason) {
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i]({ highContrast: highContrast, reducedMotion: reducedMotion, reason: reason }); }
        catch (e) { /* listener errors must not break the game loop */ }
      }
    }

    function onChange(fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function unsubscribe() {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    }

    function setHighContrast(v) {
      const next = !!v;
      if (next === highContrast) return false;
      highContrast = next;
      emitChange('highContrast');
      announce(highContrast ? 'High contrast on' : 'High contrast off', { force: true });
      return true;
    }
    function toggleHighContrast() { return setHighContrast(!highContrast); }

    function setReducedMotion(v) {
      const next = !!v;
      if (next === reducedMotion) return false;
      reducedMotion = next;
      emitChange('reducedMotion');
      return true;
    }
    function toggleReducedMotion() { return setReducedMotion(!reducedMotion); }

    function getPalette() {
      return {
        screen: highContrast ? HIGH_CONTRAST_SCREEN_PALETTE : DEFAULT_SCREEN_PALETTE,
        tile: highContrast ? HIGH_CONTRAST_TILE_PALETTE : DEFAULT_TILE_PALETTE,
      };
    }

    // ---- Remap capture state machine -----------------------------------
    let remapAction = null;
    let remapCompleteCb = null;
    function beginRemap(action, onComplete) {
      if (typeof action !== 'string' || !action) {
        throw new TypeError('beginRemap: action must be a non-empty string');
      }
      remapAction = action;
      remapCompleteCb = (typeof onComplete === 'function') ? onComplete : null;
    }
    function cancelRemap() {
      const wasAction = remapAction;
      remapAction = null;
      remapCompleteCb = null;
      return wasAction;
    }
    function isRemapping() { return remapAction !== null; }
    function getRemapAction() { return remapAction; }

    // captureKey returns one of:
    //   { status: 'idle' }     — not in remap mode
    //   { status: 'cancelled' } — Escape pressed mid-remap
    //   { status: 'ignored', reason: 'non-bindable' } — modifier-only key
    //   { status: 'bound', action, key } — successful rebind
    function captureKey(key) {
      if (!isRemapping()) return { status: 'idle' };
      if (key === 'Escape') {
        const action = cancelRemap();
        if (remapCompleteCb) { /* already null after cancelRemap */ }
        return { status: 'cancelled', action: action };
      }
      if (NON_BINDABLE_KEYS[key]) {
        return { status: 'ignored', reason: 'non-bindable', key: key };
      }
      const action = remapAction;
      const cb = remapCompleteCb;
      remapAction = null;
      remapCompleteCb = null;
      if (input && typeof input.remap === 'function') {
        input.remap(key, action);
      }
      announce('Remapped ' + action + ' to ' + describeKey(key), { force: true });
      if (cb) {
        try { cb({ status: 'bound', action: action, key: key }); }
        catch (e) { /* swallow listener errors */ }
      }
      return { status: 'bound', action: action, key: key };
    }

    // Compute the currently-bound key(s) for a given action by reverse-
    // scanning the Input keymap. Returns the first key found (consistent
    // with how a player would describe a control), or null if unbound.
    function getKeyForAction(action) {
      if (!input || typeof input.getKeyMap !== 'function') return null;
      const map = input.getKeyMap();
      const keys = Object.keys(map);
      for (let i = 0; i < keys.length; i++) {
        if (map[keys[i]] === action) return keys[i];
      }
      return null;
    }

    function describeKey(key) {
      if (key === ' ') return 'Space';
      if (key === 'ArrowLeft') return 'Left arrow';
      if (key === 'ArrowRight') return 'Right arrow';
      if (key === 'ArrowUp') return 'Up arrow';
      if (key === 'ArrowDown') return 'Down arrow';
      if (key === 'Enter') return 'Enter';
      if (key === 'Escape') return 'Escape';
      if (key === 'Shift') return 'Shift';
      if (key && key.length === 1) return key.toUpperCase();
      return String(key);
    }

    // ---- Convenience announcers ---------------------------------------
    // Game-domain helpers so callers don't reinvent the wording.
    function announceLevelStart(index, name) {
      const i = (typeof index === 'number' && index >= 0) ? index : 0;
      const n = (typeof name === 'string' && name) ? ': ' + name : '';
      return announce('Level ' + (i + 1) + n);
    }
    function announceScoreMilestone(score) {
      if (typeof score !== 'number') return false;
      return announce('Score ' + Math.floor(score));
    }
    function announceDamage(livesRemaining) {
      const n = (typeof livesRemaining === 'number') ? livesRemaining : 0;
      const suffix = (n === 1) ? ' life remaining' : ' lives remaining';
      return announce('Hit! ' + Math.max(0, n) + suffix);
    }
    function announceGameOver(score) {
      const s = (typeof score === 'number') ? score : 0;
      return announce('Game over. Score: ' + s);
    }
    function announceVictory(score) {
      const s = (typeof score === 'number') ? score : 0;
      return announce('Victory! Score: ' + s);
    }
    function announcePause(paused) {
      return announce(paused ? 'Paused' : 'Resumed');
    }

    // ---- Canvas ARIA helpers ------------------------------------------
    // Apply the standard role+label to a canvas element. The canvas can
    // also receive aria-describedby pointing at a hidden instructions div
    // so screen readers narrate the controls on focus. We don't manage the
    // describedby target — callers pass it in.
    function applyCanvasAria(canvas, opts) {
      if (!canvas || typeof canvas.setAttribute !== 'function') return false;
      const o = opts || {};
      canvas.setAttribute('role', o.role || 'application');
      if (o.label) canvas.setAttribute('aria-label', o.label);
      if (o.describedBy) canvas.setAttribute('aria-describedby', o.describedBy);
      // tabIndex 0 makes the canvas focusable for keyboard users.
      if (typeof canvas.tabIndex === 'number') canvas.tabIndex = 0;
      return true;
    }

    function detach() {
      if (liveRegion && liveRegion.parentNode && !cfg.liveRegion) {
        try { liveRegion.parentNode.removeChild(liveRegion); } catch (e) { /* ignore */ }
      }
      listeners.length = 0;
      remapAction = null;
      remapCompleteCb = null;
    }

    return {
      // Live-region API
      announce: announce,
      announceLevelStart: announceLevelStart,
      announceScoreMilestone: announceScoreMilestone,
      announceDamage: announceDamage,
      announceGameOver: announceGameOver,
      announceVictory: announceVictory,
      announcePause: announcePause,
      // State
      isHighContrast: function () { return highContrast; },
      setHighContrast: setHighContrast,
      toggleHighContrast: toggleHighContrast,
      isReducedMotion: function () { return reducedMotion; },
      setReducedMotion: setReducedMotion,
      toggleReducedMotion: toggleReducedMotion,
      getPalette: getPalette,
      onChange: onChange,
      // Remap
      beginRemap: beginRemap,
      cancelRemap: cancelRemap,
      isRemapping: isRemapping,
      getRemapAction: getRemapAction,
      captureKey: captureKey,
      getKeyForAction: getKeyForAction,
      describeKey: describeKey,
      // Canvas
      applyCanvasAria: applyCanvasAria,
      // Internals exposed for tests
      _liveRegion: function () { return liveRegion; },
      detach: detach,
    };
  }

  const api = {
    createA11y: createA11y,
    DEFAULT_SCREEN_PALETTE: DEFAULT_SCREEN_PALETTE,
    DEFAULT_TILE_PALETTE: DEFAULT_TILE_PALETTE,
    HIGH_CONTRAST_SCREEN_PALETTE: HIGH_CONTRAST_SCREEN_PALETTE,
    HIGH_CONTRAST_TILE_PALETTE: HIGH_CONTRAST_TILE_PALETTE,
    NON_BINDABLE_KEYS: NON_BINDABLE_KEYS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.A11yModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
