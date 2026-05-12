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
    // Music (WO-021): up to 3 simultaneous music voices per the architecture
    // Audio component's polyphony cap. The sequencer is a look-ahead scheduler
    // that walks each of the 3 tracks (lead / harmony / bass) independently.
    maxMusicVoices: 3,
    musicMasterGain: 0.2,
    musicLookAheadSec: 0.25,
    musicTickMs: 50,
    // When false (tests), the scheduler runs one synchronous tick on
    // playMusic / resumeMusic but does NOT self-restart via setTimeout.
    // Tests then drive subsequent ticks via the _pumpMusic test hook.
    musicAutoTick: true,
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

  // ---------------------------------------------------------------------------
  // MUSIC (WO-021) — procedural chiptune sequencer, 3-voice polyphony.
  // ---------------------------------------------------------------------------

  // Minimal pitch table covering only the notes used by the three themes
  // below. Frequencies are equal-temperament tuned to A4 = 440 Hz.
  const NOTE_HZ = Object.freeze({
    E2: 82.41,  A2: 110.00,
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
    C6: 1046.50, D6: 1174.66,
  });

  // Theme format: each track is an array of [pitchName | null, durationBeats].
  // The three tracks (lead / harmony / bass) all sum to the same loopBeats so
  // they stay phase-locked at the loop point — that is what makes the loop
  // seamless without an audible click.
  //
  //   grassland — C major, 140 BPM, bouncy & upbeat
  //   cave      — A minor,  90 BPM, sparse & mysterious
  //   sky       — G major, 120 BPM, bright in a higher register
  const MUSIC_THEMES = Object.freeze({
    grassland: {
      tempo: 140,
      loopBeats: 8,
      waves: { lead: 'square', harmony: 'square', bass: 'triangle' },
      gains: { lead: 0.5,      harmony: 0.25,    bass: 0.4 },
      tracks: {
        lead:    [['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['F5', 1], ['D5', 1], ['E5', 2]],
        harmony: [['C4', 4], ['F4', 4]],
        bass:    [['C3', 1], ['C3', 1], ['C3', 1], ['C3', 1], ['F3', 1], ['F3', 1], ['F3', 1], ['F3', 1]],
      },
    },
    cave: {
      tempo: 90,
      loopBeats: 8,
      waves: { lead: 'triangle', harmony: 'triangle', bass: 'triangle' },
      gains: { lead: 0.4,        harmony: 0.3,        bass: 0.35 },
      tracks: {
        lead:    [['A4', 2], ['C5', 2], ['E4', 2], ['A4', 2]],
        harmony: [['A3', 4], ['E3', 4]],
        bass:    [['A2', 4], ['E2', 4]],
      },
    },
    sky: {
      tempo: 120,
      loopBeats: 8,
      waves: { lead: 'square', harmony: 'triangle', bass: 'triangle' },
      gains: { lead: 0.5,      harmony: 0.3,        bass: 0.4 },
      tracks: {
        lead:    [['G5', 1], ['B5', 1], ['D6', 1], ['B5', 1], ['C6', 1], ['A5', 1], ['G5', 2]],
        harmony: [['G4', 1], ['D5', 1], ['G4', 1], ['D5', 1], ['C5', 1], ['G4', 1], ['C5', 1], ['G4', 1]],
        bass:    [['G3', 2], ['D3', 2], ['C3', 2], ['G3', 2]],
      },
    },
  });

  const MUSIC_TRACK_NAMES = Object.freeze(['lead', 'harmony', 'bass']);

  function computeLoopDuration(theme) {
    const beatSec = 60 / theme.tempo;
    let beats = 0;
    for (let i = 0; i < theme.tracks.bass.length; i++) beats += theme.tracks.bass[i][1];
    return beats * beatSec;
  }

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
    // Music state — see playMusic() for shape; null when no music is loaded.
    let musicState = null;

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

    // -------------------------------------------------------------------------
    // Music sequencer (closure-scoped).
    // -------------------------------------------------------------------------

    // Build per-track playhead state at a given relative-time offset into the
    // loop. Used both on playMusic (relTime = 0) and on resume (relTime =
    // pausedAt).
    function initTrackState(theme, startCtxTime, startRelTime) {
      const beatSec = 60 / theme.tempo;
      const loopDur = computeLoopDuration(theme);
      const state = {};
      for (let i = 0; i < MUSIC_TRACK_NAMES.length; i++) {
        const trackName = MUSIC_TRACK_NAMES[i];
        const track = theme.tracks[trackName];
        const completedLoops = Math.floor(startRelTime / loopDur);
        const loopPos = startRelTime - completedLoops * loopDur;
        let acc = 0;
        let idx = 0;
        for (let j = 0; j < track.length; j++) {
          const dur = track[j][1] * beatSec;
          if (loopPos < acc + dur) { idx = j; break; }
          acc += dur;
        }
        state[trackName] = {
          noteIndex: idx,
          nextNoteAbsTime: startCtxTime + completedLoops * loopDur + acc,
        };
      }
      return state;
    }

    function scheduleMusicNote(trackName, pitch, noteDurSec, startAbsTime) {
      const hz = NOTE_HZ[pitch];
      if (!hz) return;
      // Evict any prior voice for this track that ends at-or-before the new
      // note's start. Keeps polyphony at most 1 voice per track (3 total) —
      // reapMusicVoices alone runs only once per tick and may miss voices
      // that end inside the lookahead window.
      const av = musicState.activeVoices;
      for (let i = av.length - 1; i >= 0; i--) {
        const v = av[i];
        if (v.track === trackName && v.endsAt <= startAbsTime + 0.001) {
          try { v.osc.disconnect(); } catch (e) {}
          try { v.gain.disconnect(); } catch (e) {}
          av.splice(i, 1);
        }
      }
      const wave = musicState.theme.waves[trackName];
      const gainAmt = musicState.theme.gains[trackName];
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(hz, startAbsTime);
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(musicState.musicGainNode);
      // Short attack + release inside the note duration keeps loops free of
      // clicks at note boundaries.
      const attack = 0.01;
      const release = 0.03;
      const end = startAbsTime + noteDurSec;
      const sustainEnd = Math.max(startAbsTime + attack, end - release);
      g.gain.setValueAtTime(0, startAbsTime);
      g.gain.linearRampToValueAtTime(gainAmt, startAbsTime + attack);
      g.gain.setValueAtTime(gainAmt, sustainEnd);
      g.gain.linearRampToValueAtTime(0, end);
      osc.start(startAbsTime);
      osc.stop(end);
      musicState.activeVoices.push({ osc: osc, gain: g, endsAt: end, track: trackName });
    }

    function reapMusicVoices(now) {
      if (!musicState) return;
      const live = [];
      for (let i = 0; i < musicState.activeVoices.length; i++) {
        const v = musicState.activeVoices[i];
        if (v.endsAt <= now + 0.001) {
          try { v.osc.disconnect(); } catch (e) {}
          try { v.gain.disconnect(); } catch (e) {}
        } else {
          live.push(v);
        }
      }
      musicState.activeVoices = live;
    }

    function cancelMusicVoices() {
      if (!musicState) return;
      for (let i = 0; i < musicState.activeVoices.length; i++) {
        const v = musicState.activeVoices[i];
        try { v.osc.stop(); } catch (e) {}
        try { v.osc.disconnect(); } catch (e) {}
        try { v.gain.disconnect(); } catch (e) {}
      }
      musicState.activeVoices = [];
    }

    function runMusicTick() {
      if (!musicState || !ctx || muted || musicState.pauseReason !== null) return;
      const now = ctx.currentTime;
      const lookAheadEnd = now + cfg.musicLookAheadSec;
      const beatSec = 60 / musicState.theme.tempo;
      reapMusicVoices(now);
      for (let i = 0; i < MUSIC_TRACK_NAMES.length; i++) {
        const trackName = MUSIC_TRACK_NAMES[i];
        const track = musicState.theme.tracks[trackName];
        const ts = musicState.trackState[trackName];
        while (ts.nextNoteAbsTime <= lookAheadEnd) {
          const note = track[ts.noteIndex];
          const noteDurSec = note[1] * beatSec;
          if (note[0] !== null) {
            scheduleMusicNote(trackName, note[0], noteDurSec, ts.nextNoteAbsTime);
          }
          ts.nextNoteAbsTime += noteDurSec;
          ts.noteIndex = (ts.noteIndex + 1) % track.length;
        }
      }
    }

    function stopMusicScheduler() {
      if (musicState && musicState.schedulerHandle !== null) {
        try { (root.clearTimeout || clearTimeout)(musicState.schedulerHandle); } catch (e) {}
        musicState.schedulerHandle = null;
      }
    }

    function startMusicScheduler() {
      if (!musicState) return;
      // Always run one tick synchronously so the first notes are scheduled
      // before the first setTimeout fires.
      runMusicTick();
      if (!cfg.musicAutoTick) return;
      function loop() {
        runMusicTick();
        if (musicState && musicState.pauseReason === null && !muted) {
          musicState.schedulerHandle = (root.setTimeout || setTimeout)(loop, cfg.musicTickMs);
        } else if (musicState) {
          musicState.schedulerHandle = null;
        }
      }
      if (musicState.pauseReason === null && !muted) {
        musicState.schedulerHandle = (root.setTimeout || setTimeout)(loop, cfg.musicTickMs);
      }
    }

    function pauseMusicInternal(reason) {
      if (!musicState || musicState.pauseReason !== null) return;
      stopMusicScheduler();
      cancelMusicVoices();
      musicState.pausedAt = ctx.currentTime - musicState.startCtxTime;
      musicState.pauseReason = reason;
    }

    function resumeMusicInternal() {
      if (!musicState || musicState.pauseReason === null) return;
      const pausedAt = musicState.pausedAt;
      musicState.startCtxTime = ctx.currentTime - pausedAt;
      musicState.pausedAt = null;
      musicState.pauseReason = null;
      musicState.trackState = initTrackState(musicState.theme, musicState.startCtxTime, pausedAt);
      startMusicScheduler();
    }

    function playMusic(themeName) {
      if (!ensureStarted()) return false;
      const theme = MUSIC_THEMES[themeName];
      if (!theme) return false;
      if (musicState && musicState.themeName === themeName && musicState.pauseReason === null) {
        return true;
      }
      stopMusic();
      const musicGain = ctx.createGain();
      musicGain.gain.value = cfg.musicMasterGain;
      musicGain.connect(masterGainNode);
      const now = ctx.currentTime;
      musicState = {
        themeName: themeName,
        theme: theme,
        loopDurationSec: computeLoopDuration(theme),
        startCtxTime: now,
        pauseReason: null,
        pausedAt: null,
        trackState: initTrackState(theme, now, 0),
        musicGainNode: musicGain,
        activeVoices: [],
        schedulerHandle: null,
      };
      startMusicScheduler();
      // If we're muted, immediately mute-pause so that on unmute we resume.
      if (muted) pauseMusicInternal('mute');
      return true;
    }

    function pauseMusic() { pauseMusicInternal('user'); }
    function resumeMusic() {
      if (musicState && musicState.pauseReason === 'user') resumeMusicInternal();
    }

    function stopMusic() {
      if (!musicState) return;
      stopMusicScheduler();
      cancelMusicVoices();
      try { musicState.musicGainNode.disconnect(); } catch (e) {}
      musicState = null;
    }

    function isMusicPlaying() {
      return !!(musicState && musicState.pauseReason === null);
    }
    function getMusicTheme() { return musicState ? musicState.themeName : null; }
    function activeMusicVoiceCount() {
      return musicState ? musicState.activeVoices.length : 0;
    }

    function setMuted(b) {
      const nb = !!b;
      if (nb === muted) return;
      muted = nb;
      if (muted) {
        stop();
        if (musicState && musicState.pauseReason === null) pauseMusicInternal('mute');
      } else {
        if (musicState && musicState.pauseReason === 'mute') resumeMusicInternal();
      }
    }
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
      // Music API (WO-021).
      playMusic: playMusic,
      stopMusic: stopMusic,
      pauseMusic: pauseMusic,
      resumeMusic: resumeMusic,
      isMusicPlaying: isMusicPlaying,
      getMusicTheme: getMusicTheme,
      activeMusicVoiceCount: activeMusicVoiceCount,
      // Test hooks.
      _voices: voices,
      _ctx: function () { return ctx; },
      _pumpMusic: runMusicTick,
      _musicState: function () { return musicState; },
      constants: Object.freeze(Object.assign({}, cfg, { audioContextFactory: undefined })),
      PRESETS: PRESETS,
      MUSIC_THEMES: MUSIC_THEMES,
      NOTE_HZ: NOTE_HZ,
    };
  }

  const api = {
    createAudio: createAudio,
    PRESETS: PRESETS,
    DEFAULTS: DEFAULTS,
    MUSIC_THEMES: MUSIC_THEMES,
    NOTE_HZ: NOTE_HZ,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AudioModule = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
