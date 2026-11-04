/**
 * The injected Web Audio seam the Tone Player sounds through (ADR-0007, ADR-0009).
 * Only the subset of the Web Audio API the Tone Player and its Tones use is named
 * here, so tests run against a fake context with no real audio, mirroring the
 * `createP5` / `createMidi` dependency-injection seams.
 */

/** The subset of an `AudioParam` the Tone Player automates. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

/** A node audio can be routed into (a gain, or the context destination). */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

/** A resonant filter node. */
export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  frequency: AudioParamLike;
  Q: AudioParamLike;
}

/** A transfer-curve node; the Tone Player's output ceiling is one. */
export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null;
  oversample: OverSampleType;
}

/** The subset of `AudioContext` the Tone Player depends on; lets tests inject a fake. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly state?: AudioContextState;
  /** Seconds from scheduling a sound to hearing it. Not reported everywhere (older Safari). */
  readonly outputLatency?: number;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createWaveShaper(): WaveShaperNodeLike;
  resume?(): Promise<void>;
  close?(): Promise<void>;
}

/** Builds the context. The Tone Player passes the options it needs, such as `latencyHint`. */
export type AudioContextFactory = (options: AudioContextOptions) => AudioContextLike;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContextLike;

/**
 * Default factory: the real browser `AudioContext` (or the `webkit`-prefixed
 * fallback), resolved inside the call so nothing constructs an `AudioContext` at
 * module scope. Throws where Web Audio is unavailable (jsdom/SSR); the Tone Player
 * catches this and stays silent.
 */
export const defaultAudioContextFactory: AudioContextFactory = (options) => {
  const globals = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API is unavailable in this environment');
  return new Ctor(options);
};

/** Converts decibels to a linear gain (0 dB = 1). */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
