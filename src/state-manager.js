/**
 * StateManager — scene state machine for the game runtime.
 *
 * Why a factory (not a singleton): tests need fresh instances, and the
 * architecture forbids hidden shared mutable state. Each createStateManager()
 * call returns an isolated closure-scoped instance — no module-level state.
 */
(function (root) {
  'use strict';

  function createStateManager(options) {
    const opts = options || {};
    const allowedTransitions = opts.allowedTransitions || null;
    const warn = opts.logger && opts.logger.warn ? opts.logger.warn : console.warn.bind(console);

    const scenes = new Map();
    let currentName = null;

    function registerScene(name, sceneObj) {
      if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('registerScene: name must be a non-empty string');
      }
      if (sceneObj === null || typeof sceneObj !== 'object') {
        throw new TypeError('registerScene: sceneObj must be an object');
      }
      scenes.set(name, sceneObj);
    }

    function getCurrentScene() {
      if (currentName === null) return null;
      return scenes.get(currentName) || null;
    }

    function getCurrentSceneName() {
      return currentName;
    }

    function changeScene(name) {
      if (!scenes.has(name)) {
        warn('[StateManager] Unknown scene: "' + name + '"');
        return false;
      }
      // First-ever transition is always allowed (no current state to constrain).
      if (currentName !== null && allowedTransitions) {
        const allowed = allowedTransitions[currentName] || [];
        if (!allowed.includes(name)) {
          warn(
            '[StateManager] Invalid transition from "' +
              currentName +
              '" to "' +
              name +
              '" — rejected, state unchanged'
          );
          return false;
        }
      }
      const prev = scenes.get(currentName);
      if (prev && typeof prev.exit === 'function') {
        prev.exit();
      }
      currentName = name;
      const next = scenes.get(currentName);
      if (next && typeof next.enter === 'function') {
        next.enter();
      }
      return true;
    }

    function update(dt) {
      const scene = getCurrentScene();
      if (scene && typeof scene.update === 'function') {
        scene.update(dt);
      }
    }

    function render(ctx) {
      const scene = getCurrentScene();
      if (scene && typeof scene.render === 'function') {
        scene.render(ctx);
      }
    }

    return {
      registerScene: registerScene,
      changeScene: changeScene,
      getCurrentScene: getCurrentScene,
      getCurrentSceneName: getCurrentSceneName,
      update: update,
      render: render,
    };
  }

  const api = { createStateManager: createStateManager };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.StateManagerFactory = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
