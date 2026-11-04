import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  WaveShaperNodeLike,
} from '@/engine/audio';
import { TonePlayer } from '@/engine/tonePlayer';
import { WARM_ANALOG, midiToFrequency } from '@/engine/warmAnalog';

class FakeAudioParam implements AudioParamLike {
  value: number;
  ramps: Array<{ value: number; time: number }> = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.ramps.push({ value, time });
  }
  cancelScheduledValues(_time: number): void {}
}

class FakeNode implements AudioNodeLike {
  connectedTo: AudioNodeLike | null = null;
  connect(destination: AudioNodeLike): void {
    this.connectedTo = destination;
  }
}

class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam(440);
  started = false;
  stopTime: number | undefined;
  start(): void {
    this.started = true;
  }
  stop(when?: number): void {
    this.stopTime = when;
  }
  get stopped(): boolean {
    return this.stopTime !== undefined;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeAudioParam(1);
}

class FakeBiquadFilter extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeAudioParam(350);
  Q = new FakeAudioParam(1);
}

class FakeWaveShaper extends FakeNode implements WaveShaperNodeLike {
  curve: Float32Array | null = null;
  oversample: OverSampleType = '4x';
}

class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  state: AudioContextState = 'running';
  outputLatency?: number;
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  filters: FakeBiquadFilter[] = [];
  shapers: FakeWaveShaper[] = [];
  resumeCalls = 0;
  closeCalls = 0;
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
  createWaveShaper(): WaveShaperNodeLike {
    const shaper = new FakeWaveShaper();
    this.shapers.push(shaper);
    return shaper;
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

/** The node chain from `node` to the end of the graph, following each `connect`. */
function chainFrom(node: AudioNodeLike): AudioNodeLike[] {
  const chain: AudioNodeLike[] = [];
  let current: AudioNodeLike | null = node;
  while (current) {
    chain.push(current);
    current = (current as FakeNode).connectedTo ?? null;
  }
  return chain;
}

/** One sounding note: its oscillators share one low-pass filter, the voice's tally. */
interface Voice {
  filter: FakeBiquadFilter;
  oscillators: FakeOscillator[];
}

/** Groups the context's oscillators into voices by the filter they feed. */
function voices(ctx: FakeAudioContext): Voice[] {
  return ctx.filters.map((filter) => ({
    filter,
    oscillators: ctx.oscillators.filter((o) => chainFrom(o).includes(filter)),
  }));
}

const isSounding = (v: Voice) => v.oscillators.every((o) => o.started && !o.stopped);
const sounding = (ctx: FakeAudioContext) => voices(ctx).filter(isSounding);

describe('TonePlayer', () => {
  let ctx: FakeAudioContext;
  let factoryOptions: AudioContextOptions[];
  let player: TonePlayer;

  beforeEach(() => {
    ctx = new FakeAudioContext();
    factoryOptions = [];
    player = new TonePlayer({
      tone: WARM_ANALOG,
      createAudioContext: (options) => {
        factoryOptions.push(options);
        return ctx;
      },
    });
  });

  describe('the AudioContext', () => {
    it('is not created until a note sounds, then once, with latencyHint 0', () => {
      expect(factoryOptions).toHaveLength(0);

      player.noteOn('virtual', 60, 100);
      player.noteOn('virtual', 64, 100);

      expect(factoryOptions).toEqual([{ latencyHint: 0 }]);
    });

    it('is created and resumed by start(), the gesture that turns sound on, ahead of any note', () => {
      ctx.state = 'suspended';

      player.start();
      player.noteOn('virtual', 60, 100);

      expect(factoryOptions).toEqual([{ latencyHint: 0 }]);
      expect(ctx.resumeCalls).toBe(1);
      expect(sounding(ctx)).toHaveLength(1);
    });

    it('resumes a context the browser suspended when the next note sounds', () => {
      player.start();
      ctx.state = 'suspended';

      player.noteOn('virtual', 60, 100);

      expect(ctx.resumeCalls).toBe(1);
    });

    it('prepare() creates the context without resuming it, as at page load before any gesture', () => {
      ctx.state = 'suspended';

      player.prepare();

      expect(factoryOptions).toEqual([{ latencyHint: 0 }]);
      expect(ctx.resumeCalls).toBe(0);
      expect(player.running).toBe(false);
      expect(player.suspended).toBe(true);
    });

    it('resume() resumes a suspended context and reports when it is running', async () => {
      const changes: boolean[] = [];
      const watched = new TonePlayer({
        tone: WARM_ANALOG,
        createAudioContext: () => ctx,
        onResumed: () => changes.push(watched.running),
      });
      ctx.state = 'suspended';
      watched.prepare();

      watched.resume();
      await Promise.resolve();

      expect(ctx.resumeCalls).toBe(1);
      expect(watched.running).toBe(true);
      expect(changes).toEqual([true]);
    });

    it('resume() creates no context of its own', () => {
      player.resume();

      expect(factoryOptions).toHaveLength(0);
      expect(player.running).toBe(false);
      expect(player.suspended).toBe(false);
    });

    it('reports the output latency where the browser reports it, and null where it does not', () => {
      expect(player.outputLatency).toBeNull();

      player.prepare();
      expect(player.outputLatency).toBeNull();

      ctx.outputLatency = 0.085;
      expect(player.outputLatency).toBeCloseTo(0.085, 5);
    });

    it('stays silent, without throwing, where Web Audio is unavailable', () => {
      const silent = new TonePlayer({
        tone: WARM_ANALOG,
        createAudioContext: () => {
          throw new Error('Web Audio API is unavailable');
        },
      });

      expect(() => {
        silent.start();
        silent.noteOn('virtual', 60, 100);
        silent.noteOff('virtual', 60);
        silent.silenceAll();
        silent.dispose();
      }).not.toThrow();
    });

    it('dispose() silences every voice and closes the context', () => {
      player.noteOn('virtual', 60, 100);

      player.dispose();

      expect(sounding(ctx)).toHaveLength(0);
      expect(ctx.closeCalls).toBe(1);
    });

    it('dispose() before any note creates no context', () => {
      player.dispose();

      expect(factoryOptions).toHaveLength(0);
    });
  });

  describe('silenceAll', () => {
    it('fades every voice, held or releasing, out over 20 ms', () => {
      player.noteOn('virtual', 60, 100);
      player.noteOn('device', 64, 100);
      player.noteOff('device', 64); // releasing: its tail would run to 0.2 s

      player.silenceAll();

      for (const osc of ctx.oscillators) expect(osc.stopTime).toBeCloseTo(0.02, 5);
    });

    it('lets a silenced note sound again on its next press', () => {
      player.noteOn('virtual', 60, 100);
      player.silenceAll();

      player.noteOff('virtual', 60); // the held key comes up: nothing left to release
      player.noteOn('virtual', 60, 100);

      expect(sounding(ctx)).toHaveLength(1);
    });
  });

  describe('Warm Analog', () => {
    it('sounds a detuned sawtooth unison plus a sub-octave sine through one low-pass filter', () => {
      player.noteOn('virtual', 60, 100);

      const [voice] = voices(ctx);
      expect(voice.filter.type).toBe('lowpass');
      expect(voice.oscillators).toHaveLength(4);
      expect(isSounding(voice)).toBe(true);

      const saws = voice.oscillators.filter((o) => o.type === 'sawtooth');
      const subs = voice.oscillators.filter((o) => o.type === 'sine');
      expect(saws).toHaveLength(3);
      expect(subs).toHaveLength(1);

      // The unison spreads around the played pitch: one dead-on, one flat, one sharp.
      const c4 = 261.63;
      expect(saws.some((o) => Math.abs(o.frequency.value - c4) < 0.01)).toBe(true);
      expect(saws.some((o) => o.frequency.value < c4 - 0.01)).toBe(true);
      expect(saws.some((o) => o.frequency.value > c4 + 0.01)).toBe(true);
      expect(subs[0].frequency.value).toBeCloseTo(c4 / 2, 1);
    });

    it('ignores velocity: a soft and a loud note sound alike', () => {
      player.noteOn('virtual', 60, 1);
      player.noteOn('virtual', 64, 127);

      const [soft, loud] = voices(ctx);
      const envelopeOf = (v: Voice) => v.filter.connectedTo as FakeGain;
      expect(envelopeOf(soft).gain.ramps.map((r) => r.value)).toEqual(
        envelopeOf(loud).gain.ramps.map((r) => r.value),
      );
    });

    it("sounds at the Preview Synth's level: a 0.15 peak, settling to 0.105", () => {
      player.noteOn('virtual', 60, 100);

      const envelope = voices(ctx)[0].filter.connectedTo as FakeGain;
      expect(envelope.gain.value).toBe(0); // starts silent
      expect(envelope.gain.ramps[0].value).toBeCloseTo(0.15, 5);
      expect(envelope.gain.ramps[1].value).toBeCloseTo(0.105, 5);
    });
  });

  describe('holding and releasing', () => {
    it('sounds a voice per note number, concurrently', () => {
      player.noteOn('virtual', 60, 100);
      player.noteOn('virtual', 64, 100);

      expect(sounding(ctx)).toHaveLength(2);
    });

    it('releases a note with a 200 ms tail rather than an instant cut', () => {
      player.noteOn('virtual', 60, 100);
      ctx.currentTime = 1;

      player.noteOff('virtual', 60);

      const [voice] = voices(ctx);
      for (const osc of voice.oscillators) expect(osc.stopTime).toBeCloseTo(1.2, 5);
      const envelope = voice.filter.connectedTo as FakeGain;
      expect(envelope.gain.ramps.at(-1)).toEqual({ value: 0, time: expect.closeTo(1.2, 5) });
    });

    it('a second source pressing a held note adds a hold, with no new attack', () => {
      player.noteOn('virtual', 60, 100);
      player.noteOn('device', 60, 100);

      expect(voices(ctx)).toHaveLength(1);
      expect(sounding(ctx)).toHaveLength(1);
    });

    it('releases a note only when its last holder lets go', () => {
      player.noteOn('virtual', 60, 100);
      player.noteOn('device', 60, 100);

      player.noteOff('virtual', 60);
      expect(sounding(ctx)).toHaveLength(1);

      player.noteOff('device', 60);
      expect(sounding(ctx)).toHaveLength(0);
    });

    it('a source pressing a note it already holds retriggers it: the old voice releases, a fresh one starts', () => {
      player.noteOn('virtual', 60, 100);
      player.noteOn('virtual', 60, 100);

      const [first, fresh] = voices(ctx);
      expect(first.oscillators.every((o) => o.stopped)).toBe(true);
      expect(isSounding(fresh)).toBe(true);
    });

    it('ignores a release from a source that holds nothing on that note', () => {
      player.noteOn('virtual', 60, 100);

      player.noteOff('device', 60);
      player.noteOff('virtual', 64);

      expect(sounding(ctx)).toHaveLength(1);
    });

    it('releaseSource() lets go of every hold one source has, leaving other sources sounding', () => {
      player.noteOn('device', 60, 100);
      player.noteOn('device', 64, 100);
      player.noteOn('virtual', 64, 100);
      player.noteOn('virtual', 67, 100);

      player.releaseSource('device');

      // 60 releases; 64 keeps sounding on the Virtual Input's hold; 67 is untouched.
      expect(sounding(ctx)).toHaveLength(2);
      player.noteOff('virtual', 64);
      expect(sounding(ctx)).toHaveLength(1);
    });

    it('sounds a released note again as a new voice', () => {
      player.noteOn('virtual', 60, 100);
      player.noteOff('virtual', 60);

      player.noteOn('virtual', 60, 100);

      expect(sounding(ctx)).toHaveLength(1);
    });
  });

  describe('the 32-voice cap', () => {
    /** The voice's own fixed-gain node, which the Tone Player fades when it steals. */
    const fixedGainOf = (v: Voice) => (v.filter.connectedTo as FakeGain).connectedTo as FakeGain;
    const voiceFor = (note: number) =>
      voices(ctx).find((v) =>
        v.oscillators.some((o) => Math.abs(o.frequency.value - midiToFrequency(note)) < 0.01),
      )!;
    const holdNotes = (from: number, count: number) => {
      for (let note = from; note < from + count; note += 1) player.noteOn('virtual', note, 100);
    };

    it('sounds 32 voices without stealing any', () => {
      holdNotes(40, 32);

      expect(sounding(ctx)).toHaveLength(32);
    });

    it('steals the oldest key-held voice for a 33rd, fading it out over 20 ms', () => {
      holdNotes(40, 32);
      ctx.currentTime = 1;

      player.noteOn('virtual', 90, 100);

      const stolen = voiceFor(40);
      for (const osc of stolen.oscillators) expect(osc.stopTime).toBeCloseTo(1.02, 5);
      expect(fixedGainOf(stolen).gain.ramps.at(-1)).toEqual({
        value: 0,
        time: expect.closeTo(1.02, 5),
      });
      expect(sounding(ctx)).toHaveLength(32);
      expect(isSounding(voiceFor(41))).toBe(true);
      expect(isSounding(voiceFor(90))).toBe(true);
    });

    it('steals a release tail before any key-held voice, the oldest tail first', () => {
      holdNotes(40, 32);
      player.noteOff('virtual', 70); // the two newest notes start releasing
      player.noteOff('virtual', 71);
      ctx.currentTime = 0.1; // both tails still sounding

      player.noteOn('virtual', 90, 100);

      expect(fixedGainOf(voiceFor(70)).gain.ramps.at(-1)?.value).toBe(0);
      expect(fixedGainOf(voiceFor(71)).gain.ramps).toHaveLength(0);
      expect(fixedGainOf(voiceFor(40)).gain.ramps).toHaveLength(0);
    });

    it('stops counting a release tail once it has faded', () => {
      holdNotes(40, 32);
      player.noteOff('virtual', 71);
      ctx.currentTime = 1; // the 200 ms tail is long over

      player.noteOn('virtual', 90, 100);

      expect(sounding(ctx)).toHaveLength(32);
      expect(fixedGainOf(voiceFor(40)).gain.ramps).toHaveLength(0);
    });

    it('a stolen note sounds again as a new voice on its next press', () => {
      holdNotes(40, 32);
      player.noteOn('virtual', 90, 100); // steals note 40

      player.noteOn('device', 40, 100);

      expect(sounding(ctx)).toHaveLength(32);
      expect(isSounding(voices(ctx).at(-1)!)).toBe(true);
    });
  });

  describe('the output chain', () => {
    it('runs voice -> fixed gain 1.0 (0 dB) -> master 1.0 -> soft-clip ceiling -> destination', () => {
      player.noteOn('virtual', 60, 100);

      const envelope = voices(ctx)[0].filter.connectedTo as FakeGain;
      const [, fixedGain, master, ...rest] = chainFrom(envelope);
      expect((fixedGain as FakeGain).gain.value).toBe(1);
      expect((master as FakeGain).gain.value).toBe(1);

      const shaper = ctx.shapers[0];
      expect(rest).toContain(shaper);
      expect(shaper.connectedTo).toBe(ctx.destination);
      expect(shaper.oversample).toBe('none');
    });

    describe('the soft-clip ceiling', () => {
      const MINUS_6_DBFS = 0.501;
      const MINUS_0_3_DBFS = 0.9661;

      /**
       * What the destination receives for a signal of amplitude `x` summed into the
       * master: the gains from the master to the shaper, then the shaper's curve,
       * read as Web Audio reads it (linear interpolation, inputs clamped to ±1).
       */
      function ceilingOutput(x: number): number {
        player.noteOn('virtual', 60, 100);
        const envelope = voices(ctx)[0].filter.connectedTo as FakeGain;
        const master = (envelope.connectedTo as FakeGain).connectedTo as FakeGain;
        const shaper = ctx.shapers[0];
        const toShaper = chainFrom(master).slice(0, chainFrom(master).indexOf(shaper));
        const input = toShaper.reduce((signal, node) => signal * (node as FakeGain).gain.value, x);

        const curve = shaper.curve!;
        const position = ((curve.length - 1) / 2) * (Math.min(1, Math.max(-1, input)) + 1);
        const k = Math.min(curve.length - 2, Math.floor(position));
        const f = position - k;
        return (1 - f) * curve[k] + f * curve[k + 1];
      }

      it('passes ordinary playing through unchanged, below about -6 dBFS', () => {
        for (const x of [0, 0.1, 0.25, -0.3, 0.49, -0.49]) {
          expect(ceilingOutput(x)).toBeCloseTo(x, 3);
        }
      });

      it('bends peaks above -6 dBFS down softly, never hard-clipping them', () => {
        const loud = [0.6, 0.8, 1, 1.5, 2, 3];
        const outputs = loud.map(ceilingOutput);

        outputs.forEach((y, i) => {
          expect(y).toBeGreaterThan(MINUS_6_DBFS);
          expect(y).toBeLessThan(loud[i]);
          if (i > 0) expect(y).toBeGreaterThan(outputs[i - 1]); // still rising: no flat clip
        });
      });

      it('approaches about -0.3 dBFS for a large overload, and never passes it', () => {
        expect(ceilingOutput(6)).toBeCloseTo(MINUS_0_3_DBFS, 2);
        expect(ceilingOutput(6)).toBeLessThanOrEqual(MINUS_0_3_DBFS);
        expect(ceilingOutput(-6)).toBeCloseTo(-MINUS_0_3_DBFS, 2);
        expect(ceilingOutput(100)).toBeLessThanOrEqual(MINUS_0_3_DBFS);
      });
    });
  });
});

describe('midiToFrequency', () => {
  it('maps A4 (69) to 440 Hz and middle C (60) to ~261.63 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 2);
  });
});
