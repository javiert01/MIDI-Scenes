import { beforeEach, describe, expect, it } from 'vitest';
import {
  MASTER_GAIN,
  PreviewSynth,
  RELEASE_SECONDS,
  midiToFrequency,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
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

class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  state: AudioContextState = 'running';
  destination: AudioNodeLike = { connect() {} };
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
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
  resume(): Promise<void> {
    this.resumeCalls += 1;
    return Promise.resolve();
  }
}

/** The per-voice gain nodes are every gain except the first (the shared master gain). */
function voiceGains(ctx: FakeAudioContext): FakeGain[] {
  return ctx.gains.slice(1);
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

  it('noteOn creates a sounding voice: a started triangle oscillator into the master gain', () => {
    synth.noteOn(60);

    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(osc.started).toBe(true);
    expect(osc.stopped).toBe(false);
    expect(osc.type).toBe('triangle');
    expect(osc.frequency.value).toBeCloseTo(midiToFrequency(60), 2);

    // osc -> voice gain -> master gain -> destination
    const voiceGain = voiceGains(ctx)[0];
    expect(osc.connectedTo).toBe(voiceGain);
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

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.every((o) => o.started && !o.stopped)).toBe(true);
  });

  it('retriggers a held note: the old voice is released and a fresh one started', () => {
    synth.noteOn(60);
    synth.noteOn(60);

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0].stopped).toBe(true); // old voice released
    expect(ctx.oscillators[1].stopped).toBe(false); // new voice sounding
  });

  it('noteOff releases the voice with a short release tail rather than an instant cut', () => {
    synth.noteOn(60);
    ctx.currentTime = 1;
    synth.noteOff(60);

    const osc = ctx.oscillators[0];
    expect(osc.stopped).toBe(true);
    expect(osc.stopTime).toBeCloseTo(1 + RELEASE_SECONDS, 5);
    expect(osc.stopTime!).toBeGreaterThan(ctx.currentTime); // tail, not an instant cut

    const voiceGain = voiceGains(ctx)[0];
    const finalRamp = voiceGain.gain.ramps.at(-1)!;
    expect(finalRamp.value).toBe(0); // ramps down to silence
    expect(finalRamp.time).toBeCloseTo(1 + RELEASE_SECONDS, 5);
  });

  it('noteOff for an unheld note is a no-op', () => {
    expect(() => synth.noteOff(60)).not.toThrow();
    synth.noteOn(60);
    synth.noteOff(64); // never pressed
    expect(ctx.oscillators[0].stopped).toBe(false);
  });

  it('releaseAll releases every held voice', () => {
    synth.noteOn(60);
    synth.noteOn(64);
    synth.noteOn(67);

    synth.releaseAll();

    expect(ctx.oscillators).toHaveLength(3);
    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
  });

  it('after releaseAll, the same note can sound again as a new voice', () => {
    synth.noteOn(60);
    synth.releaseAll();
    synth.noteOn(60);

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[1].stopped).toBe(false);
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
    expect(ctx.oscillators).toHaveLength(1);
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
    expect(ctx.oscillators).toHaveLength(1);
  });

  it('disabling immediately silences held voices', () => {
    synth.noteOn(60);
    synth.noteOn(64);

    synth.setEnabled(false);

    expect(ctx.oscillators.every((o) => o.stopped)).toBe(true);
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
    expect(voiceGains(ctx).every((g) => g.connectedTo === master)).toBe(true);
  });
});
