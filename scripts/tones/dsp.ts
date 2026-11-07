// Pure sample preparation for the Tone asset pipeline. Audio is one Float32Array per
// channel, all the same length. Every function returns new arrays and never touches
// its input. Nothing here normalises: Tones keep their recorded level.

export type Channels = Float32Array[];

export const TRIM_THRESHOLD_DB = -48;
export const TRIM_PRE_ROLL_SECONDS = 0.001;

/**
 * Cuts the leading silence: everything before the first sample above −48 dBFS on any
 * channel, keeping 1 ms before it. `start` is how many frames were cut, so a recipe
 * can shift loop points to match.
 */
export function trimLeadingSilence(
  channels: Channels,
  sampleRate: number,
): { channels: Channels; start: number } {
  const threshold = 10 ** (TRIM_THRESHOLD_DB / 20);
  let first = Infinity;
  for (const c of channels) {
    const i = c.findIndex((x) => Math.abs(x) > threshold);
    if (i !== -1) first = Math.min(first, i);
  }
  if (first === Infinity)
    throw new Error(`sample is silent: nothing rises above ${TRIM_THRESHOLD_DB} dBFS`);
  const start = Math.max(0, first - Math.round(TRIM_PRE_ROLL_SECONDS * sampleRate));
  return { channels: cropStart(channels, start), start };
}

/** Drops the first `frames` frames of every channel. */
export function cropStart(channels: Channels, frames: number): Channels {
  return channels.map((c) => c.slice(frames));
}

/** A linear fade from silence, reaching full level at frame `frames`. */
export function fadeIn(channels: Channels, frames: number): Channels {
  return channels.map((c) => {
    const out = c.slice();
    for (let i = 0; i < Math.min(frames, out.length); i++) out[i] *= i / frames;
    return out;
  });
}

/** A linear fade to silence, reaching it on the last frame. */
export function fadeOut(channels: Channels, frames: number): Channels {
  return channels.map((c) => {
    const out = c.slice();
    const from = Math.max(0, out.length - frames);
    for (let i = from; i < out.length; i++) out[i] *= 1 - (i - from + 1) / frames;
    return out;
  });
}

/**
 * Caps a long tail: audio longer than `frames` is cut to it, with a linear fade to
 * silence over its last `fadeFrames`. Audio already within the cap is kept whole.
 */
export function capTail(channels: Channels, frames: number, fadeFrames: number): Channels {
  if ((channels[0]?.length ?? 0) <= frames) return channels.map((c) => c.slice());
  return fadeOut(
    channels.map((c) => c.slice(0, frames)),
    fadeFrames,
  );
}

/**
 * Bakes an equal-power crossfade into a loop, so jumping from `loopEnd` (exclusive)
 * back to `loopStart` is seamless. The `frames` before the loop end fade out while the
 * `frames` before the loop start fade in over them, so the last looped frame is the
 * frame just before the loop start.
 */
export function equalPowerLoopCrossfade(
  channels: Channels,
  loopStart: number,
  loopEnd: number,
  frames: number,
): Channels {
  if (loopStart < frames) throw new Error('crossfade is longer than the audio before the loop');
  if (loopEnd - frames < loopStart) throw new Error('crossfade is longer than the loop');
  return channels.map((c) => {
    const out = c.slice();
    for (let i = 0; i < frames; i++) {
      const t = ((i + 1) / frames) * (Math.PI / 2);
      const tail = loopEnd - frames + i;
      out[tail] = c[tail] * Math.cos(t) + c[loopStart - frames + i] * Math.sin(t);
    }
    return out;
  });
}

export interface CrossfadeLoopPlacement {
  /** How long the equal-power crossfade at the seam lasts. */
  crossfadeSeconds: number;
  /** How far before the end of the audio the loop ends. The audio is cut there. */
  endBeforeEndSeconds: number;
  /** How far into the audio the crossfade material starts. The loop starts where it ends. */
  leadSeconds: number;
}

/**
 * Makes a loop for audio that has none (the Strings): it ends a little before the
 * audio does, and starts after a lead plus the crossfade, so the material faded in at
 * the seam is past the attack. The crossfade is baked in, and the audio is cut at the
 * loop end, since nothing after it is ever heard. Loop points are in frames, `end`
 * exclusive.
 */
export function bakeCrossfadeLoop(
  channels: Channels,
  sampleRate: number,
  { crossfadeSeconds, endBeforeEndSeconds, leadSeconds }: CrossfadeLoopPlacement,
): { channels: Channels; loop: { start: number; end: number } } {
  const length = channels[0]?.length ?? 0;
  const frames = Math.round(crossfadeSeconds * sampleRate);
  const end = length - Math.round(endBeforeEndSeconds * sampleRate);
  const start = Math.round(leadSeconds * sampleRate) + frames;
  if (end - frames < start) {
    throw new Error(
      `audio of ${(length / sampleRate).toFixed(2)} s is too short for a ${crossfadeSeconds} s crossfade loop`,
    );
  }
  const faded = equalPowerLoopCrossfade(channels, start, end, frames);
  return { channels: faded.map((c) => c.slice(0, end)), loop: { start, end } };
}

/** One stereo recording from a left and a right mono one, the shorter padded with silence. */
export function mergeToStereo(left: Channels, right: Channels): Channels {
  if (left.length !== 1 || right.length !== 1) throw new Error('both sides must be mono');
  const length = Math.max(left[0].length, right[0].length);
  return [left[0], right[0]].map((c) => {
    const out = new Float32Array(length);
    out.set(c);
    return out;
  });
}

/** RMS across every channel, over the first `frames` frames (or all of them, if fewer). */
export function rms(channels: Channels, frames: number): number {
  let sum = 0;
  let count = 0;
  for (const c of channels) {
    const n = Math.min(frames, c.length);
    for (let i = 0; i < n; i++) sum += c[i] * c[i];
    count += n;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/**
 * The gain in dB that brings `other` to `reference`'s level, matching the mean of each
 * side's RMS values. For a split between two sample sets, pass the opening of the
 * notes nearest the split on each side.
 */
export function levelMatchDb(reference: Channels[], other: Channels[]): number {
  const mean = (side: Channels[]) => side.reduce((s, c) => s + rms(c, Infinity), 0) / side.length;
  return 20 * Math.log10(mean(reference) / mean(other));
}

export type BiquadSettings =
  | {
      type: 'lowpass' | 'highpass';
      frequency: number;
      /** In dB, as Web Audio reads it. */ Q: number;
    }
  | { type: 'peaking'; frequency: number; Q: number; /** dB at the centre. */ gain: number };

/**
 * A second-order filter with Web Audio's `BiquadFilterNode` coefficients (the Audio EQ
 * Cookbook's, with a low- or high-pass Q read in dB), so a chain auditioned in the
 * browser renders the same here.
 */
export function biquad(channels: Channels, sampleRate: number, settings: BiquadSettings): Channels {
  const w0 = (2 * Math.PI * settings.frequency) / sampleRate;
  const cos = Math.cos(w0);
  let b: [number, number, number];
  let a: [number, number, number];
  if (settings.type === 'peaking') {
    const A = 10 ** (settings.gain / 40);
    const alpha = Math.sin(w0) / (2 * settings.Q);
    b = [1 + alpha * A, -2 * cos, 1 - alpha * A];
    a = [1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else {
    const alpha = Math.sin(w0) / (2 * 10 ** (settings.Q / 20));
    const sign = settings.type === 'lowpass' ? 1 : -1;
    const edge = (1 - sign * cos) / 2;
    b = [edge, sign * 2 * edge, edge];
    a = [1 + alpha, -2 * cos, 1 - alpha];
  }
  const [b0, b1, b2] = b.map((x) => x / a[0]);
  const [a1, a2] = [a[1] / a[0], a[2] / a[0]];

  return channels.map((c) => {
    const out = new Float32Array(c.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < c.length; i++) {
      const x = c[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
    }
    return out;
  });
}

export interface DriveSettings {
  /** Gain before the curve. */
  preGain: number;
  /** The curve is tanh(k·x) / tanh(k), with x clamped to ±1, as a Web Audio curve is read. */
  curveK: number;
  /** The curve runs at this multiple of the sample rate, so its harmonics don't alias. */
  oversample: 1 | 2 | 4;
  /** Filters after the curve, in order. */
  filters: readonly BiquadSettings[];
  /** Gain after the filters. */
  postGain: number;
}

/** Taps per output frame of the oversampling filter, each side of its centre. */
const OVERSAMPLE_HALF_TAPS = 16;

/**
 * A low-pass at the original Nyquist, for the oversampled rate: a Blackman-windowed
 * sinc cut off at 0.45 of the original rate. It is short, so its transition band
 * reaches down into the top octave: at 4× and 44.1 kHz one pass is about −0.7 dB at
 * 18 kHz and −7 dB at 20 kHz. Curve harmonics just above the original Nyquist are cut
 * by only about 28 dB before they alias. That is fine for a guitar cab that low-passes
 * at 4.6 kHz afterwards.
 */
function oversampleKernel(factor: number): Float64Array {
  const half = OVERSAMPLE_HALF_TAPS * factor;
  const cutoff = 0.45 / factor; // cycles per oversampled frame
  return Float64Array.from({ length: 2 * half + 1 }, (_, i) => {
    const n = i - half;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const t = i / (2 * half);
    return sinc * (0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t));
  });
}

/**
 * Bakes a guitar-amp drive into audio, as Web Audio's gain → WaveShaper → filters →
 * gain chain renders it: gain, the tanh curve at `oversample`× the rate, the filters,
 * then gain. The oversampling filters' latency is removed, so the output lines up
 * with the input frame for frame and loop points stay put.
 */
export function drive(channels: Channels, sampleRate: number, settings: DriveSettings): Channels {
  const { preGain, curveK, oversample: factor, postGain } = settings;
  const norm = Math.tanh(curveK);
  const curve = (x: number) => Math.tanh(curveK * Math.max(-1, Math.min(1, x))) / norm;

  const shaped = channels.map((c) => {
    if (factor === 1) return c.map((x) => curve(preGain * x));
    const kernel = oversampleKernel(factor);
    const half = (kernel.length - 1) / 2;
    // Zero-stuff, filter (with gain `factor` to keep the level), shape.
    const up = new Float64Array(c.length * factor);
    for (let j = 0; j < up.length; j++) {
      let sum = 0;
      // Only every factor-th tap meets a non-zero (original) frame.
      const first = (((half - j) % factor) + factor) % factor;
      for (let k = first; k < kernel.length; k += factor) {
        const i = (j - half + k) / factor;
        if (i >= 0 && i < c.length) sum += kernel[k] * c[i];
      }
      up[j] = curve(preGain * factor * sum);
    }
    // Filter again and keep every factor-th frame. Centring both kernels on the
    // output frame is what removes their latency.
    const out = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) {
      const centre = i * factor;
      let sum = 0;
      for (let k = 0; k < kernel.length; k++) {
        const j = centre - half + k;
        if (j >= 0 && j < up.length) sum += kernel[k] * up[j];
      }
      out[i] = sum;
    }
    return out;
  });

  const filtered = settings.filters.reduce<Channels>(
    (audio, f) => biquad(audio, sampleRate, f),
    shaped,
  );
  return filtered.map((c) => c.map((x) => x * postGain));
}

/** Interleaves channels into one buffer, as raw PCM is laid out. */
export function interleave(channels: Channels): Float32Array {
  const n = channels.length;
  const out = new Float32Array(n * (channels[0]?.length ?? 0));
  channels.forEach((c, ch) => c.forEach((x, i) => (out[i * n + ch] = x)));
  return out;
}

/** Splits interleaved PCM into one array per channel. */
export function deinterleave(samples: Float32Array, channelCount: number): Channels {
  const frames = samples.length / channelCount;
  return Array.from({ length: channelCount }, (_, ch) =>
    Float32Array.from({ length: frames }, (_, i) => samples[i * channelCount + ch]),
  );
}
