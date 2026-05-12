/**
 * Placeholder scenes for WO-002. Each scene is intentionally trivial:
 * a distinct background color + a console.log on enter. Real screens and
 * gameplay are owned by later work orders (WO-015 for UI screens).
 */
(function (root) {
  'use strict';

  function paint(ctx, color, width, height, label) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    if (typeof ctx.fillText === 'function') {
      ctx.fillStyle = '#ffffff';
      if ('font' in ctx) ctx.font = '20px monospace';
      ctx.fillText(label, 16, 32);
    }
  }

  function createScene(name, color, width, height, hint, logger) {
    const log = logger && logger.log ? logger.log : console.log.bind(console);
    return {
      enter: function () {
        log('[Scene] enter: ' + name);
      },
      exit: function () {
        log('[Scene] exit: ' + name);
      },
      update: function (_dt) {
        // No-op until later work orders add gameplay/UI animation.
      },
      render: function (ctx) {
        const label = hint ? name.toUpperCase() + ' — ' + hint : name.toUpperCase();
        paint(ctx, color, width, height, label);
      },
    };
  }

  function createPlaceholderScenes(config) {
    const cfg = config || {};
    const width = cfg.width || 320;
    const height = cfg.height || 180;
    const logger = cfg.logger || null;

    return {
      title: createScene('title', '#222244', width, height, 'press ENTER', logger),
      playing: createScene('playing', '#2e7d32', width, height, 'press P to pause', logger),
      paused: createScene('paused', '#5f4b32', width, height, 'press P to resume', logger),
      gameOver: createScene('gameOver', '#5a1d1d', width, height, 'press ENTER to retry', logger),
      victory: createScene('victory', '#1d3f5a', width, height, 'press ENTER to continue', logger),
      levelTransition: createScene('levelTransition', '#1c1c1c', width, height, 'loading…', logger),
    };
  }

  // Default allowed transitions for the scene graph. Exported alongside
  // scenes because the two are tightly coupled — adding a new scene means
  // declaring its valid neighbors here.
  const DEFAULT_TRANSITIONS = Object.freeze({
    title: ['playing', 'controls'],
    playing: ['paused', 'gameOver', 'victory', 'levelTransition'],
    paused: ['playing', 'title', 'controls'],
    levelTransition: ['playing', 'victory'],
    gameOver: ['title'],
    victory: ['title'],
    controls: ['title', 'paused'],
  });

  const api = {
    createPlaceholderScenes: createPlaceholderScenes,
    DEFAULT_TRANSITIONS: DEFAULT_TRANSITIONS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Scenes = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
