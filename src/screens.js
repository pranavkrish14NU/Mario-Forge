/**
 * Screens — title, pause, game-over, victory (WO-015, REQ-005/REQ-010/REQ-012).
 *
 * Each factory returns a Scene-shaped object: `{ enter, exit, update, render }`
 * compatible with the existing StateManager. update() reads an injected
 * input object (the WO-003 Input module's polling API) and fires the
 * configured transitions; render() draws to the Canvas directly so the
 * screens stay inside the pixel-art aesthetic (REQ-005/REQ-010 AC: no DOM).
 *
 * Pulsing prompts:
 *   render counts frames; the prompt is hidden when `floor(t / pulseInterval)`
 *   is odd, matching the WO-009 player flicker pattern for visual consistency.
 *
 * Pause composition:
 *   pause.render(ctx) calls the previously-active scene's render() first so
 *   the playing world is visible underneath, then paints a darken overlay
 *   and the menu on top. The injected `getUnderlay` callback returns that
 *   prior scene; tests pass a fake.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    pulseInterval: 30,        // frames per visible/hidden swap
    menuPulseInterval: 20,    // selected-row arrow flicker
    titleFont: '24px monospace',
    subtitleFont: '12px monospace',
    bodyFont: '10px monospace',
    bgColor: '#102',
    titleColor: '#fc3',
    bodyColor: '#fff',
    promptColor: '#5cd',
    overlayColor: 'rgba(0,0,0,0.55)',
  });

  function textWidth(ctx, str) {
    if (typeof ctx.measureText === 'function') {
      try {
        const m = ctx.measureText(str);
        return (m && m.width) || str.length * 6;
      } catch (e) {
        return str.length * 6;
      }
    }
    return str.length * 6;
  }

  function drawCenteredText(ctx, text, cx, y, font, color) {
    if ('font' in ctx && font) ctx.font = font;
    ctx.fillStyle = color;
    const w = textWidth(ctx, text);
    const x = Math.round(cx - w / 2);
    if (typeof ctx.fillText === 'function') ctx.fillText(text, x, y);
  }

  function fillBackground(ctx, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------- title ----------

  function createTitleScreen(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (!cfg.width || !cfg.height) throw new TypeError('createTitleScreen: width and height required');
    const transitions = cfg.transitions || {};
    let frame = 0;

    function enter() { frame = 0; }
    function exit() {}
    function update(/* dt */) {
      frame++;
      const input = cfg.input;
      if (input && typeof input.justPressed === 'function' && input.justPressed('confirm')) {
        if (typeof transitions.onStart === 'function') transitions.onStart();
      }
    }
    function render(ctx) {
      fillBackground(ctx, cfg.width, cfg.height, cfg.bgColor);
      const cx = cfg.width / 2;
      drawCenteredText(ctx, cfg.title || 'MARIO FORGE', cx, 48, cfg.titleFont, cfg.titleColor);
      drawCenteredText(ctx, 'A retro pixel platformer', cx, 72, cfg.subtitleFont, cfg.bodyColor);
      drawCenteredText(ctx, 'Arrow / WASD: move    Space: jump    Shift: run    P: pause',
        cx, 110, cfg.bodyFont, cfg.bodyColor);
      const showPrompt = Math.floor(frame / cfg.pulseInterval) % 2 === 0;
      if (showPrompt) {
        drawCenteredText(ctx, 'PRESS ENTER TO START', cx, 150, cfg.subtitleFont, cfg.promptColor);
      }
    }
    return {
      enter: enter, exit: exit, update: update, render: render,
      _frame: function () { return frame; },
    };
  }

  // ---------- pause ----------

  function drawMenu(ctx, items, selectedIndex, cx, baseY, cfg, blinkOn) {
    if ('font' in ctx) ctx.font = cfg.subtitleFont;
    ctx.fillStyle = cfg.bodyColor;
    for (let i = 0; i < items.length; i++) {
      const prefix = (i === selectedIndex && blinkOn) ? '>  ' : '   ';
      drawCenteredText(ctx, prefix + items[i].label, cx, baseY + i * 18,
        cfg.subtitleFont, i === selectedIndex ? cfg.promptColor : cfg.bodyColor);
    }
  }

  function createPauseScreen(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (!cfg.width || !cfg.height) throw new TypeError('createPauseScreen: width and height required');
    const transitions = cfg.transitions || {};
    const items = [
      { label: 'RESUME', action: 'resume' },
      { label: 'RESTART', action: 'restart' },
    ];
    let selectedIndex = 0;
    let frame = 0;

    function enter() { selectedIndex = 0; frame = 0; }
    function exit() {}
    function update(/* dt */) {
      frame++;
      const input = cfg.input;
      if (!input) return;
      if (typeof input.justPressed === 'function') {
        if (input.justPressed('moveUp')) selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        if (input.justPressed('moveDown')) selectedIndex = (selectedIndex + 1) % items.length;
        if (input.justPressed('confirm')) {
          const it = items[selectedIndex];
          if (it.action === 'resume' && transitions.onResume) transitions.onResume();
          else if (it.action === 'restart' && transitions.onRestart) transitions.onRestart();
        }
        if (input.justPressed('restart') && transitions.onRestart) transitions.onRestart();
      }
    }
    function render(ctx) {
      // Underlay (frozen gameplay).
      const under = (typeof cfg.getUnderlay === 'function') ? cfg.getUnderlay() : null;
      if (under && typeof under.render === 'function') under.render(ctx);
      else fillBackground(ctx, cfg.width, cfg.height, cfg.bgColor);
      // Darken overlay.
      ctx.fillStyle = cfg.overlayColor;
      ctx.fillRect(0, 0, cfg.width, cfg.height);
      const cx = cfg.width / 2;
      drawCenteredText(ctx, 'PAUSED', cx, Math.floor(cfg.height / 3), cfg.titleFont, cfg.titleColor);
      const blinkOn = Math.floor(frame / cfg.menuPulseInterval) % 2 === 0;
      drawMenu(ctx, items, selectedIndex, cx, Math.floor(cfg.height / 2), cfg, blinkOn);
    }
    return {
      enter: enter, exit: exit, update: update, render: render,
      _selectedIndex: function () { return selectedIndex; },
      _items: function () { return items; },
    };
  }

  // ---------- game over ----------

  function createGameOverScreen(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (!cfg.width || !cfg.height) throw new TypeError('createGameOverScreen: width and height required');
    const transitions = cfg.transitions || {};
    let frame = 0;

    function enter() { frame = 0; }
    function exit() {}
    function update(/* dt */) {
      frame++;
      const input = cfg.input;
      if (input && typeof input.justPressed === 'function' && input.justPressed('confirm')) {
        if (typeof transitions.onRestart === 'function') transitions.onRestart();
      }
    }
    function render(ctx) {
      fillBackground(ctx, cfg.width, cfg.height, cfg.bgColor);
      const cx = cfg.width / 2;
      drawCenteredText(ctx, 'GAME OVER', cx, Math.floor(cfg.height / 3), cfg.titleFont, cfg.titleColor);
      const score = (typeof cfg.getScore === 'function') ? cfg.getScore() : 0;
      drawCenteredText(ctx, 'FINAL SCORE: ' + score, cx, Math.floor(cfg.height / 2),
        cfg.subtitleFont, cfg.bodyColor);
      const showPrompt = Math.floor(frame / cfg.pulseInterval) % 2 === 0;
      if (showPrompt) {
        drawCenteredText(ctx, 'PRESS ENTER TO RESTART', cx, Math.floor(cfg.height * 0.7),
          cfg.subtitleFont, cfg.promptColor);
      }
    }
    return {
      enter: enter, exit: exit, update: update, render: render,
      _frame: function () { return frame; },
    };
  }

  // ---------- victory ----------

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return (mm < 10 ? '0' + mm : mm) + ':' + (ss < 10 ? '0' + ss : ss);
  }

  function createVictoryScreen(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (!cfg.width || !cfg.height) throw new TypeError('createVictoryScreen: width and height required');
    const transitions = cfg.transitions || {};
    let frame = 0;

    function enter() { frame = 0; }
    function exit() {}
    function update(/* dt */) {
      frame++;
      const input = cfg.input;
      if (input && typeof input.justPressed === 'function' && input.justPressed('confirm')) {
        if (typeof transitions.onRestart === 'function') transitions.onRestart();
      }
    }
    function render(ctx) {
      fillBackground(ctx, cfg.width, cfg.height, cfg.bgColor);
      const cx = cfg.width / 2;
      drawCenteredText(ctx, 'YOU WIN!', cx, Math.floor(cfg.height / 3), cfg.titleFont, cfg.titleColor);
      const score = (typeof cfg.getScore === 'function') ? cfg.getScore() : 0;
      const time = (typeof cfg.getTime === 'function') ? cfg.getTime() : 0;
      drawCenteredText(ctx, 'SCORE: ' + score, cx,
        Math.floor(cfg.height / 2), cfg.subtitleFont, cfg.bodyColor);
      drawCenteredText(ctx, 'TIME: ' + formatTime(time), cx,
        Math.floor(cfg.height / 2) + 18, cfg.subtitleFont, cfg.bodyColor);
      const showPrompt = Math.floor(frame / cfg.pulseInterval) % 2 === 0;
      if (showPrompt) {
        drawCenteredText(ctx, 'PRESS ENTER TO PLAY AGAIN', cx, Math.floor(cfg.height * 0.78),
          cfg.subtitleFont, cfg.promptColor);
      }
    }
    return {
      enter: enter, exit: exit, update: update, render: render,
      _frame: function () { return frame; },
    };
  }

  // ---------- controls (WO-022) ----------
  //
  // Lists the remappable actions with their current key bindings.
  // Up/Down arrows navigate the action list. Enter on a row enters
  // "press-a-key" capture mode, after which the next non-Escape key
  // press is forwarded to a11y.captureKey() which calls input.remap().
  // Escape exits capture mode if active, otherwise closes the screen
  // via transitions.onExit (typically returning to title or pause).
  //
  // The screen is presentational: capture state lives on the injected
  // a11y instance so the screen can be rebuilt (e.g. when high-contrast
  // toggles) without losing an in-progress remap.

  const DEFAULT_REMAPPABLE_ACTIONS = Object.freeze([
    { action: 'moveLeft',  label: 'MOVE LEFT' },
    { action: 'moveRight', label: 'MOVE RIGHT' },
    { action: 'moveUp',    label: 'MOVE UP' },
    { action: 'moveDown',  label: 'MOVE DOWN' },
    { action: 'jump',      label: 'JUMP' },
    { action: 'run',       label: 'RUN' },
    { action: 'pause',     label: 'PAUSE' },
    { action: 'confirm',   label: 'CONFIRM' },
  ]);

  function createControlsScreen(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (!cfg.width || !cfg.height) throw new TypeError('createControlsScreen: width and height required');
    const a11y = cfg.a11y || null;
    const actions = (cfg.actions && cfg.actions.length) ? cfg.actions.slice() : DEFAULT_REMAPPABLE_ACTIONS.slice();
    const transitions = cfg.transitions || {};
    let selectedIndex = 0;
    let frame = 0;

    function enter() { selectedIndex = 0; frame = 0; }
    function exit() {
      // If the screen exits while a remap capture is in progress, abort it
      // so a stray key on the next screen doesn't get bound here.
      if (a11y && typeof a11y.isRemapping === 'function' && a11y.isRemapping()) {
        a11y.cancelRemap();
      }
    }
    function update(/* dt */) {
      frame++;
      const input = cfg.input;
      if (!input) return;
      // While remap-capture is active, swallow navigation/confirm so they
      // don't fire menu actions — the actual key capture is wired via the
      // top-level keydown listener in index.html which calls a11y.captureKey.
      if (a11y && typeof a11y.isRemapping === 'function' && a11y.isRemapping()) return;
      if (typeof input.justPressed !== 'function') return;
      if (input.justPressed('moveUp')) {
        selectedIndex = (selectedIndex - 1 + actions.length) % actions.length;
      }
      if (input.justPressed('moveDown')) {
        selectedIndex = (selectedIndex + 1) % actions.length;
      }
      if (input.justPressed('confirm')) {
        const item = actions[selectedIndex];
        if (a11y && typeof a11y.beginRemap === 'function') {
          a11y.beginRemap(item.action);
        }
      }
    }
    function render(ctx) {
      fillBackground(ctx, cfg.width, cfg.height, cfg.bgColor);
      const cx = cfg.width / 2;
      drawCenteredText(ctx, 'CONTROLS', cx, 28, cfg.titleFont, cfg.titleColor);
      drawCenteredText(ctx, 'Arrows: navigate    Enter: rebind    Esc: back',
        cx, 48, cfg.bodyFont, cfg.bodyColor);
      const blinkOn = Math.floor(frame / cfg.menuPulseInterval) % 2 === 0;
      const baseY = 70;
      const remapping = !!(a11y && typeof a11y.isRemapping === 'function' && a11y.isRemapping());
      const remappingAction = remapping && typeof a11y.getRemapAction === 'function'
        ? a11y.getRemapAction()
        : null;
      for (let i = 0; i < actions.length; i++) {
        const item = actions[i];
        const selected = (i === selectedIndex);
        const isRemappingRow = remapping && remappingAction === item.action;
        const prefix = (selected && (!remapping || isRemappingRow) && blinkOn) ? '>' : ' ';
        const boundKey = (a11y && typeof a11y.getKeyForAction === 'function')
          ? a11y.getKeyForAction(item.action) : null;
        const keyLabel = isRemappingRow
          ? (blinkOn ? '[PRESS ANY KEY]' : '[             ]')
          : (boundKey ? (typeof a11y.describeKey === 'function' ? a11y.describeKey(boundKey) : boundKey) : '—');
        const rowText = prefix + ' ' + item.label + '   ' + keyLabel;
        const color = selected ? cfg.promptColor : cfg.bodyColor;
        drawCenteredText(ctx, rowText, cx, baseY + i * 14, cfg.bodyFont, color);
      }
    }
    // Called by the top-level keydown listener when in capture mode so the
    // screen can show feedback / fire transitions.onExit on Escape-while-idle.
    function handleEscape() {
      if (a11y && typeof a11y.isRemapping === 'function' && a11y.isRemapping()) {
        a11y.cancelRemap();
        return 'cancelled-remap';
      }
      if (typeof transitions.onExit === 'function') {
        transitions.onExit();
        return 'exited';
      }
      return 'ignored';
    }
    return {
      enter: enter, exit: exit, update: update, render: render,
      handleEscape: handleEscape,
      _selectedIndex: function () { return selectedIndex; },
      _actions: function () { return actions.slice(); },
      _frame: function () { return frame; },
    };
  }

  // ---------- level transition ----------

  function createLevelTransitionScreen(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    if (!cfg.width || !cfg.height) throw new TypeError('createLevelTransitionScreen: width and height required');
    const durationFrames = (typeof cfg.durationFrames === 'number') ? cfg.durationFrames : 120;
    const transitions = cfg.transitions || {};
    let frame = 0;
    let completed = false;

    function enter() { frame = 0; completed = false; }
    function exit() {}
    function update(/* dt */) {
      frame++;
      if (!completed && frame >= durationFrames) {
        completed = true;
        if (typeof transitions.onComplete === 'function') transitions.onComplete();
      }
    }
    function render(ctx) {
      fillBackground(ctx, cfg.width, cfg.height, cfg.bgColor);
      const cx = cfg.width / 2;
      const idx = (typeof cfg.getLevelIndex === 'function') ? cfg.getLevelIndex() : 0;
      const name = (typeof cfg.getLevelName === 'function') ? cfg.getLevelName() : '';
      drawCenteredText(ctx, 'LEVEL ' + (idx + 1), cx, Math.floor(cfg.height / 3),
        cfg.titleFont, cfg.titleColor);
      if (name) {
        drawCenteredText(ctx, name, cx, Math.floor(cfg.height / 2),
          cfg.subtitleFont, cfg.bodyColor);
      }
    }

    return {
      enter: enter, exit: exit, update: update, render: render,
      _frame: function () { return frame; },
      _completed: function () { return completed; },
    };
  }

  const api = {
    createTitleScreen: createTitleScreen,
    createPauseScreen: createPauseScreen,
    createGameOverScreen: createGameOverScreen,
    createVictoryScreen: createVictoryScreen,
    createLevelTransitionScreen: createLevelTransitionScreen,
    createControlsScreen: createControlsScreen,
    formatTime: formatTime,
    DEFAULTS: DEFAULTS,
    DEFAULT_REMAPPABLE_ACTIONS: DEFAULT_REMAPPABLE_ACTIONS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ScreensModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
