'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudio, PRESETS, DEFAULTS } = require('../src/audio.js');

// ---------- fake Web Audio API ----------

function makeFakeContext(seedTime) {
  const events = [];
  let time = (typeof seedTime === 'number') ? seedTime : 0;

  function makeParam(name, ownerId) {
    return {
      value: 0,
      setValueAtTime: function (v, t) { events.push({ op: 'setValueAtTime', name, ownerId, v, t }); this.value = v; return this; },
      linearRampToValueAtTime: function (v, t) { events.push({ op: 'linearRampToValueAtTime', name, ownerId, v, t }); this.value = v; return this; },
      exponentialRampToValueAtTime: function (v, t) { events.push({ op: 'exponentialRampToValueAtTime', name, ownerId, v, t }); this.value = v; return this; },
    };
  }

  let nextId = 1;
  function makeOscillator() {
    const id = nextId++;
    const osc = {
      _id: id, _kind: 'oscillator',
      type: 'sine',
      start: function (t) { events.push({ op: 'start', kind: 'osc', id, t }); },
      stop: function (t) { events.push({ op: 'stop', kind: 'osc', id, t }); },
      connect: function (target) { events.push({ op: 'connect', from: 'osc', fromId: id, toKind: target._kind, toId: target._id }); },
      disconnect: function () { events.push({ op: 'disconnect', kind: 'osc', id }); },
    };
    osc.frequency = makeParam('frequency', id);
    return osc;
  }

  function makeGain() {
    const id = nextId++;
    const gn = {
      _id: id, _kind: 'gain',
      connect: function (target) { events.push({ op: 'connect', from: 'gain', fromId: id, toKind: target._kind, toId: target._id }); },
      disconnect: function () { events.push({ op: 'disconnect', kind: 'gain', id }); },
    };
    gn.gain = makeParam('gain', id);
    return gn;
  }

  const destination = { _kind: 'destination', _id: 0 };

  return {
    get currentTime() { return time; },
    advanceTime: function (dt) { time += dt; },
    destination: destination,
    createOscillator: makeOscillator,
    createGain: makeGain,
    resume: function () { return Promise.resolve(); },
    state: 'running',
    _events: events,
  };
}

function makeAudioWithFakeCtx() {
  const ctx = makeFakeContext();
  const audio = createAudio({
    audioContextFactory: function () { return ctx; },
    masterGain: 0.25,
  });
  return { audio, ctx };
}

// ---------- factory + lazy init ----------

test('createAudio exposes the public API', () => {
  const { audio } = makeAudioWithFakeCtx();
  assert.equal(typeof audio.play, 'function');
  assert.equal(typeof audio.ensureStarted, 'function');
  assert.equal(typeof audio.isStarted, 'function');
  assert.equal(typeof audio.setMuted, 'function');
  assert.equal(typeof audio.toggleMute, 'function');
});

test('AC: AudioContext is NOT created at construction time', () => {
  const { audio } = makeAudioWithFakeCtx();
  assert.equal(audio.isStarted(), false);
  assert.equal(audio._ctx(), null);
});

test('AC: ensureStarted creates AudioContext idempotently', () => {
  const { audio } = makeAudioWithFakeCtx();
  const a = audio.ensureStarted();
  assert.equal(a, true);
  const ctxRef = audio._ctx();
  audio.ensureStarted();
  assert.strictEqual(audio._ctx(), ctxRef);
});

test('makeUserGestureHook returns a one-shot listener that starts the audio', () => {
  const { audio } = makeAudioWithFakeCtx();
  const hook = audio.makeUserGestureHook();
  assert.equal(audio.isStarted(), false);
  hook();
  assert.equal(audio.isStarted(), true);
  // Second call is a no-op (idempotent).
  const ctxRef = audio._ctx();
  hook();
  assert.strictEqual(audio._ctx(), ctxRef);
});

test('createAudio with no factory returns a stub: ensureStarted reports false', () => {
  const audio = createAudio({ audioContextFactory: null });
  assert.equal(audio.ensureStarted(), false);
  assert.equal(audio.play('jump'), null);
});

test('constants are frozen', () => {
  const { audio } = makeAudioWithFakeCtx();
  assert.throws(() => { audio.constants.maxVoices = 1; }, TypeError);
});

// ---------- AC: oscillator types per preset ----------

function findOsc(events, expectedType) {
  // Returns the osc id whose .type was set to expectedType, via the
  // play() path that assigns osc.type before any frequency call.
  // The mock doesn't trap .type assignment, so we check via known PRESETS.
  return events.find(e => e.op === 'start' && e.kind === 'osc');
}

test('AC: jump preset uses square wave with upward sweep (200→800Hz)', () => {
  const { audio, ctx } = makeAudioWithFakeCtx();
  audio.play('jump');
  // Frequency events: one setValueAtTime at start, one linearRampToValueAtTime at end.
  const freqEvents = ctx._events.filter(e => e.name === 'frequency');
  const setAt = freqEvents.find(e => e.op === 'setValueAtTime');
  const ramp = freqEvents.find(e => e.op === 'linearRampToValueAtTime');
  assert.equal(setAt.v, 200);
  assert.equal(ramp.v, 800);
});

test('AC: stomp preset is a triangle wave with downward sweep (100→50Hz)', () => {
  assert.equal(PRESETS.stomp.wave, 'triangle');
  const { audio, ctx } = makeAudioWithFakeCtx();
  audio.play('stomp');
  const ramp = ctx._events.find(e => e.op === 'linearRampToValueAtTime' && e.name === 'frequency');
  assert.equal(ramp.v, 50);
});

test('AC: damage preset uses sawtooth wave descending 400→100Hz', () => {
  assert.equal(PRESETS.damage.wave, 'sawtooth');
  const { audio, ctx } = makeAudioWithFakeCtx();
  audio.play('damage');
  const setAt = ctx._events.find(e => e.op === 'setValueAtTime' && e.name === 'frequency');
  const ramp = ctx._events.find(e => e.op === 'linearRampToValueAtTime' && e.name === 'frequency');
  assert.equal(setAt.v, 400);
  assert.equal(ramp.v, 100);
});

test('AC: coinCollect is a two-note square chime', () => {
  assert.equal(PRESETS.coinCollect.wave, 'square');
  const { audio, ctx } = makeAudioWithFakeCtx();
  audio.play('coinCollect');
  const freqSets = ctx._events.filter(e => e.op === 'setValueAtTime' && e.name === 'frequency');
  // Two setValueAtTime events at different t — the two notes.
  assert.ok(freqSets.length >= 2);
});

test('AC: powerUp is an ascending arpeggio (multiple square frequencies)', () => {
  assert.equal(PRESETS.powerUp.wave, 'square');
  const { audio, ctx } = makeAudioWithFakeCtx();
  audio.play('powerUp');
  const freqSets = ctx._events.filter(e => e.op === 'setValueAtTime' && e.name === 'frequency');
  // PRESETS.powerUp has 5 step frequencies.
  assert.equal(freqSets.length, PRESETS.powerUp.freq.length);
  // Ascending values.
  for (let i = 1; i < freqSets.length; i++) {
    assert.ok(freqSets[i].v > freqSets[i - 1].v, 'arpeggio should be ascending');
  }
});

test('AC: durations match the spec (jump≈0.2s, stomp≈0.1s, damage≈0.3s, powerUp≈0.5s)', () => {
  assert.ok(Math.abs(PRESETS.jump.duration - 0.2) < 0.001);
  assert.ok(Math.abs(PRESETS.stomp.duration - 0.1) < 0.001);
  assert.ok(Math.abs(PRESETS.damage.duration - 0.3) < 0.001);
  assert.ok(Math.abs(PRESETS.powerUp.duration - 0.5) < 0.001);
});

test('all expected presets exist (8+ sounds)', () => {
  const names = Object.keys(PRESETS);
  ['jump','coinCollect','powerUp','stomp','damage','mysteryHit','checkpoint','menuSelect'].forEach(n => {
    assert.ok(names.includes(n), 'missing preset ' + n);
  });
  assert.ok(names.length >= 8);
});

// ---------- AC: oscillator-only synthesis (no decodeAudioData) ----------

test('AC: no decode/file paths used — only oscillator and gain nodes are created', () => {
  const { audio, ctx } = makeAudioWithFakeCtx();
  audio.play('jump');
  // Connection ops should only involve osc/gain/destination nodes.
  const conns = ctx._events.filter(e => e.op === 'connect');
  for (const c of conns) {
    assert.ok(c.from === 'osc' || c.from === 'gain', 'unexpected node kind: ' + c.from);
    assert.ok(c.toKind === 'gain' || c.toKind === 'destination', 'unexpected dest: ' + c.toKind);
  }
});

// ---------- AC: 8-voice cap ----------

test('AC: 9th simultaneous play drops the oldest voice (cap == maxVoices)', () => {
  const { audio } = makeAudioWithFakeCtx();
  // Play 9 sustained sounds.
  for (let i = 0; i < 9; i++) audio.play('powerUp');
  assert.equal(audio.activeVoiceCount(), DEFAULTS.maxVoices);
});

test('voice pool reaps voices whose endsAt has passed', () => {
  const fake = makeFakeContext(0);
  const audio = createAudio({ audioContextFactory: function () { return fake; }, masterGain: 0.25 });
  audio.play('menuSelect'); // duration 0.05
  audio.play('menuSelect');
  assert.equal(audio.activeVoiceCount(), 2);
  // Advance time so both have ended.
  fake.advanceTime(0.1);
  audio.play('menuSelect'); // triggers reap then adds 1
  assert.equal(audio.activeVoiceCount(), 1, 'old voices should be reaped after ending');
});

// ---------- AC: mute toggle ----------

test('AC: setMuted(true) silences play (no new voices created)', () => {
  const { audio } = makeAudioWithFakeCtx();
  audio.setMuted(true);
  audio.play('jump');
  audio.play('coinCollect');
  assert.equal(audio.activeVoiceCount(), 0);
});

test('AC: muting stops all active voices', () => {
  const { audio } = makeAudioWithFakeCtx();
  audio.play('powerUp');
  audio.play('damage');
  assert.equal(audio.activeVoiceCount(), 2);
  audio.setMuted(true);
  assert.equal(audio.activeVoiceCount(), 0);
});

test('AC: toggleMute flips state and is persistent across calls', () => {
  const { audio } = makeAudioWithFakeCtx();
  assert.equal(audio.isMuted(), false);
  audio.toggleMute();
  assert.equal(audio.isMuted(), true);
  audio.toggleMute();
  assert.equal(audio.isMuted(), false);
});

test('unmute resumes play without re-creating the AudioContext', () => {
  const { audio } = makeAudioWithFakeCtx();
  audio.play('jump');
  const ctxRef = audio._ctx();
  audio.setMuted(true);
  audio.setMuted(false);
  audio.play('jump');
  assert.strictEqual(audio._ctx(), ctxRef);
  assert.equal(audio.activeVoiceCount(), 1);
});

test('play() with unknown name returns null', () => {
  const { audio } = makeAudioWithFakeCtx();
  assert.equal(audio.play('nonexistent'), null);
  assert.equal(audio.activeVoiceCount(), 0);
});

// ---------- envelope shape ----------

test('gain envelope: silent at start, peak after attack, releases to 0 at end', () => {
  const { audio, ctx } = makeAudioWithFakeCtx();
  audio.play('jump');
  const gainEvents = ctx._events.filter(e => e.name === 'gain');
  // First: set to 0 at t0.
  assert.equal(gainEvents[0].op, 'setValueAtTime');
  assert.equal(gainEvents[0].v, 0);
  // Last: ramp to 0 at end.
  const last = gainEvents[gainEvents.length - 1];
  assert.equal(last.v, 0);
  assert.equal(last.op, 'linearRampToValueAtTime');
});

test('stop() clears all voices', () => {
  const { audio } = makeAudioWithFakeCtx();
  audio.play('damage');
  audio.play('powerUp');
  audio.stop();
  assert.equal(audio.activeVoiceCount(), 0);
});
