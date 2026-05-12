'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createA11y,
  DEFAULT_SCREEN_PALETTE,
  DEFAULT_TILE_PALETTE,
  HIGH_CONTRAST_SCREEN_PALETTE,
  HIGH_CONTRAST_TILE_PALETTE,
  NON_BINDABLE_KEYS,
} = require('../src/a11y.js');

// ----------------------------------------------------------------------
// Stub DOM — just enough for createA11y to wire a live region + canvas.
// ----------------------------------------------------------------------

function makeStubDoc() {
  const created = [];
  const body = {
    appendChild: function (n) { body._children.push(n); },
    _children: [],
  };
  function makeNode(tag) {
    const attrs = {};
    const node = {
      tagName: tag.toUpperCase(),
      textContent: '',
      style: {},
      parentNode: null,
      setAttribute: function (k, v) { attrs[k] = String(v); },
      getAttribute: function (k) { return attrs.hasOwnProperty(k) ? attrs[k] : null; },
      removeAttribute: function (k) { delete attrs[k]; },
      _attrs: attrs,
    };
    return node;
  }
  // body.appendChild needs to set parentNode on children for detach() cleanup.
  body.appendChild = function (n) {
    n.parentNode = body;
    body._children.push(n);
    body.removeChild = function (child) {
      const i = body._children.indexOf(child);
      if (i !== -1) body._children.splice(i, 1);
      child.parentNode = null;
    };
  };
  // Pre-wire removeChild so detach() can call body.removeChild on the live region.
  body.removeChild = function (child) {
    const i = body._children.indexOf(child);
    if (i !== -1) body._children.splice(i, 1);
    child.parentNode = null;
  };
  return {
    createElement: function (tag) { const n = makeNode(tag); created.push(n); return n; },
    body: body,
    _created: created,
  };
}

function makeStubWin(prefersReduced) {
  return {
    matchMedia: function (q) {
      return { matches: q.indexOf('reduce') !== -1 ? !!prefersReduced : false };
    },
  };
}

function makeStubInput() {
  const map = {
    ArrowLeft: 'moveLeft', ArrowRight: 'moveRight',
    ArrowUp: 'moveUp', ArrowDown: 'moveDown',
    ' ': 'jump', Shift: 'run',
    p: 'pause', P: 'pause',
    Enter: 'confirm',
  };
  return {
    remap: function (key, action) { map[key] = action; },
    unmap: function (key) { delete map[key]; },
    getKeyMap: function () { return Object.assign({}, map); },
    _map: map,
  };
}

// ----------------------------------------------------------------------
// Factory validation
// ----------------------------------------------------------------------

test('createA11y requires doc with createElement', () => {
  assert.throws(() => createA11y({ doc: {} }), TypeError);
  assert.throws(() => createA11y({ doc: null, win: {} }), TypeError);
});

test('createA11y attaches a polite aria-live region to body', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  const live = a11y._liveRegion();
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.equal(live.getAttribute('aria-atomic'), 'true');
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(doc.body._children.length, 1);
  assert.equal(doc.body._children[0], live);
});

test('createA11y uses caller-supplied liveRegion (does not append a new one)', () => {
  const doc = makeStubDoc();
  const ours = doc.createElement('div');
  // Reset the captured `created` count to assert no extra creations.
  doc._created.length = 0;
  const a11y = createA11y({ doc: doc, win: makeStubWin(), liveRegion: ours });
  assert.equal(a11y._liveRegion(), ours);
  assert.equal(doc.body._children.length, 0); // not auto-appended
});

// ----------------------------------------------------------------------
// AC1 + AC2: announcement throttling
// ----------------------------------------------------------------------

test('AC1: announce writes textContent to the live region', () => {
  const doc = makeStubDoc();
  let now = 0;
  const a11y = createA11y({ doc: doc, win: makeStubWin(), nowFn: function () { return now; } });
  assert.ok(a11y.announce('Level 1: Grassland'));
  assert.equal(a11y._liveRegion().textContent, 'Level 1: Grassland');
});

test('AC2: announce throttles to 1 message per throttleMs window', () => {
  const doc = makeStubDoc();
  let now = 0;
  const a11y = createA11y({
    doc: doc, win: makeStubWin(),
    throttleMs: 1000,
    nowFn: function () { return now; },
  });
  assert.equal(a11y.announce('first'), true);
  // 100ms later — within window, dropped.
  now = 100;
  assert.equal(a11y.announce('second'), false);
  assert.equal(a11y._liveRegion().textContent, 'first');
  // 999ms later — still inside window, dropped.
  now = 999;
  assert.equal(a11y.announce('third'), false);
  // 1000ms — boundary, throttle window is now-elapsed strictly less than
  // throttleMs, so an announcement exactly at throttleMs is allowed.
  now = 1000;
  assert.equal(a11y.announce('fourth'), true);
  assert.equal(a11y._liveRegion().textContent, 'fourth');
});

test('AC2: force=true bypasses time throttle but still de-dupes identical text', () => {
  const doc = makeStubDoc();
  let now = 0;
  const a11y = createA11y({ doc: doc, win: makeStubWin(), nowFn: function () { return now; } });
  a11y.announce('first');
  assert.equal(a11y.announce('first', { force: true }), false, 'identical text within window');
  assert.equal(a11y.announce('second', { force: true }), true);
});

test('announce rejects non-string / empty input', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  assert.equal(a11y.announce(''), false);
  assert.equal(a11y.announce(null), false);
  assert.equal(a11y.announce(undefined), false);
  assert.equal(a11y.announce(42), false);
});

// ----------------------------------------------------------------------
// AC3: high-contrast palette
// ----------------------------------------------------------------------

test('AC3: getPalette returns default colours when high contrast is off', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  const p = a11y.getPalette();
  assert.equal(p.screen, DEFAULT_SCREEN_PALETTE);
  assert.equal(p.tile, DEFAULT_TILE_PALETTE);
});

test('AC3: setHighContrast(true) switches to high-contrast palette and emits change', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  const events = [];
  a11y.onChange(function (s) { events.push(s); });
  assert.equal(a11y.isHighContrast(), false);
  assert.equal(a11y.setHighContrast(true), true);
  assert.equal(a11y.isHighContrast(), true);
  assert.equal(a11y.getPalette().tile, HIGH_CONTRAST_TILE_PALETTE);
  assert.equal(a11y.getPalette().screen, HIGH_CONTRAST_SCREEN_PALETTE);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'highContrast');
  assert.equal(events[0].highContrast, true);
});

test('setHighContrast: no-op when value does not change', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  const events = [];
  a11y.onChange(function (s) { events.push(s); });
  assert.equal(a11y.setHighContrast(false), false);
  assert.equal(events.length, 0);
});

test('toggleHighContrast flips state', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  a11y.toggleHighContrast();
  assert.equal(a11y.isHighContrast(), true);
  a11y.toggleHighContrast();
  assert.equal(a11y.isHighContrast(), false);
});

test('toggling high contrast announces the new state', () => {
  const doc = makeStubDoc();
  let now = 0;
  const a11y = createA11y({ doc: doc, win: makeStubWin(), nowFn: function () { return now; } });
  a11y.setHighContrast(true);
  assert.equal(a11y._liveRegion().textContent, 'High contrast on');
  now = 5000;
  a11y.setHighContrast(false);
  assert.equal(a11y._liveRegion().textContent, 'High contrast off');
});

// ----------------------------------------------------------------------
// AC6: prefers-reduced-motion detection + manual override
// ----------------------------------------------------------------------

test('AC6: reduced-motion auto-detects from prefers-reduced-motion media query', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin(true) });
  assert.equal(a11y.isReducedMotion(), true);
});

test('AC6: reduced-motion defaults to false without media query support', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: { /* no matchMedia */ } });
  assert.equal(a11y.isReducedMotion(), false);
});

test('AC6: setReducedMotion overrides and emits change', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin(false) });
  const events = [];
  a11y.onChange(function (s) { events.push(s); });
  assert.equal(a11y.setReducedMotion(true), true);
  assert.equal(a11y.isReducedMotion(), true);
  assert.equal(events[0].reason, 'reducedMotion');
});

test('AC6: explicit initialReducedMotion overrides media query', () => {
  const doc = makeStubDoc();
  // Media says yes, caller forces no.
  const a11y = createA11y({ doc: doc, win: makeStubWin(true), initialReducedMotion: false });
  assert.equal(a11y.isReducedMotion(), false);
});

// ----------------------------------------------------------------------
// AC4 + AC5: remap capture
// ----------------------------------------------------------------------

test('AC4: beginRemap requires a non-empty action string', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  assert.throws(() => a11y.beginRemap(), TypeError);
  assert.throws(() => a11y.beginRemap(''), TypeError);
  assert.throws(() => a11y.beginRemap(123), TypeError);
});

test('AC4: captureKey is idle until beginRemap is called', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  assert.deepEqual(a11y.captureKey('q'), { status: 'idle' });
});

test('AC4 + AC5: captureKey binds the next non-Escape key to the action via input.remap', () => {
  const doc = makeStubDoc();
  const input = makeStubInput();
  const a11y = createA11y({ doc: doc, win: makeStubWin(), input: input });
  a11y.beginRemap('jump');
  assert.equal(a11y.isRemapping(), true);
  assert.equal(a11y.getRemapAction(), 'jump');
  const result = a11y.captureKey('z');
  assert.equal(result.status, 'bound');
  assert.equal(result.action, 'jump');
  assert.equal(result.key, 'z');
  assert.equal(a11y.isRemapping(), false);
  assert.equal(input._map['z'], 'jump');
});

test('AC4: captureKey Escape cancels remap without binding', () => {
  const doc = makeStubDoc();
  const input = makeStubInput();
  const original = Object.assign({}, input._map);
  const a11y = createA11y({ doc: doc, win: makeStubWin(), input: input });
  a11y.beginRemap('run');
  const result = a11y.captureKey('Escape');
  assert.equal(result.status, 'cancelled');
  assert.equal(a11y.isRemapping(), false);
  // No binding should have changed.
  assert.deepEqual(input._map, original);
});

test('AC4: captureKey ignores modifier-only keys and stays in capture mode', () => {
  const doc = makeStubDoc();
  const input = makeStubInput();
  const a11y = createA11y({ doc: doc, win: makeStubWin(), input: input });
  a11y.beginRemap('jump');
  const r = a11y.captureKey('Shift');
  assert.equal(r.status, 'ignored');
  assert.equal(r.reason, 'non-bindable');
  assert.equal(a11y.isRemapping(), true);
});

test('AC4: captureKey invokes onComplete callback on bind', () => {
  const doc = makeStubDoc();
  const input = makeStubInput();
  const a11y = createA11y({ doc: doc, win: makeStubWin(), input: input });
  let cb = null;
  a11y.beginRemap('jump', function (info) { cb = info; });
  a11y.captureKey('q');
  assert.equal(cb.status, 'bound');
  assert.equal(cb.action, 'jump');
  assert.equal(cb.key, 'q');
});

test('NON_BINDABLE_KEYS covers Escape, Tab, modifiers', () => {
  ['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta'].forEach(k => {
    assert.equal(NON_BINDABLE_KEYS[k], true, k + ' should be non-bindable');
  });
});

test('AC5: captureKey is a no-op without an input module (graceful degrade)', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() }); // no input
  a11y.beginRemap('jump');
  // Should not throw — captureKey just resolves without calling input.remap.
  const r = a11y.captureKey('q');
  assert.equal(r.status, 'bound');
});

// ----------------------------------------------------------------------
// Reverse lookup: getKeyForAction
// ----------------------------------------------------------------------

test('getKeyForAction returns the first key bound to an action', () => {
  const doc = makeStubDoc();
  const input = makeStubInput();
  const a11y = createA11y({ doc: doc, win: makeStubWin(), input: input });
  assert.equal(a11y.getKeyForAction('jump'), ' ');
  assert.equal(a11y.getKeyForAction('confirm'), 'Enter');
  assert.equal(a11y.getKeyForAction('nonexistent'), null);
});

test('getKeyForAction returns null without an input module', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  assert.equal(a11y.getKeyForAction('jump'), null);
});

// ----------------------------------------------------------------------
// describeKey
// ----------------------------------------------------------------------

test('describeKey produces human-readable labels', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  assert.equal(a11y.describeKey(' '), 'Space');
  assert.equal(a11y.describeKey('ArrowLeft'), 'Left arrow');
  assert.equal(a11y.describeKey('ArrowRight'), 'Right arrow');
  assert.equal(a11y.describeKey('ArrowUp'), 'Up arrow');
  assert.equal(a11y.describeKey('ArrowDown'), 'Down arrow');
  assert.equal(a11y.describeKey('Enter'), 'Enter');
  assert.equal(a11y.describeKey('Escape'), 'Escape');
  assert.equal(a11y.describeKey('Shift'), 'Shift');
  assert.equal(a11y.describeKey('z'), 'Z');
  assert.equal(a11y.describeKey('Q'), 'Q');
  // Long key names pass through unchanged.
  assert.equal(a11y.describeKey('PageUp'), 'PageUp');
});

// ----------------------------------------------------------------------
// AC8: Canvas ARIA helpers
// ----------------------------------------------------------------------

test('AC8: applyCanvasAria sets role, aria-label, aria-describedby and tabIndex', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  const canvas = doc.createElement('canvas');
  canvas.tabIndex = -1;
  a11y.applyCanvasAria(canvas, {
    role: 'application',
    label: 'Test canvas',
    describedBy: 'instructions',
  });
  assert.equal(canvas.getAttribute('role'), 'application');
  assert.equal(canvas.getAttribute('aria-label'), 'Test canvas');
  assert.equal(canvas.getAttribute('aria-describedby'), 'instructions');
  assert.equal(canvas.tabIndex, 0);
});

test('applyCanvasAria defaults role to application and is safe with no opts', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  const canvas = doc.createElement('canvas');
  a11y.applyCanvasAria(canvas);
  assert.equal(canvas.getAttribute('role'), 'application');
});

test('applyCanvasAria returns false for null / invalid elements', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  assert.equal(a11y.applyCanvasAria(null), false);
  assert.equal(a11y.applyCanvasAria({}), false);
});

// ----------------------------------------------------------------------
// Domain-specific announcement helpers (WO-022 AC1 wording)
// ----------------------------------------------------------------------

test('AC1: announceLevelStart formats "Level N: name"', () => {
  const doc = makeStubDoc();
  let now = 0;
  const a11y = createA11y({ doc: doc, win: makeStubWin(), nowFn: function () { return now; } });
  a11y.announceLevelStart(0, 'Grassland');
  assert.equal(a11y._liveRegion().textContent, 'Level 1: Grassland');
  now = 5000;
  a11y.announceLevelStart(2);
  assert.equal(a11y._liveRegion().textContent, 'Level 3');
});

test('AC1: announceScoreMilestone announces the score', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  a11y.announceScoreMilestone(500);
  assert.equal(a11y._liveRegion().textContent, 'Score 500');
});

test('AC1: announceDamage uses singular for 1 life', () => {
  const doc = makeStubDoc();
  let now = 0;
  const a11y = createA11y({ doc: doc, win: makeStubWin(), nowFn: function () { return now; } });
  a11y.announceDamage(2);
  assert.equal(a11y._liveRegion().textContent, 'Hit! 2 lives remaining');
  now = 5000;
  a11y.announceDamage(1);
  assert.equal(a11y._liveRegion().textContent, 'Hit! 1 life remaining');
});

test('AC1: announceGameOver includes the final score', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  a11y.announceGameOver(1500);
  assert.equal(a11y._liveRegion().textContent, 'Game over. Score: 1500');
});

test('AC1: announceVictory includes the final score', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  a11y.announceVictory(3000);
  assert.equal(a11y._liveRegion().textContent, 'Victory! Score: 3000');
});

test('announcePause toggles between Paused and Resumed', () => {
  const doc = makeStubDoc();
  let now = 0;
  const a11y = createA11y({ doc: doc, win: makeStubWin(), nowFn: function () { return now; } });
  a11y.announcePause(true);
  assert.equal(a11y._liveRegion().textContent, 'Paused');
  now = 5000;
  a11y.announcePause(false);
  assert.equal(a11y._liveRegion().textContent, 'Resumed');
});

// ----------------------------------------------------------------------
// onChange / unsubscribe
// ----------------------------------------------------------------------

test('onChange returns an unsubscribe function', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  const events = [];
  const off = a11y.onChange(function (s) { events.push(s); });
  a11y.setHighContrast(true);
  assert.equal(events.length, 1);
  off();
  a11y.setHighContrast(false);
  assert.equal(events.length, 1);
});

test('onChange swallows listener errors without breaking other listeners', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  let secondCalled = false;
  a11y.onChange(function () { throw new Error('boom'); });
  a11y.onChange(function () { secondCalled = true; });
  a11y.setHighContrast(true);
  assert.equal(secondCalled, true);
});

// ----------------------------------------------------------------------
// detach
// ----------------------------------------------------------------------

test('detach removes the auto-created live region from body', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  assert.equal(doc.body._children.length, 1);
  a11y.detach();
  assert.equal(doc.body._children.length, 0);
});

test('detach does NOT remove a caller-supplied live region', () => {
  const doc = makeStubDoc();
  const ours = doc.createElement('div');
  doc.body.appendChild(ours);
  const a11y = createA11y({ doc: doc, win: makeStubWin(), liveRegion: ours });
  assert.equal(doc.body._children.length, 1);
  a11y.detach();
  assert.equal(doc.body._children.length, 1); // still there
});

test('detach clears listeners and remap state', () => {
  const doc = makeStubDoc();
  const a11y = createA11y({ doc: doc, win: makeStubWin() });
  let called = false;
  a11y.onChange(function () { called = true; });
  a11y.beginRemap('jump');
  a11y.detach();
  // setHighContrast after detach: no listeners fire.
  a11y.setHighContrast(true);
  assert.equal(called, false);
  assert.equal(a11y.isRemapping(), false);
});
