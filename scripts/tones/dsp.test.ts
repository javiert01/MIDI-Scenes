import { describe, expect, it } from 'vitest';
import {
  bakeCrossfadeLoop,
  biquad,
  capTail,
  cropStart,
  deinterleave,
  drive,
  equalPowerLoopCrossfade,
  fadeIn,
  fadeOut,
  interleave,
  levelMatchDb,
  mergeToStereo,
  rms,
  trimLeadingSilence,
  type DriveSettings,
} from './dsp';

const SR = 1000; // 1 ms = 1 frame, so pre-roll arithmetic is easy to read
const AT_48_DB = 10 ** (-48 / 20);

function silentThen(at: number, length: number, value: number): Float32Array {
  const c = new Float32Array(length);
  c.fill(value, at);
  return c;
}

describe('trimLeadingSilence', () => {
  it('keeps 1 ms before the first sample above −48 dBFS', () => {
    const { channels, start } = trimLeadingSilence([silentThen(10, 20, 0.5)], SR);
    expect(start).toBe(9);
    expect(channels[0].length).toBe(11);
    expect(channels[0][0]).toBe(0);
    expect(channels[0][1]).toBe(0.5);
  });

  it('scales the pre-roll with the sample rate', () => {
    const { start } = trimLeadingSilence([silentThen(1000, 2000, 0.5)], 44100);
    expect(start).toBe(1000 - 44);
  });

  it('ignores samples at or below the threshold, of either sign', () => {
    const c = new Float32Array(20);
    c[3] = AT_48_DB * 0.99;
    c[5] = -AT_48_DB * 0.99;
    c[12] = -0.2;
    expect(trimLeadingSilence([c], SR).start).toBe(11);
  });

  it('starts from the earliest loud sample on any channel, and cuts every channel there', () => {
    const left = silentThen(15, 20, 0.5);
    const right = silentThen(6, 20, 0.5);
    const { channels, start } = trimLeadingSilence([left, right], SR);
    expect(start).toBe(5);
    expect(channels.map((c) => c.length)).toEqual([15, 15]);
  });

  it('never cuts before the first frame', () => {
    expect(trimLeadingSilence([silentThen(0, 5, 0.5)], SR).start).toBe(0);
  });

  it('does not change the level (no normalisation)', () => {
    const { channels } = trimLeadingSilence([silentThen(4, 8, 0.25)], SR);
    expect(Math.max(...channels[0])).toBe(0.25);
  });

  it('rejects a sample that never rises above the threshold', () => {
    expect(() => trimLeadingSilence([new Float32Array(10)], SR)).toThrow(/silent/);
  });
});

describe('cropStart', () => {
  it('drops the first frames of every channel', () => {
    const out = cropStart([Float32Array.of(1, 2, 3), Float32Array.of(4, 5, 6)], 2);
    expect(out.map((c) => [...c])).toEqual([[3], [6]]);
  });
});

describe('linear fades', () => {
  it('fades in from silence to full level over the given frames', () => {
    const [c] = fadeIn([new Float32Array(6).fill(1)], 4);
    expect([...c]).toEqual([0, 0.25, 0.5, 0.75, 1, 1]);
  });

  it('fades out to silence on the last frame', () => {
    const [c] = fadeOut([new Float32Array(6).fill(1)], 4);
    expect([...c]).toEqual([1, 1, 0.75, 0.5, 0.25, 0]);
  });

  it('leaves the input untouched', () => {
    const input = new Float32Array(4).fill(1);
    fadeIn([input], 4);
    fadeOut([input], 4);
    expect([...input]).toEqual([1, 1, 1, 1]);
  });
});

describe('capTail', () => {
  it('cuts the audio to the cap and fades the last frames to silence', () => {
    const [c] = capTail([new Float32Array(10).fill(1)], 6, 4);
    expect([...c]).toEqual([1, 1, 0.75, 0.5, 0.25, 0]);
  });

  it('caps every channel alike', () => {
    const out = capTail([new Float32Array(10).fill(1), new Float32Array(10).fill(-1)], 3, 1);
    expect(out.map((c) => [...c])).toEqual([
      [1, 1, 0],
      [-1, -1, -0],
    ]);
  });

  it('leaves audio already within the cap as it is, with no fade', () => {
    const [c] = capTail([new Float32Array(6).fill(1)], 6, 4);
    expect([...c]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('leaves the input untouched', () => {
    const input = new Float32Array(10).fill(1);
    capTail([input], 6, 4);
    expect([...input]).toEqual(new Array(10).fill(1));
  });
});

describe('equalPowerLoopCrossfade', () => {
  // Frames 0..9 hold 0 and frames 10..29 hold 1, so the audio just before the loop
  // start is silence and the audio just before the loop end is full level.
  const step = () => [silentThen(10, 30, 1)];

  it('makes the last frame before the loop end the frame just before the loop start', () => {
    const x = Float32Array.from({ length: 30 }, (_, i) => i);
    const [c] = equalPowerLoopCrossfade([x], 10, 30, 8);
    expect(c[29]).toBeCloseTo(9);
  });

  it('crossfades with equal-power gains, not linear ones', () => {
    const [c] = equalPowerLoopCrossfade(step(), 10, 30, 8);
    // Halfway through, the outgoing full-level tail is at cos(π/4) ≈ 0.707, not 0.5.
    expect(c[22 + 3]).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it('only changes the crossfade frames before the loop end', () => {
    const before = step();
    const [c] = equalPowerLoopCrossfade(before, 10, 30, 8);
    expect([...c.slice(0, 22)]).toEqual([...before[0].slice(0, 22)]);
  });

  it('rejects a crossfade longer than the audio before the loop start', () => {
    expect(() => equalPowerLoopCrossfade(step(), 5, 30, 8)).toThrow();
  });

  it('rejects a crossfade longer than the loop', () => {
    expect(() => equalPowerLoopCrossfade(step(), 10, 15, 8)).toThrow();
  });
});

describe('bakeCrossfadeLoop', () => {
  // 1 frame = 10 ms, so the Strings' seconds read as whole frames.
  const RATE = 100;
  const placement = { crossfadeSeconds: 0.2, endBeforeEndSeconds: 0.06, leadSeconds: 0.05 };
  const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i);

  it('ends the loop the given time before the file ends, and cuts the file there', () => {
    const { channels, loop } = bakeCrossfadeLoop([ramp(100)], RATE, placement);
    expect(loop.end).toBe(94);
    expect(channels[0].length).toBe(94);
  });

  it('starts the loop the lead time plus the crossfade into the file', () => {
    // The crossfade material runs from 0.05 s to 0.25 s, and the loop starts where it ends.
    expect(bakeCrossfadeLoop([ramp(100)], RATE, placement).loop.start).toBe(25);
  });

  it('bakes an equal-power crossfade into the frames before the loop end', () => {
    const { channels } = bakeCrossfadeLoop([ramp(100)], RATE, placement);
    // The last looped frame becomes the frame just before the loop start, so the jump is seamless.
    expect(channels[0][93]).toBeCloseTo(24);
    // Frames before the crossfade are untouched.
    expect([...channels[0].slice(0, 74)]).toEqual([...ramp(74)]);
  });

  it('treats every channel alike', () => {
    const { channels } = bakeCrossfadeLoop([ramp(100), ramp(100)], RATE, placement);
    expect([...channels[1]]).toEqual([...channels[0]]);
  });

  it('rejects audio too short to hold the crossfade, the lead and the loop', () => {
    expect(() => bakeCrossfadeLoop([ramp(40)], RATE, placement)).toThrow(/too short/);
  });
});

describe('mergeToStereo', () => {
  it('makes one stereo file from a left and a right mono file', () => {
    const out = mergeToStereo([Float32Array.of(1, 2, 3)], [Float32Array.of(4, 5, 6)]);
    expect(out.map((c) => [...c])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('pads the shorter side with silence', () => {
    const out = mergeToStereo([Float32Array.of(1, 2)], [Float32Array.of(4, 5, 6, 7)]);
    expect(out.map((c) => [...c])).toEqual([
      [1, 2, 0, 0],
      [4, 5, 6, 7],
    ]);
  });

  it('accepts only mono sides', () => {
    const stereo = [Float32Array.of(1), Float32Array.of(2)];
    expect(() => mergeToStereo(stereo, [Float32Array.of(3)])).toThrow(/mono/);
  });
});

describe('rms and levelMatchDb', () => {
  it('measures RMS across every channel over the opening window only', () => {
    const loudThenSilent = new Float32Array(20).fill(0.5, 0, 10);
    expect(rms([loudThenSilent, loudThenSilent], 10)).toBeCloseTo(0.5);
    expect(rms([loudThenSilent], 20)).toBeCloseTo(Math.sqrt(0.125));
  });

  it('measures what is there when the audio is shorter than the window', () => {
    expect(rms([new Float32Array(4).fill(-0.25)], 100)).toBeCloseTo(0.25);
  });

  it('gives the dB to add to one side so its mean RMS meets the other side', () => {
    const at = (level: number) => [new Float32Array(10).fill(level)];
    // Reference side averages 0.4, the other side averages 0.2: lift it 6 dB.
    const db = levelMatchDb([at(0.3), at(0.5)], [at(0.1), at(0.3)]);
    expect(db).toBeCloseTo(20 * Math.log10(2));
  });

  it('averages the RMS values themselves, not their dB', () => {
    const at = (level: number) => [new Float32Array(10).fill(level)];
    expect(levelMatchDb([at(0.1), at(0.9)], [at(0.5)])).toBeCloseTo(0);
  });
});

describe('biquad', () => {
  const RATE = 48000;
  const sine = (hz: number, seconds = 0.5, amp = 0.1) =>
    Float32Array.from(
      { length: Math.round(seconds * RATE) },
      (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE),
    );
  // Steady-state gain in dB, ignoring the first half where the filter settles.
  const gainDb = (input: Float32Array, output: Float32Array) => {
    const half = Math.floor(input.length / 2);
    return 20 * Math.log10(rms([output.slice(half)], half) / rms([input.slice(half)], half));
  };

  it('lifts a peaking band by its gain at its centre and leaves far bands alone', () => {
    const settings = { type: 'peaking', frequency: 900, Q: 0.8, gain: 4 } as const;
    expect(gainDb(sine(900), biquad([sine(900)], RATE, settings)[0])).toBeCloseTo(4, 1);
    expect(Math.abs(gainDb(sine(20), biquad([sine(20)], RATE, settings)[0]))).toBeLessThan(0.1);
  });

  it('lets a low-pass pass low notes and cut high ones', () => {
    const settings = { type: 'lowpass', frequency: 4600, Q: 0.9 } as const;
    expect(Math.abs(gainDb(sine(200), biquad([sine(200)], RATE, settings)[0]))).toBeLessThan(0.1);
    expect(gainDb(sine(16000), biquad([sine(16000)], RATE, settings)[0])).toBeLessThan(-20);
  });

  it('reads a low-pass Q in dB, as Web Audio does', () => {
    // Q 3 dB peaks the response about 3 dB at the cutoff (a linear Q of 3 would peak ~9.5 dB).
    const settings = { type: 'lowpass', frequency: 1000, Q: 3 } as const;
    expect(gainDb(sine(1000), biquad([sine(1000)], RATE, settings)[0])).toBeCloseTo(3, 0);
  });

  it('lets a high-pass remove DC and pass high notes', () => {
    const settings = { type: 'highpass', frequency: 90, Q: 1 } as const;
    const [dc] = biquad([new Float32Array(RATE).fill(0.5)], RATE, settings);
    expect(Math.abs(dc.at(-1)!)).toBeLessThan(1e-4);
    expect(Math.abs(gainDb(sine(3000), biquad([sine(3000)], RATE, settings)[0]))).toBeLessThan(0.1);
  });

  it('leaves the input untouched', () => {
    const input = sine(440);
    const copy = input.slice();
    biquad([input], RATE, { type: 'highpass', frequency: 90, Q: 1 });
    expect([...input]).toEqual([...copy]);
  });
});

describe('drive', () => {
  const RATE = 44100;
  // The guitar's settings, with the EQ flattened so the shaper is measured alone.
  const flat: DriveSettings = {
    preGain: 4.25,
    curveK: 3.2,
    oversample: 4,
    filters: [],
    postGain: 0.28,
  };
  const sine = (hz: number, amp: number, seconds = 0.5) =>
    Float32Array.from(
      { length: Math.round(seconds * RATE) },
      (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE),
    );
  const peak = (c: Float32Array) => c.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

  it('is linear for quiet input, with gain pre · k / tanh(k) · post', () => {
    const [out] = drive([sine(300, 0.001)], RATE, flat);
    const expected = (4.25 * 3.2 * 0.28) / Math.tanh(3.2);
    expect(peak(out) / 0.001).toBeCloseTo(expected, 1);
  });

  it('saturates loud input on a tanh curve, at about the post gain', () => {
    const [soft] = drive([sine(300, 0.3)], RATE, flat);
    const [loud] = drive([sine(300, 0.9)], RATE, flat);
    // Band-limiting the clipped wave lets it ring a little past the curve's ceiling.
    expect(peak(loud)).toBeLessThanOrEqual(0.28 * 1.15);
    // Three times the input gains far less than three times the output.
    expect(peak(loud) / peak(soft)).toBeLessThan(1.1);
  });

  it('keeps timing: a click comes out on the frame it went in', () => {
    const click = new Float32Array(2000);
    click[1000] = 0.01;
    const [out] = drive([click], RATE, flat);
    const loudest = out.reduce((best, x, i) => (Math.abs(x) > Math.abs(out[best]) ? i : best), 0);
    expect(loudest).toBe(1000);
    expect(out.length).toBe(2000);
  });

  it('keeps distortion products of a high note out of the audio band below it (oversampled)', () => {
    // A hard-driven 9 kHz tone at 44.1 kHz: its 3rd harmonic (27 kHz) would alias to
    // 17.1 kHz without oversampling. With it, the alias stays tiny.
    const [out] = drive([sine(9000, 0.8, 0.2)], RATE, flat);
    const at = (hz: number) => {
      let re = 0;
      let im = 0;
      for (let i = 2000; i < out.length; i++) {
        re += out[i] * Math.cos((2 * Math.PI * hz * i) / RATE);
        im += out[i] * Math.sin((2 * Math.PI * hz * i) / RATE);
      }
      return Math.hypot(re, im);
    };
    expect(20 * Math.log10(at(17100) / at(9000))).toBeLessThan(-40);
  });

  it('runs the filters after the shaper, in order', () => {
    const settings: DriveSettings = {
      ...flat,
      filters: [{ type: 'highpass', frequency: 90, Q: 1 }],
    };
    // A DC offset survives the shaper but not the high-pass after it.
    const [out] = drive([new Float32Array(RATE).fill(0.01)], RATE, settings);
    expect(Math.abs(out[Math.floor(0.9 * RATE)])).toBeLessThan(1e-4);
  });

  it('keeps the channel count and leaves the input untouched', () => {
    const input = [sine(300, 0.5), sine(300, 0.25)];
    const copy = input.map((c) => c.slice());
    const out = drive(input, RATE, flat);
    expect(out).toHaveLength(2);
    expect(input.map((c) => [...c])).toEqual(copy.map((c) => [...c]));
  });
});

describe('interleave / deinterleave', () => {
  it('round-trips stereo frames', () => {
    const channels = [Float32Array.of(1, 3, 5), Float32Array.of(2, 4, 6)];
    const flat = interleave(channels);
    expect([...flat]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(deinterleave(flat, 2).map((c) => [...c])).toEqual([
      [1, 3, 5],
      [2, 4, 6],
    ]);
  });
});
