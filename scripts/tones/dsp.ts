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
