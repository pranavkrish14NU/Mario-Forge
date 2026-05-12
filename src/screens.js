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

  const api = {
    createTitleScreen: createTitleScreen,
    createPauseScreen: createPauseScreen,
    createGameOverScreen: createGameOverScreen,
    createVictoryScreen: createVictoryScreen,
    formatTime: formatTime,
    DEFAULTS: DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ScreensModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
