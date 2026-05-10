/**
 * Input — minimal key handling for WO-002. Listens for ENTER and P, then
 * asks StateManager to transition. The full input system (WASD, arrows,
 * touch, gamepad, remapping) is owned by WO-003 and later work orders.
 */
(function (root) {
  'use strict';

  function createInputHandler(config) {
    if (!config || !config.stateManager) {
      throw new TypeError('createInputHandler: stateManager is required');
    }
    const stateManager = config.stateManager;
    const target = config.target || (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.addEventListener !== 'function') {
      throw new TypeError('createInputHandler: target must support addEventListener');
    }

    function handle(key) {
      const current = stateManager.getCurrentSceneName();
      if (key === 'Enter') {
        if (current === 'title' || current === 'gameOver' || current === 'victory') {
          stateManager.changeScene(current === 'title' ? 'playing' : 'title');
          return true;
        }
      }
      if (key === 'p' || key === 'P') {
        if (current === 'playing') return stateManager.changeScene('paused');
        if (current === 'paused') return stateManager.changeScene('playing');
      }
      return false;
    }

    function onKeyDown(event) {
      // Some test environments dispatch plain objects without preventDefault.
      handle(event.key);
    }

    target.addEventListener('keydown', onKeyDown);

    return {
      // Expose the synchronous key handler for unit tests that prefer to
      // bypass DOM event dispatch entirely.
      handleKey: handle,
      detach: function () {
        target.removeEventListener('keydown', onKeyDown);
      },
    };
  }

  const api = { createInputHandler: createInputHandler };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.InputModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
