import { describe, expect, it } from 'vitest';
import {
  cropStart,
  deinterleave,
  equalPowerLoopCrossfade,
  fadeIn,
  fadeOut,
  interleave,
  trimLeadingSilence,
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
