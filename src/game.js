/**
 * Game — owns the requestAnimationFrame loop and delegates each tick to
 * the active scene via StateManager. Per architecture, Game is a thin
 * orchestrator; all gameplay logic lives in scenes/entities.
 *
 * The loop is testable by injecting a custom `rafProvider` (so tests can
 * step frames manually without relying on real animation timing).
 */
(function (root) {
  'use strict';

  const DEFAULT_RAF = (typeof requestAnimationFrame === 'function')
    ? function (cb) { return requestAnimationFrame(cb); }
    : null;
  const DEFAULT_CAF = (typeof cancelAnimationFrame === 'function')
    ? function (id) { return cancelAnimationFrame(id); }
    : null;

  function createGame(config) {
    if (!config || !config.stateManager) {
      throw new TypeError('createGame: stateManager is required');
    }
    const stateManager = config.stateManager;
    const ctx = config.ctx || null;
    const raf = config.rafProvider || DEFAULT_RAF;
    const caf = config.cancelProvider || DEFAULT_CAF;
    const now = config.now || function () { return Date.now(); };

    if (!raf || !caf) {
      throw new Error('createGame: rafProvider/cancelProvider required in non-browser env');
    }

    let rafId = null;
    let lastTime = 0;
    let running = false;

    function frame(timestamp) {
      const t = typeof timestamp === 'number' ? timestamp : now();
      const dt = lastTime ? (t - lastTime) / 1000 : 0;
      lastTime = t;
      stateManager.update(dt);
      if (ctx) stateManager.render(ctx);
      if (running) rafId = raf(frame);
    }

    return {
      start: function () {
        if (running) return;
        running = true;
        lastTime = 0;
        rafId = raf(frame);
      },
      stop: function () {
        running = false;
        if (rafId !== null) {
          caf(rafId);
          rafId = null;
        }
      },
      isRunning: function () { return running; },
      // Step manually — useful for tests that want deterministic ticks.
      tick: function (timestamp) { frame(timestamp); },
    };
  }

  const api = { createGame: createGame };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.GameModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
