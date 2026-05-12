/**
 * Input — polling-based keyboard input module (WO-003).
 *
 * Design:
 *   The game loop polls this module once per frame instead of subscribing
 *   to events directly. That lets gameplay code stay synchronous with the
 *   simulation tick and makes "just pressed this frame" semantics easy.
 *
 * Three action states:
 *   - isHeld(action)       : action is currently being held down
 *   - justPressed(action)  : action transitioned to pressed since the last update()
 *   - justReleased(action) : action transitioned to released since the last update()
 *
 * Frame contract:
 *   Call input.update() ONCE at the start of every frame. That call clears
 *   the previous frame's justPressed / justReleased flags. Actions added by
 *   keydown/keyup events between two update() calls are visible until the
 *   next update() runs.
 *
 * Remapping:
 *   The key→action map is held in a mutable object so settings UI (future
 *   WO-022) can call remap(key, action). DEFAULT_KEY_MAP is frozen, but the
 *   working map is shallow-copied so callers can mutate without contaminating
 *   the default.
 */
(function (root) {
  'use strict';

  const DEFAULT_KEY_MAP = Object.freeze({
    // Arrows
    ArrowLeft: 'moveLeft',
    ArrowRight: 'moveRight',
    ArrowUp: 'moveUp',
    ArrowDown: 'moveDown',
    // WASD (both cases — caps-lock and shift-modified inputs both arrive)
    a: 'moveLeft', A: 'moveLeft',
    d: 'moveRight', D: 'moveRight',
    w: 'moveUp', W: 'moveUp',
    s: 'moveDown', S: 'moveDown',
    // Action keys
    ' ': 'jump',
    Spacebar: 'jump', // legacy browsers
    Shift: 'run',
    p: 'pause', P: 'pause',
    m: 'mute', M: 'mute',
    Enter: 'confirm',
  });

  // Keys whose default browser action we suppress (page scrolling on arrows
  // and Space, form submission on Enter, focus-jump on Tab).
  const DEFAULT_GAME_KEYS = Object.freeze([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    ' ', 'Spacebar', 'Tab', 'Enter',
    'p', 'P', 'm', 'M',
  ]);

  function createInput(config) {
    const cfg = config || {};
    const target = cfg.target || (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.addEventListener !== 'function') {
      throw new TypeError('createInput: target must support addEventListener');
    }
    // Shallow-copy DEFAULT_KEY_MAP so caller mutations (via remap) do not
    // leak into the frozen default. A caller-supplied keyMap fully replaces
    // the default — useful for headless tests with a minimal map.
    const keyMap = cfg.keyMap ? Object.assign({}, cfg.keyMap) : Object.assign({}, DEFAULT_KEY_MAP);
    const gameKeys = new Set(cfg.gameKeys || DEFAULT_GAME_KEYS);

    const heldActions = new Set();
    const justPressedActions = new Set();
    const justReleasedActions = new Set();

    function actionFor(key) {
      return Object.prototype.hasOwnProperty.call(keyMap, key) ? keyMap[key] : null;
    }

    function onKeyDown(event) {
      if (gameKeys.has(event.key) && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      // OS auto-repeat fires repeated keydowns while a key is held. We only
      // care about the initial press — drop repeats so justPressed stays true
      // for exactly one frame.
      if (event.repeat) return;
      const action = actionFor(event.key);
      if (!action) return;
      if (!heldActions.has(action)) {
        heldActions.add(action);
        justPressedActions.add(action);
      }
    }

    function onKeyUp(event) {
      const action = actionFor(event.key);
      if (!action) return;
      if (heldActions.has(action)) {
        heldActions.delete(action);
        justReleasedActions.add(action);
      }
    }

    // When the window loses focus mid-press, keyup never arrives — without
    // this hook the action would remain stuck "held" forever. Treat blur as
    // a release for every held action.
    function onBlur() {
      heldActions.forEach((a) => justReleasedActions.add(a));
      heldActions.clear();
    }

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);

    // Virtual press/release used by non-keyboard input sources (WO-019 touch,
    // future WO-024 gamepad). Hits the same heldActions / justPressed sets as
    // physical keys so all downstream consumers see a single unified buffer.
    // Idempotent — pressing an already-held action does NOT re-fire
    // justPressed; releasing a non-held action is a no-op.
    function virtualPress(action) {
      if (typeof action !== 'string' || !action) return;
      if (heldActions.has(action)) return;
      heldActions.add(action);
      justPressedActions.add(action);
    }

    function virtualRelease(action) {
      if (typeof action !== 'string' || !action) return;
      if (!heldActions.has(action)) return;
      heldActions.delete(action);
      justReleasedActions.add(action);
    }

    return {
      update: function () {
        justPressedActions.clear();
        justReleasedActions.clear();
      },
      virtualPress: virtualPress,
      virtualRelease: virtualRelease,
      isHeld: function (action) {
        return heldActions.has(action);
      },
      justPressed: function (action) {
        return justPressedActions.has(action);
      },
      justReleased: function (action) {
        return justReleasedActions.has(action);
      },
      remap: function (key, action) {
        if (typeof key !== 'string' || typeof action !== 'string') {
          throw new TypeError('remap: key and action must be strings');
        }
        keyMap[key] = action;
      },
      unmap: function (key) {
        delete keyMap[key];
      },
      getKeyMap: function () {
        return Object.assign({}, keyMap);
      },
      detach: function () {
        target.removeEventListener('keydown', onKeyDown);
        target.removeEventListener('keyup', onKeyUp);
        target.removeEventListener('blur', onBlur);
      },
    };
  }

  const api = {
    createInput: createInput,
    DEFAULT_KEY_MAP: DEFAULT_KEY_MAP,
    DEFAULT_GAME_KEYS: DEFAULT_GAME_KEYS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.InputModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
