// PROTOTYPE (#45), throwaway. The hand-rolled Tone Player under audition: one
// envelope gain per voice over whatever the Tone starts inside it, with the
// sustain pedal, ±N semitone pitch bend, a voice cap with the stealing order
// from #46, and retriggering a note the pedal holds. No DOM in here; the page
// calls in, nothing calls out.

export const STEAL_FADE = 0.02; // seconds; also used for a retriggered voice

// A Tone is { id, releaseTime, attack, start(ctx, note, velocity, when, bendCents, out) }.
// start() wires its sound into `out` and returns
// { detunes: AudioParam[], stop(t), onEnded(cb)?, release(t, bus)?, info? }.

export class TonePlayer {
  constructor(ctx, output, { maxVoices = 32, bendRange = 2 } = {}) {
    this.ctx = ctx;
    this.output = output;
    this.maxVoices = maxVoices;
    this.bendRange = bendRange;
    this.tone = null;
    this.voices = []; // { note, state: 'key' | 'pedal' | 'release', started, endsAt, env, sound }
    this.pedalDown = false;
    this.bendCents = 0;
    this.counters = {
      steals: 0,
      stealsByState: { release: 0, pedal: 0, key: 0 },
      retriggers: 0,
      notes: 0,
    };
    this.lastNote = null;
  }

  setTone(tone) {
    this.allOff();
    this.tone = tone;
  }

  noteOn(note, velocity, when = this.ctx.currentTime) {
    if (!this.tone) return;
    this.prune(when);
    this.counters.notes++;

    // Pressing a note the pedal (or a stuck key) is holding: fade the old voice fast.
    for (const v of this.voices) {
      if (v.note === note && v.state !== 'release') {
        this.fadeOut(v, when, STEAL_FADE);
        this.counters.retriggers++;
      }
    }

    while (this.liveCount() >= this.maxVoices) {
      const victim = this.pickVictim();
      if (!victim) break;
      this.counters.steals++;
      this.counters.stealsByState[victim.state]++;
      this.fadeOut(victim, when, STEAL_FADE);
      victim.stolen = true;
    }

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + Math.max(this.tone.attack ?? 0.002, 0.0005));
    env.connect(this.output);
    const sound = this.tone.start(this.ctx, note, velocity, when, this.bendCents, env);
    const voice = { note, velocity, state: 'key', started: when, endsAt: Infinity, env, sound };
    sound.onEnded?.(() => {
      voice.endsAt = Math.min(voice.endsAt, this.ctx.currentTime);
    });
    this.voices.push(voice);
    this.lastNote = { note, velocity, ...(sound.info ?? {}) };
  }

  noteOff(note, when = this.ctx.currentTime) {
    for (const v of this.voices) {
      if (v.note !== note || v.state !== 'key') continue;
      if (this.pedalDown) v.state = 'pedal';
      else this.release(v, when);
    }
  }

  pedal(down, when = this.ctx.currentTime) {
    this.pedalDown = down;
    if (down) return;
    for (const v of this.voices) if (v.state === 'pedal') this.release(v, when);
  }

  /** amount in -1..1 from the wheel; the range is fixed per player (±2 by default). */
  bend(amount, when = this.ctx.currentTime) {
    this.bendCents = amount * this.bendRange * 100;
    for (const v of this.voices) {
      for (const p of v.sound.detunes) p.setTargetAtTime(this.bendCents, when, 0.004);
    }
  }

  allOff() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) this.fadeOut(v, now, STEAL_FADE);
    this.voices = [];
    this.pedalDown = false;
  }

  stats() {
    this.prune(this.ctx.currentTime);
    const by = { key: 0, pedal: 0, release: 0 };
    for (const v of this.voices) by[v.state]++;
    return {
      ...by,
      total: this.voices.length,
      max: this.maxVoices,
      pedalDown: this.pedalDown,
      bendCents: this.bendCents,
      ...this.counters,
    };
  }

  // --- internals ---

  liveCount() {
    return this.voices.length;
  }

  /** Release tails first, then pedal-held, then key-held; oldest first within each. */
  pickVictim() {
    for (const state of ['release', 'pedal', 'key']) {
      const pool = this.voices.filter((v) => v.state === state);
      if (pool.length) return pool.reduce((a, b) => (a.started <= b.started ? a : b));
    }
    return null;
  }

  release(v, when) {
    const r = this.tone.releaseTime;
    v.state = 'release';
    holdAt(v.env.gain, when);
    v.env.gain.setTargetAtTime(0, when, r / 5);
    v.sound.release?.(when, this.output);
    v.sound.stop(when + r * 1.6); // e^-8, about -70 dB, so the stop can't click
    v.endsAt = when + r * 1.6;
  }

  fadeOut(v, when, fade) {
    holdAt(v.env.gain, when);
    v.env.gain.linearRampToValueAtTime(0, when + fade);
    v.sound.stop(when + fade + 0.005);
    v.endsAt = when + fade;
    this.voices = this.voices.filter((x) => x !== v);
  }

  prune(now) {
    this.voices = this.voices.filter((v) => v.endsAt > now);
  }
}

/** Freezes a param at its current value at `when` so a new ramp starts from there. */
function holdAt(param, when) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(when);
  else {
    param.cancelScheduledValues(when);
    param.setValueAtTime(param.value, when);
  }
}

// --- Sampled Tones ---

/**
 * regions: [{ buffer, key, lo, hi, vlo, vhi, tune, gainDb, pan, loop: [startS, endS] | null,
 * release }]. Notes outside every region stretch the nearest keycentre.
 */
export function sampledTone({
  id,
  regions,
  releaseTime = 0.3,
  velTrack = 0.6,
  attack = 0.002,
  gainDb = 0,
}) {
  const playable = regions.filter((r) => !r.release);
  const releases = regions.filter((r) => r.release);

  function pick(pool, note, velocity) {
    let hits = pool.filter(
      (r) => note >= r.lo && note <= r.hi && velocity >= r.vlo && velocity <= r.vhi,
    );
    if (!hits.length) {
      const inVel = pool.filter((r) => velocity >= r.vlo && velocity <= r.vhi);
      const from = inVel.length ? inVel : pool;
      const nearest = from.reduce((a, b) =>
        Math.abs(b.key - note) < Math.abs(a.key - note) ? b : a,
      );
      hits = from.filter((r) => r.key === nearest.key);
    }
    return hits;
  }

  function play(ctx, hits, note, velocity, when, bendCents, out, extraGain = 1) {
    const sources = [];
    const vel = 1 - velTrack + velTrack * (velocity / 127) ** 2;
    for (const r of hits) {
      const src = ctx.createBufferSource();
      src.buffer = r.buffer;
      src.playbackRate.value = 2 ** ((note - r.key) / 12 + r.tune / 1200);
      src.detune.value = bendCents;
      if (r.loop) {
        src.loop = true;
        src.loopStart = r.loop[0];
        src.loopEnd = r.loop[1];
      }
      const g = ctx.createGain();
      g.gain.value = dbToGain(r.gainDb + gainDb) * vel * extraGain;
      let node = src;
      node.connect(g);
      node = g;
      if (r.pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = r.pan;
        node.connect(p);
        node = p;
      }
      node.connect(out);
      src.start(when);
      sources.push(src);
    }
    return sources;
  }

  return {
    id,
    releaseTime,
    attack,
    start(ctx, note, velocity, when, bendCents, out) {
      const hits = pick(playable, note, velocity);
      const sources = play(ctx, hits, note, velocity, when, bendCents, out);
      const r0 = hits[0];
      return {
        detunes: sources.map((s) => s.detune),
        info: { keycentre: r0.key, stretch: note - r0.key, layer: r0.layer ?? null, file: r0.file },
        stop(t) {
          for (const s of sources) s.stop(t);
        },
        onEnded(cb) {
          if (!sources.some((s) => s.loop)) sources[0].onended = cb;
        },
        release(t, bus) {
          if (!releases.length) return;
          // Release samples go straight to the bus: the voice envelope is fading out.
          play(ctx, pick(releases, note, velocity), note, velocity, t, 0, bus);
        },
      };
    },
  };
}

export function dbToGain(db) {
  return 10 ** (db / 20);
}

// --- Synthesised Tones ---

export function midiToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

/** Warm Analog, ported from previewSynth.ts: detuned saw unison + sub sine, low-pass, ADSR. */
export function warmAnalog() {
  return synthTone('warm', 0.2, (ctx, note, velocity, when, bend, out) => {
    const f = midiToFrequency(note);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(0.15, when + 0.01);
    amp.gain.linearRampToValueAtTime(0.105, when + 0.09);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1;
    const c = (x) => Math.min(16000, Math.max(500, x));
    filter.frequency.setValueAtTime(c(f * 6), when);
    filter.frequency.linearRampToValueAtTime(c(f * 14), when + 0.01);
    filter.frequency.linearRampToValueAtTime(c(f * 6), when + 0.09);
    filter.connect(amp);
    amp.connect(out);
    const oscs = [];
    const uni = ctx.createGain();
    uni.gain.value = 0.28;
    uni.connect(filter);
    for (const cents of [-7, 0, 7]) oscs.push(osc(ctx, 'sawtooth', f, cents + bend, uni, when));
    const sub = ctx.createGain();
    sub.gain.value = 0.2;
    sub.connect(filter);
    oscs.push(osc(ctx, 'sine', f / 2, bend, sub, when));
    return oscs;
  });
}

/**
 * Villera Lead candidates: bright, slightly nasal keyboard lead with a delayed
 * vibrato built in. Variants differ in waveform and formant.
 */
export const VILLERA_VARIANTS = {
  A: {
    label: 'A: square + saw, nasal peak 1.4 kHz',
    waves: [
      ['square', 0, 0.5],
      ['sawtooth', 6, 0.35],
    ],
    peak: 1400,
    q: 2.2,
    peakDb: 7,
    lp: 6500,
    vibCents: 18,
    vibRate: 5.6,
    vibDelay: 0.22,
    glide: 0,
  },
  B: {
    label: 'B: narrow pulse, brighter, faster vibrato',
    waves: 'pulse',
    peak: 2000,
    q: 1.6,
    peakDb: 6,
    lp: 9000,
    vibCents: 22,
    vibRate: 6.2,
    vibDelay: 0.15,
    glide: 0,
  },
  C: {
    label: 'C: A with a short glide into each note',
    waves: [
      ['square', 0, 0.5],
      ['sawtooth', 6, 0.35],
    ],
    peak: 1400,
    q: 2.2,
    peakDb: 7,
    lp: 6500,
    vibCents: 18,
    vibRate: 5.6,
    vibDelay: 0.22,
    glide: 0.04,
  },
  D: {
    label: 'D: C, more nasal and brighter (peak 1.7 kHz, +11 dB)',
    waves: [
      ['square', 0, 0.5],
      ['sawtooth', 6, 0.35],
    ],
    hp: 320,
    peak: 1700,
    q: 3.2,
    peakDb: 11,
    lp: 11000,
    vibCents: 18,
    vibRate: 5.6,
    vibDelay: 0.22,
    glide: 0.04,
  },
  E: {
    label: 'E: D with a second, higher formant (2.9 kHz), brightest',
    waves: [
      ['square', 0, 0.45],
      ['sawtooth', 6, 0.4],
    ],
    hp: 320,
    peak: 1700,
    q: 3.2,
    peakDb: 10,
    peak2: 2900,
    peak2Db: 7,
    lp: 12000,
    vibCents: 18,
    vibRate: 5.6,
    vibDelay: 0.22,
    glide: 0.04,
  },
};

export function villeraLead(variant = 'A') {
  const v = VILLERA_VARIANTS[variant];
  return synthTone(`villera-${variant}`, 0.12, (ctx, note, velocity, when, bend, out) => {
    const f = midiToFrequency(note);
    const amp = ctx.createGain();
    const level = 0.11 * (0.55 + 0.45 * (velocity / 127));
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + 0.006);
    amp.gain.linearRampToValueAtTime(level * 0.85, when + 0.12);
    const hp = biquad(ctx, 'highpass', v.hp ?? 220, 0.7);
    const peak = biquad(ctx, 'peaking', v.peak, v.q);
    peak.gain.value = v.peakDb;
    const lp = biquad(ctx, 'lowpass', v.lp, 0.8);
    hp.connect(peak);
    if (v.peak2) {
      const peak2 = biquad(ctx, 'peaking', v.peak2, 2.5);
      peak2.gain.value = v.peak2Db;
      peak.connect(peak2);
      peak2.connect(lp);
    } else peak.connect(lp);
    lp.connect(amp);
    amp.connect(out);

    // Delayed vibrato: an LFO whose depth fades in after vibDelay.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = v.vibRate;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, when);
    depth.gain.setValueAtTime(0, when + v.vibDelay);
    depth.gain.linearRampToValueAtTime(v.vibCents, when + v.vibDelay + 0.35);
    lfo.connect(depth);
    lfo.start(when);

    const oscs = [lfo];
    const add = (type, cents, gain) => {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(hp);
      const o = osc(ctx, type, f, cents + bend, g, when);
      if (v.glide) {
        o.frequency.setValueAtTime(f * 2 ** (-1 / 12), when);
        o.frequency.exponentialRampToValueAtTime(f, when + v.glide);
      }
      depth.connect(o.detune);
      oscs.push(o);
    };
    if (v.waves === 'pulse') {
      // A ~25% pulse: two saws, one inverted and shifted by a quarter period.
      add('sawtooth', 0, 0.4);
      const inv = ctx.createGain();
      inv.gain.value = -0.4;
      inv.connect(hp);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = bend;
      o.connect(inv);
      depth.connect(o.detune);
      o.start(when + 1 / (4 * f));
      oscs.push(o);
      add('square', 5, 0.15);
    } else {
      for (const [type, cents, gain] of v.waves) add(type, cents, gain);
    }
    return oscs;
  });
}

/** A sharp click for the acoustic latency test: a 1 ms full-scale burst. */
export function testClick() {
  return synthTone(
    'click',
    0.01,
    (ctx, note, velocity, when, bend, out) => {
      const o = osc(ctx, 'square', 2000, 0, out, when);
      o.stop(when + 0.002);
      return [o];
    },
    0.0002,
  );
}

function synthTone(id, releaseTime, build, attack = 0.001) {
  return {
    id,
    releaseTime,
    attack,
    start(ctx, note, velocity, when, bend, out) {
      const oscs = build(ctx, note, velocity, when, bend, out);
      const pitched = oscs.filter((o) => o.frequency.value > 20);
      return {
        detunes: pitched.map((o) => o.detune),
        info: { keycentre: null, stretch: 0 },
        stop(t) {
          for (const o of oscs) {
            try {
              o.stop(t);
            } catch {
              /* already stopped */
            }
          }
        },
      };
    },
  };
}

function osc(ctx, type, freq, cents, out, when) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = cents;
  o.connect(out);
  o.start(when);
  return o;
}

function biquad(ctx, type, freq, q) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = freq;
  b.Q.value = q;
  return b;
}
