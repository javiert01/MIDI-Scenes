import { beforeEach, describe, expect, it } from 'vitest';
import {
  MASTER_GAIN,
  PreviewSynth,
  RELEASE_SECONDS,
  midiToFrequency,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BiquadFilterNodeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '@/engine/previewSynth';

class FakeAudioParam implements AudioParamLike {
  value: number;
  ramps: Array<{ value: number; time: number }> = [];
  cancelledAt: number[] = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push({ value, time });
  }
  cancelScheduledValues(time: number): void {
    this.cancelledAt.push(time);
  }
}

class FakeOscillator implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam(440);
  connectedTo: AudioNodeLike | null = null;
  started = false;
  stopped = false;
  stopTime: number | undefined;
  connect(destination: AudioNodeLike): void {
    this.connectedTo = destination;
  }
  start(): void {
    this.started = true;
  }
  stop(when?: number): void {
    this.stopped = true;
    this.stopTime = when;
  }
}

class FakeGain implements GainNodeLike {
  gain = new FakeAudioParam(1);
  connectedTo: AudioNodeLike | null = null;
  connect(destination: AudioNodeLike): void {
    this.connectedTo = destination;
  }
}

class FakeBiquadFilter implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeAudioParam(350);
  Q = new FakeAudioParam(1);
  connectedTo: AudioNodeLike | null = null;
  connect(destination: AudioNodeLike): void {
    this.connectedTo = destination;
  }
}

class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination: AudioNodeLike = { connect() {} };
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  filters: FakeBiquadFilter[] = [];
  resumeCalls = 0;
  createOscillator(): OscillatorNodeLike {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBiquadFilter(): BiquadFilterNodeLike {
    const filter = new FakeBiquadFilter();
    this.filters.push(filter);
    return filter;
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    return Promise.resolve();
  }
  closeCalls = 0;
  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

/**
 * The per-voice amplitude-envelope gains: those wired into the shared master gain
 * (`gains[0]`). Excludes the internal unison/sub mix gains, which feed the filter.
 */
function voiceGains(ctx: FakeAudioContext): FakeGain[] {
  return ctx.gains.filter((g) => g.connectedTo === ctx.gains[0]);
}

describe('midiToFrequency', () => {
  it('maps A4 (69) to 440 Hz and middle C (60) to ~261.63 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 2);
  });
});

describe('PreviewSynth', () => {
  let ctx: FakeAudioContext;
  let factoryCalls: number;
  let synth: PreviewSynth;

  beforeEach(() => {
    ctx = new FakeAudioContext();
    factoryCalls = 0;
    synth = new PreviewSynth({
      createAudioContext: () => {
        factoryCalls += 1;
        return ctx;
      },
    });
  });

  it('creates the AudioContext lazily — not before the first note', () => {
    expect(factoryCalls).toBe(0);
    synth.noteOn(60);
    expect(factoryCalls).toBe(1);
    synth.noteOn(64);
    expect(factoryCalls).toBe(1); // reused, not recreated
  });

  it('noteOn creates a warm-analog voice: detuned sawtooth unison + sub sine through a low-pass filter into the master', () => {
    synth.noteOn(60);

    // Three detuned sawtooths (unison) plus one sub-octave sine.
    expect(ctx.oscillators).toHaveLength(4);
    expect(ctx.oscillators.every((o) => o.started && !o.stopped)).toBe(true);

    const saws = ctx.oscillators.filter((o) => o.type === 'sawtooth');
    const subs = ctx.oscillators.filter((o) => o.type === 'sine');
    expect(saws).toHaveLength(3);
    expect(subs).toHaveLength(1);

    // The unison spreads around the played pitch: one dead-on, one flat, one sharp.
    const target = midiToFrequency(60);
    expect(saws.some((o) => Math.abs(o.frequency.value - target) < 0.01)).toBe(true);
    expect(saws.some((o) => o.frequency.value < target - 0.01)).toBe(true);
    expect(saws.some((o) => o.frequency.value > target + 0.01)).toBe(true);

    // The sub sits one octave below the played pitch.
    expect(subs[0].frequency.value).toBeCloseTo(target / 2, 2);

    // Every oscillator routes through the single low-pass filter.
    expect(ctx.filters).toHaveLength(1);
    const filter = ctx.filters[0];
    expect(filter.type).toBe('lowpass');
    const mixGains = ctx.gains.filter((g) => g.connectedTo === filter);
    expect(mixGains.length).toBeGreaterThan(0);
    expect(ctx.oscillators.every((o) => mixGains.includes(o.connectedTo as FakeGain))).toBe(true);

    // filter -> voice (envelope) gain -> master gain -> destination
    const voiceGain = voiceGains(ctx)[0];
    expect(filter.connectedTo).toBe(voiceGain);
    expect(voiceGain.connectedTo).toBe(ctx.gains[0]);
    expect(ctx.gains[0].connectedTo).toBe(ctx.destination);
  });

  it('applies an attack envelope: voice gain ramps up from 0', () => {
    synth.noteOn(60);
    const voiceGain = voiceGains(ctx)[0];
    expect(voiceGain.gain.value).toBe(0); // starts silent
    expect(voiceGain.gain.ramps.length).toBeGreaterThan(0); // ramps up
    expect(voiceGain.gain.ramps[0].value).toBeGreaterThan(0);
  });

  it('a second noteOn for a different note adds a second concurrent voice (polyphonic)', () => {
    synth.noteOn(60);
    synth.noteOn(64);

    // Two independent voices, each its own envelope gain; none released.
    expect(voiceGains(ctx)).toHaveLength(2);
    expect(ctx.oscillators.every((o) => o.started && !o.stopped)).toBe(true);
  });

  it('retriggers a held note: the old voice is released and a fresh one started', () => {
    synth.noteOn(60);
    const firstVoiceOscillators = [...ctx.oscillators];
    synth.noteOn(60);

    // The first voice's oscillators are all stopped; the fresh voice sounds on.
    expect(firstVoiceOscillators.every((o) => o.stopped)).toBe(true);
    const freshOscillators = ctx.oscillators.filter((o) => !firstVoiceOscillators.includes(o));
    expect(freshOscillators.length).toBeGreaterThan(0);
    expect(freshOscillators.every((o) => !o.stopped)).toBe(true);
  });

  it('noteOff releases the voice with a short release tail rather than an instant cut', () => {
    synth.noteOn(60);
    ctx.currentTime = 1;
    synth.noteOff(60);

    // Every oscillator in the voice stops together at the end of the tail.
    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
    expect(ctx.oscillators.every((o) => o.stopTime !== undefined)).toBe(true);
    for (const osc of ctx.oscillators) {
      expect(osc.stopTime).toBeCloseTo(1 + RELEASE_SECONDS, 5);
      expect(osc.stopTime!).toBeGreaterThan(ctx.currentTime); // tail, not an instant cut
    }

    const voiceGain = voiceGains(ctx)[0];
    const finalRamp = voiceGain.gain.ramps.at(-1)!;
    expect(finalRamp.value).toBe(0); // ramps down to silence
    expect(finalRamp.time).toBeCloseTo(1 + RELEASE_SECONDS, 5);
  });

  it('noteOff for an unheld note is a no-op', () => {
    expect(() => synth.noteOff(60)).not.toThrow();
    synth.noteOn(60);
    synth.noteOff(64); // never pressed
    expect(ctx.oscillators.every((o) => !o.stopped)).toBe(true);
  });

  it('releaseAll releases every held voice', () => {
    synth.noteOn(60);
    synth.noteOn(64);
    synth.noteOn(67);

    synth.releaseAll();

    expect(voiceGains(ctx)).toHaveLength(3);
    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
  });

  it('after releaseAll, the same note can sound again as a new voice', () => {
    synth.noteOn(60);
    synth.releaseAll();
    const releasedOscillators = [...ctx.oscillators];
    synth.noteOn(60);

    const freshOscillators = ctx.oscillators.filter((o) => !releasedOscillators.includes(o));
    expect(freshOscillators.length).toBeGreaterThan(0);
    expect(freshOscillators.every((o) => !o.stopped)).toBe(true);
  });

  it('while disabled, noteOn produces no voice (and no context is created)', () => {
    const disabled = new PreviewSynth({
      enabled: false,
      createAudioContext: () => {
        factoryCalls += 1;
        return ctx;
      },
    });

    disabled.noteOn(60);

    expect(factoryCalls).toBe(0);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('defaults to enabled: noteOn sounds without an explicit enable', () => {
    synth.noteOn(60);
    expect(voiceGains(ctx)).toHaveLength(1);
  });

  it('re-enabling after disabled lets subsequent notes sound', () => {
    const s = new PreviewSynth({
      enabled: false,
      createAudioContext: () => ctx,
    });

    s.noteOn(60);
    expect(ctx.oscillators).toHaveLength(0);

    s.setEnabled(true);
    s.noteOn(60);
    expect(voiceGains(ctx)).toHaveLength(1);
  });

  it('disabling immediately silences held voices', () => {
    synth.noteOn(60);
    synth.noteOn(64);

    synth.setEnabled(false);

    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
  });

  it('dispose() releases held voices and closes the AudioContext', () => {
    synth.noteOn(60);
    synth.noteOn(64);

    synth.dispose();

    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
    expect(ctx.closeCalls).toBe(1);
  });

  it('dispose() is a no-op before any note created a context', () => {
    synth.dispose();
    expect(factoryCalls).toBe(0);
    expect(ctx.closeCalls).toBe(0);
  });

  it('uses a single conservative master gain with headroom (< 1) so chords do not clip', () => {
    synth.noteOn(60);
    synth.noteOn(64);
    synth.noteOn(67);

    // Exactly one master gain, created once and shared by every voice.
    const master = ctx.gains[0];
    expect(master.gain.value).toBe(MASTER_GAIN);
    expect(MASTER_GAIN).toBeGreaterThan(0);
    expect(MASTER_GAIN).toBeLessThan(1);

    // Each of the three voices feeds the one shared master gain.
    const envelopes = voiceGains(ctx);
    expect(envelopes).toHaveLength(3);
    expect(envelopes.every((g) => g.connectedTo === master)).toBe(true);
    // The internal unison/sub mix gains route into filters, never straight to master.
    const mixGains = ctx.gains.filter((g) =>
      ctx.filters.includes(g.connectedTo as FakeBiquadFilter),
    );
    expect(mixGains.every((g) => g.connectedTo !== master)).toBe(true);
    expect(mixGains.length).toBeGreaterThan(0);
  });
});
