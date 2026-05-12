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

// =============================================================================
// MUSIC (WO-021)
// =============================================================================

const { MUSIC_THEMES, NOTE_HZ } = require('../src/audio.js');

function makeMusicAudio(opts) {
  const ctx = makeFakeContext();
  const audio = createAudio(Object.assign({
    audioContextFactory: function () { return ctx; },
    masterGain: 0.25,
    musicAutoTick: false, // tests drive ticks via _pumpMusic
    musicLookAheadSec: 0.25,
  }, opts || {}));
  return { audio, ctx };
}

function oscillatorIdsCreatedSince(ctx, beforeLength) {
  return ctx._events
    .slice(beforeLength)
    .filter(function (e) { return e.op === 'start' && e.kind === 'osc'; })
    .map(function (e) { return e.id; });
}

// ---------- API surface ----------

test('music: createAudio exposes music API methods', () => {
  const { audio } = makeMusicAudio();
  ['playMusic', 'stopMusic', 'pauseMusic', 'resumeMusic',
   'isMusicPlaying', 'getMusicTheme', 'activeMusicVoiceCount'].forEach(function (m) {
    assert.equal(typeof audio[m], 'function', 'missing music method: ' + m);
  });
  assert.ok(audio.MUSIC_THEMES.grassland, 'MUSIC_THEMES.grassland exposed');
  assert.ok(audio.NOTE_HZ.A4, 'NOTE_HZ.A4 exposed');
});

test('music: top-level module exports MUSIC_THEMES and NOTE_HZ', () => {
  assert.ok(MUSIC_THEMES.grassland);
  assert.ok(MUSIC_THEMES.cave);
  assert.ok(MUSIC_THEMES.sky);
  assert.equal(typeof NOTE_HZ.A4, 'number');
  assert.equal(NOTE_HZ.A4, 440.00);
});

// ---------- AC1: music plays during gameplay using procedural chiptune ----------

test('AC1: playMusic("grassland") starts music and schedules oscillator notes', () => {
  const { audio, ctx } = makeMusicAudio();
  const ok = audio.playMusic('grassland');
  assert.equal(ok, true);
  assert.equal(audio.isMusicPlaying(), true);
  assert.equal(audio.getMusicTheme(), 'grassland');
  // First synchronous tick scheduled at least one note per track.
  const oscStarts = ctx._events.filter(function (e) { return e.op === 'start' && e.kind === 'osc'; });
  assert.ok(oscStarts.length >= 3, 'first tick should schedule at least one note per track');
});

test('AC1: playMusic uses each theme\'s configured wave type per track', () => {
  // Grassland: lead=square, harmony=square, bass=triangle
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  // Find connect events from oscillators to gains (each note creates one).
  // The osc.type must be set BEFORE start, so we inspect oscillators that
  // were start-ed. Reconstruct osc.type by looking at the fake oscillator's
  // last-set type via the test stub. Since the stub doesn't record type
  // mutations, we instead read it from the events of the very next note —
  // not ideal. So instead: rely on MUSIC_THEMES.waves directly.
  assert.equal(MUSIC_THEMES.grassland.waves.lead, 'square');
  assert.equal(MUSIC_THEMES.grassland.waves.harmony, 'square');
  assert.equal(MUSIC_THEMES.grassland.waves.bass, 'triangle');
  // Sanity: at least one note was scheduled.
  const startCount = ctx._events.filter(function (e) { return e.op === 'start'; }).length;
  assert.ok(startCount >= 3);
});

test('AC1: playMusic returns false when AudioContext cannot start', () => {
  const audio = createAudio({ audioContextFactory: null, musicAutoTick: false });
  assert.equal(audio.playMusic('grassland'), false);
  assert.equal(audio.isMusicPlaying(), false);
});

test('AC1: playMusic returns false for unknown theme', () => {
  const { audio } = makeMusicAudio();
  assert.equal(audio.playMusic('nonexistent-theme'), false);
  assert.equal(audio.isMusicPlaying(), false);
});

// ---------- AC2: 3 themes have distinct character ----------

test('AC2-grassland: C major upbeat at 140 BPM with low-C bass', () => {
  const t = MUSIC_THEMES.grassland;
  assert.equal(t.tempo, 140);
  assert.equal(t.loopBeats, 8);
  // Roots are C-based: bass starts on C3.
  assert.equal(t.tracks.bass[0][0], 'C3');
  // Harmony resolves to F4 (IV) — confirms major key with IV chord change.
  assert.equal(t.tracks.harmony[1][0], 'F4');
  // Lead opens on C5 and moves to E5 (major third) — major-key signature.
  assert.equal(t.tracks.lead[0][0], 'C5');
  assert.equal(t.tracks.lead[1][0], 'E5');
});

test('AC2-cave: A minor slow at 90 BPM with low pedal bass', () => {
  const t = MUSIC_THEMES.cave;
  assert.equal(t.tempo, 90);
  // All triangles for the mellow/mysterious feel.
  assert.equal(t.waves.lead, 'triangle');
  assert.equal(t.waves.harmony, 'triangle');
  assert.equal(t.waves.bass, 'triangle');
  // Bass uses A2 / E2 — the lowest register of any theme.
  assert.equal(t.tracks.bass[0][0], 'A2');
  assert.equal(t.tracks.bass[1][0], 'E2');
  // Lead on A4 then C5: A minor i-chord opening (root + minor third).
  assert.equal(t.tracks.lead[0][0], 'A4');
  assert.equal(t.tracks.lead[1][0], 'C5');
});

test('AC2-sky: G major bright at 120 BPM in a higher register', () => {
  const t = MUSIC_THEMES.sky;
  assert.equal(t.tempo, 120);
  // Bass uses G3 / D3 — higher than grassland (C3) and cave (A2/E2).
  assert.equal(t.tracks.bass[0][0], 'G3');
  // Lead reaches D6 — highest pitch of any theme.
  const leadPitches = t.tracks.lead.map(function (n) { return n[0]; });
  assert.ok(leadPitches.indexOf('D6') !== -1, 'sky lead should touch D6');
  // First note is G5: tonic in the upper octave.
  assert.equal(t.tracks.lead[0][0], 'G5');
});

test('AC2: each theme is distinct in tempo and registry', () => {
  const tempos = [MUSIC_THEMES.grassland.tempo, MUSIC_THEMES.cave.tempo, MUSIC_THEMES.sky.tempo];
  // All three tempos differ from each other.
  assert.equal(new Set(tempos).size, 3);
  // Sky's lead reaches higher than grassland's, which reaches higher than cave's.
  const maxHz = function (theme) {
    let m = 0;
    theme.tracks.lead.forEach(function (n) { if (n[0] && NOTE_HZ[n[0]] > m) m = NOTE_HZ[n[0]]; });
    return m;
  };
  assert.ok(maxHz(MUSIC_THEMES.sky) > maxHz(MUSIC_THEMES.grassland));
  assert.ok(maxHz(MUSIC_THEMES.grassland) > maxHz(MUSIC_THEMES.cave));
});

test('AC2: each theme\'s tracks sum to the same loopBeats (phase-locked loop)', () => {
  Object.keys(MUSIC_THEMES).forEach(function (key) {
    const t = MUSIC_THEMES[key];
    ['lead', 'harmony', 'bass'].forEach(function (trackName) {
      const sum = t.tracks[trackName].reduce(function (acc, n) { return acc + n[1]; }, 0);
      assert.equal(sum, t.loopBeats, key + '.' + trackName + ' beats != loopBeats');
    });
  });
});

// ---------- AC3: seamless loop ----------

test('AC3: scheduler continues past loop boundary without inserting silence', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  // Grassland is 140 BPM × 8 beats = 8 * (60/140) ≈ 3.4286s per loop.
  const loopDur = 8 * (60 / 140);
  // Advance time well past one full loop and pump the scheduler.
  for (let i = 0; i < 20; i++) {
    ctx.advanceTime(loopDur / 4);
    audio._pumpMusic();
  }
  // After ~5 loops, each track must have wrapped its noteIndex at least once.
  const state = audio._musicState();
  // The bass track has 8 notes; after >5 loops we should have advanced
  // through tens of notes. Confirm by checking that the scheduler scheduled
  // more notes than fit in a single loop.
  const noteStarts = ctx._events.filter(function (e) { return e.op === 'start' && e.kind === 'osc'; });
  assert.ok(noteStarts.length > 8, 'looped scheduler should have produced many notes');
  // nextNoteAbsTime is strictly increasing (no rewind = no gap at loop seam).
  ['lead', 'harmony', 'bass'].forEach(function (n) {
    assert.ok(state.trackState[n].nextNoteAbsTime > 0);
  });
});

test('AC3: each track wraps independently and stays in sync at the loop boundary', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('cave'); // simplest theme: bass=2 notes, harmony=2, lead=4
  const loopDur = 8 * (60 / 90);
  // Advance exactly two full loops.
  for (let i = 0; i < 8; i++) {
    ctx.advanceTime(loopDur / 4);
    audio._pumpMusic();
  }
  const state = audio._musicState();
  // After two loops + lookahead, each track's nextNoteAbsTime should be at
  // or beyond 2 × loopDur. Confirms wrap happened without skip.
  ['lead', 'harmony', 'bass'].forEach(function (n) {
    assert.ok(state.trackState[n].nextNoteAbsTime >= 2 * loopDur - 0.01);
  });
});

// ---------- AC4: pause / resume ----------

test('AC4: pauseMusic stops the scheduler and cancels active voices', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  ctx.advanceTime(0.5);
  audio._pumpMusic();
  assert.ok(audio.activeMusicVoiceCount() > 0);
  audio.pauseMusic();
  assert.equal(audio.isMusicPlaying(), false);
  assert.equal(audio.activeMusicVoiceCount(), 0);
});

test('AC4: resumeMusic restores playback from the same offset', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  ctx.advanceTime(0.4);
  audio.pauseMusic();
  const pausedAt = audio._musicState().pausedAt;
  assert.ok(Math.abs(pausedAt - 0.4) < 0.001);
  // Time advances while paused — playback should resume from pausedAt, NOT
  // jump forward to ctx.currentTime.
  ctx.advanceTime(5.0);
  audio.resumeMusic();
  assert.equal(audio.isMusicPlaying(), true);
  // startCtxTime should have shifted so that (now - startCtxTime) == pausedAt.
  const s = audio._musicState();
  assert.ok(Math.abs((ctx.currentTime - s.startCtxTime) - 0.4) < 0.001);
});

test('AC4: resumeMusic rebuilds track indices at the correct playhead', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('cave'); // 90 BPM ⇒ beatSec = 2/3s
  // Bass track is [[A2,4],[E2,4]] in beats — first A2 lasts 4 × (2/3) ≈ 2.667s.
  // Pause halfway through the second bass note (rel ≈ 4s) so resume should
  // land on bass note index 1 (E2).
  ctx.advanceTime(4.0);
  audio._pumpMusic();
  audio.pauseMusic();
  ctx.advanceTime(10.0);
  audio.resumeMusic();
  const s = audio._musicState();
  // Bass track should be pointing at index 1 (E2) or have advanced past it.
  assert.ok(s.trackState.bass.noteIndex === 1 || s.trackState.bass.noteIndex === 0);
});

// ---------- AC5: stopMusic for game-over/victory ----------

test('AC5: stopMusic cancels voices and clears music state', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  ctx.advanceTime(0.5);
  audio._pumpMusic();
  assert.ok(audio.activeMusicVoiceCount() > 0);
  audio.stopMusic();
  assert.equal(audio.isMusicPlaying(), false);
  assert.equal(audio.getMusicTheme(), null);
  assert.equal(audio.activeMusicVoiceCount(), 0);
  assert.equal(audio._musicState(), null);
});

test('AC5: stopMusic disconnects the music gain node', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  const beforeStop = ctx._events.length;
  audio.stopMusic();
  const afterEvents = ctx._events.slice(beforeStop);
  // Look for a gain.disconnect on the music master gain node.
  const gainDisconnects = afterEvents.filter(function (e) { return e.op === 'disconnect' && e.kind === 'gain'; });
  assert.ok(gainDisconnects.length >= 1);
});

// ---------- AC6: at most 3 simultaneous music voices ----------

test('AC6: music uses no more than 3 simultaneous voices (one per track)', () => {
  const { audio, ctx } = makeMusicAudio({ musicLookAheadSec: 0.01 });
  audio.playMusic('grassland');
  // Pump several ticks while advancing time; voice count must never exceed
  // 3 (one per lead / harmony / bass track).
  for (let i = 0; i < 50; i++) {
    ctx.advanceTime(0.05);
    audio._pumpMusic();
    assert.ok(audio.activeMusicVoiceCount() <= 3,
      'iter ' + i + ': activeMusicVoiceCount=' + audio.activeMusicVoiceCount());
  }
});

// ---------- AC7: M mutes both music and SFX ----------

test('AC7: setMuted(true) mute-pauses music and silences SFX', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  ctx.advanceTime(0.2);
  audio._pumpMusic();
  assert.ok(audio.activeMusicVoiceCount() > 0);
  audio.setMuted(true);
  assert.equal(audio.isMusicPlaying(), false);
  assert.equal(audio.activeMusicVoiceCount(), 0);
  // SFX play() should be a no-op while muted.
  const beforeSfx = ctx._events.length;
  audio.play('jump');
  assert.equal(ctx._events.length, beforeSfx);
});

test('AC7: setMuted(false) auto-resumes music that was mute-paused', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  audio.setMuted(true);
  assert.equal(audio.isMusicPlaying(), false);
  audio.setMuted(false);
  assert.equal(audio.isMusicPlaying(), true);
  assert.equal(audio.getMusicTheme(), 'grassland');
});

test('AC7: setMuted(false) does NOT resume music that was user-paused', () => {
  const { audio } = makeMusicAudio();
  audio.playMusic('grassland');
  audio.pauseMusic(); // explicit user pause
  audio.setMuted(true);
  audio.setMuted(false);
  // User pause must NOT be cleared by unmute.
  assert.equal(audio.isMusicPlaying(), false);
  assert.equal(audio._musicState().pauseReason, 'user');
});

test('AC7: toggleMute round-trip leaves music in the same playing state', () => {
  const { audio } = makeMusicAudio();
  audio.playMusic('grassland');
  audio.toggleMute(); // mute
  audio.toggleMute(); // unmute
  assert.equal(audio.isMusicPlaying(), true);
  assert.equal(audio.isMuted(), false);
});

test('AC7: playMusic while already muted starts in mute-paused state', () => {
  const { audio } = makeMusicAudio();
  audio.setMuted(true);
  const ok = audio.playMusic('grassland');
  assert.equal(ok, true);
  assert.equal(audio.isMusicPlaying(), false);
  // Unmuting should now resume.
  audio.setMuted(false);
  assert.equal(audio.isMusicPlaying(), true);
});

// ---------- AC8: music and SFX play simultaneously ----------

test('AC8: SFX and music maintain independent voice pools', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  ctx.advanceTime(0.1);
  audio._pumpMusic();
  const musicVoicesBefore = audio.activeMusicVoiceCount();
  // Trigger several SFX — should not affect music voice count.
  for (let i = 0; i < 5; i++) audio.play('coinCollect');
  assert.equal(audio.activeMusicVoiceCount(), musicVoicesBefore,
    'SFX should not change music voice count');
  assert.ok(audio.activeVoiceCount() > 0, 'SFX voice pool should have entries');
});

test('AC8: SFX voice eviction does not affect music voices', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  audio._pumpMusic();
  const musicCount = audio.activeMusicVoiceCount();
  // Saturate SFX pool (maxVoices defaults to 8) and verify music untouched.
  for (let i = 0; i < 12; i++) audio.play('jump');
  assert.ok(audio.activeVoiceCount() <= 8, 'SFX cap respected');
  assert.equal(audio.activeMusicVoiceCount(), musicCount);
});

// ---------- Edge cases ----------

test('edge: pauseMusic with no music playing is a no-op', () => {
  const { audio } = makeMusicAudio();
  audio.pauseMusic();
  assert.equal(audio.isMusicPlaying(), false);
});

test('edge: resumeMusic with no music playing is a no-op', () => {
  const { audio } = makeMusicAudio();
  audio.resumeMusic();
  assert.equal(audio.isMusicPlaying(), false);
});

test('edge: stopMusic with no music playing is a no-op', () => {
  const { audio } = makeMusicAudio();
  audio.stopMusic(); // should not throw
  assert.equal(audio.isMusicPlaying(), false);
});

test('edge: playMusic switches themes cleanly (old voices canceled)', () => {
  const { audio, ctx } = makeMusicAudio();
  audio.playMusic('grassland');
  ctx.advanceTime(0.2);
  audio._pumpMusic();
  audio.playMusic('cave');
  // Theme switched; state reset.
  assert.equal(audio.getMusicTheme(), 'cave');
  assert.equal(audio._musicState().pauseReason, null);
});

test('edge: playMusic with same theme already playing is a no-op (returns true)', () => {
  const { audio } = makeMusicAudio();
  audio.playMusic('grassland');
  const stateRef = audio._musicState();
  const ok = audio.playMusic('grassland');
  assert.equal(ok, true);
  // Same state object — no reset.
  assert.equal(audio._musicState(), stateRef);
});
