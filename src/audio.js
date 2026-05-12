/**
 * Audio — procedural sound effects via Web Audio API (WO-018, REQ-009/018).
 *
 * Lazy init: AudioContext is created on the first call to ensureStarted(),
 * which the integration layer wires to the first user keydown so browsers
 * don't reject the context for autoplay-policy violations.
 *
 * Voice pool: a fixed-size ring of active SFX voices (default 8). When the
 * pool is full and a new sound plays, the oldest active voice is stopped
 * and recycled — keeps the polyphony budget bounded.
 *
 * Mute: setMuted(true) makes play() a no-op without disposing the
 * AudioContext (so unmuting resumes instantly).
 *
 * All sounds are synthesized purely from oscillators + gain envelopes —
 * no decodeAudioData or audio file resources.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    maxVoices: 8,
    masterGain: 0.25,
  });

  // Preset spec format:
  //   {
  //     wave: 'square' | 'sine' | 'triangle' | 'sawtooth',
  //     duration: seconds,
  //     // freq: either a number or [start, end] for a linear sweep, or
  //     // an array of {t, f} notes for an arpeggio.
  //     freq: number | [number, number] | Array<{t, f}>,
  //     // gain envelope: optional. Defaults to {attack: 0.005, release: 0.05}.
  //     envelope: { attack, release },
  //   }

  const PRESETS = Object.freeze({
    jump: {
      wave: 'square',
      duration: 0.2,
      freq: [200, 800],
      envelope: { attack: 0.01, release: 0.05 },
    },
    coinCollect: {
      wave: 'square',
      duration: 0.15,
      freq: [{ t: 0, f: 880 }, { t: 0.05, f: 1318 }],
      envelope: { attack: 0.005, release: 0.05 },
    },
    powerUp: {
      wave: 'square',
      duration: 0.5,
      freq: [
        { t: 0,    f: 261.63 },
        { t: 0.1,  f: 329.63 },
        { t: 0.2,  f: 392.00 },
        { t: 0.3,  f: 523.25 },
        { t: 0.4,  f: 659.25 },
      ],
      envelope: { attack: 0.01, release: 0.05 },
    },
    stomp: {
      wave: 'triangle',
      duration: 0.1,
      freq: [100, 50],
      envelope: { attack: 0.005, release: 0.03 },
    },
    damage: {
      wave: 'sawtooth',
      duration: 0.3,
      freq: [400, 100],
      envelope: { attack: 0.005, release: 0.05 },
    },
    mysteryHit: {
      wave: 'square',
      duration: 0.1,
      freq: [600, 1000],
      envelope: { attack: 0.005, release: 0.03 },
    },
    checkpoint: {
      wave: 'square',
      duration: 0.3,
      freq: [{ t: 0, f: 523.25 }, { t: 0.1, f: 784.0 }],
      envelope: { attack: 0.01, release: 0.05 },
    },
    menuSelect: {
      wave: 'square',
      duration: 0.05,
      freq: 880,
      envelope: { attack: 0.002, release: 0.02 },
    },
  });

  function getDefaultContextFactory() {
    if (typeof root.AudioContext === 'function') return function () { return new root.AudioContext(); };
    if (typeof root.webkitAudioContext === 'function') return function () { return new root.webkitAudioContext(); };
    return null;
  }

  function createAudio(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    const factory = cfg.audioContextFactory || getDefaultContextFactory();

    let ctx = null;
    let masterGainNode = null;
    let muted = false;
    // Voice records: { osc, gain, startedAt, name }. Index in array is
    // semantic — when full, oldest gets dropped.
    const voices = [];

    function isStarted() { return ctx !== null; }

    function ensureStarted() {
      if (ctx) return true;
      if (typeof factory !== 'function') return false;
      try {
        ctx = factory();
      } catch (err) {
        ctx = null;
        return false;
      }
      if (!ctx) return false;
      masterGainNode = ctx.createGain();
      masterGainNode.gain.value = cfg.masterGain;
      masterGainNode.connect(ctx.destination);
      if (typeof ctx.resume === 'function') {
        // Resume in case the context started suspended (Safari).
        try { ctx.resume(); } catch (e) {}
      }
      return true;
    }

    function dropOldest() {
      if (!voices.length) return;
      const oldest = voices.shift();
      try { oldest.osc.stop(); } catch (e) {}
      try { oldest.osc.disconnect(); } catch (e) {}
      try { oldest.gain.disconnect(); } catch (e) {}
    }

    function reapEnded(now) {
      // Remove voices whose scheduled end time has passed.
      while (voices.length && voices[0].endsAt <= now + 0.001) {
        const v = voices.shift();
        try { v.osc.disconnect(); } catch (e) {}
        try { v.gain.disconnect(); } catch (e) {}
      }
    }

    function applyFreq(osc, preset, t0) {
      const f = preset.freq;
      if (typeof f === 'number') {
        osc.frequency.setValueAtTime(f, t0);
        return;
      }
      if (Array.isArray(f) && f.length === 2 && typeof f[0] === 'number') {
        // Linear sweep [start, end].
        osc.frequency.setValueAtTime(f[0], t0);
        osc.frequency.linearRampToValueAtTime(f[1], t0 + preset.duration);
        return;
      }
      // Step sequence of {t, f}.
      for (let i = 0; i < f.length; i++) {
        const step = f[i];
        osc.frequency.setValueAtTime(step.f, t0 + step.t);
      }
    }

    function applyEnvelope(gain, preset, t0) {
      const env = Object.assign({ attack: 0.005, release: 0.05 }, preset.envelope || {});
      const end = t0 + preset.duration;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + env.attack);
      gain.gain.setValueAtTime(1, end - env.release);
      gain.gain.linearRampToValueAtTime(0, end);
    }

    function play(name) {
      if (muted) return null;
      if (!ensureStarted()) return null;
      const preset = PRESETS[name];
      if (!preset) return null;
      const now = ctx.currentTime;
      reapEnded(now);
      while (voices.length >= cfg.maxVoices) dropOldest();

      const osc = ctx.createOscillator();
      osc.type = preset.wave;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(masterGainNode);

      applyFreq(osc, preset, now);
      applyEnvelope(gain, preset, now);

      osc.start(now);
      osc.stop(now + preset.duration);

      const voice = { name: name, osc: osc, gain: gain, startedAt: now, endsAt: now + preset.duration };
      voices.push(voice);
      return voice;
    }

    function stop() {
      while (voices.length) dropOldest();
    }

    function setMuted(b) { muted = !!b; if (muted) stop(); }
    function isMuted() { return muted; }
    function toggleMute() { setMuted(!muted); return muted; }
    function activeVoiceCount() { return voices.length; }

    // Wires a one-shot 'keydown' listener to ensure the AudioContext starts
    // on the first user gesture. Returns the listener so callers can pass
    // it to addEventListener('keydown', listener).
    function makeUserGestureHook() {
      let fired = false;
      return function () {
        if (fired) return;
        fired = ensureStarted();
      };
    }

    return {
      ensureStarted: ensureStarted,
      isStarted: isStarted,
      play: play,
      stop: stop,
      setMuted: setMuted,
      isMuted: isMuted,
      toggleMute: toggleMute,
      activeVoiceCount: activeVoiceCount,
      makeUserGestureHook: makeUserGestureHook,
      // Test hooks.
      _voices: voices,
      _ctx: function () { return ctx; },
      constants: Object.freeze(Object.assign({}, cfg, { audioContextFactory: undefined })),
      PRESETS: PRESETS,
    };
  }

  const api = {
    createAudio: createAudio,
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AudioModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
