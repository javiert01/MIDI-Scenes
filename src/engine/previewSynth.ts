/**
 * The Preview Synth: a native Web Audio synthesizer that makes Virtual Input
 * notes audible (see the **Preview Synth** entry in `CONTEXT.md` and
 * `docs/adr/0007-preview-synth.md`). Polyphonic — one oscillator + ADSR voice
 * per held note number — with a clean synth tone and a short release tail so a
 * note-off never clicks. A single conservative master gain gives chords the
 * headroom not to clip; there is no volume control in v1.
 *
 * The `AudioContext` is supplied via an injected factory (defaulting to the real
 * one, guarded for jsdom/SSR), mirroring the `createP5` / `createMidi`
 * dependency-injection seam — so tests run against a mock context with no real
 * audio. The context is created lazily on the first sounded note (itself a user
 * gesture), satisfying browser autoplay rules. This module is pure and owns no
 * DOM or engine state; wiring it into the Virtual Input surfaces is a follow-up.
 */

/** The subset of an `AudioParam` the synth automates. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

/** A node the synth can route audio into (a gain, or the context destination). */
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

/** The subset of `AudioContext` the synth depends on; lets tests inject a fake. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly state?: AudioContextState;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  resume?(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike;

type AudioContextConstructor = new () => AudioContextLike;

/**
 * Default factory: the real browser `AudioContext` (or the `webkit`-prefixed
 * fallback), resolved lazily inside the call so nothing constructs an
 * `AudioContext` at module scope. Throws where Web Audio is unavailable
 * (jsdom/SSR); the synth catches this and stays silent.
 */
export const defaultAudioContextFactory: AudioContextFactory = () => {
  const globals = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API is unavailable in this environment');
  return new Ctor();
};

/** Oscillator waveform — a clean, mellow synth tone. */
const OSC_TYPE: OscillatorType = 'triangle';
/** Fast attack so notes speak immediately (seconds). */
const ATTACK_SECONDS = 0.01;
/** Brief decay from peak to the sustain level (seconds). */
const DECAY_SECONDS = 0.08;
/** Per-voice peak amplitude at the end of the attack. */
const PEAK_LEVEL = 1;
/** Per-voice sustain amplitude a held note settles to. */
const SUSTAIN_LEVEL = 0.7;
/** Short release tail on note-off (~200 ms), avoiding a hard click. */
export const RELEASE_SECONDS = 0.2;
/**
 * Single fixed master gain, kept conservative so a handful of concurrent voices
 * sum without clipping. No volume control in v1.
 */
export const MASTER_GAIN = 0.15;

/** Equal-tempered MIDI note number to frequency in Hz (A4 = note 69 = 440 Hz). */
export function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

interface Voice {
  osc: OscillatorNodeLike;
  gain: GainNodeLike;
}

export interface PreviewSynthOptions {
  /** Injected AudioContext factory; defaults to the real browser context. */
  createAudioContext?: AudioContextFactory;
  /** Whether the synth sounds notes at all. Defaults to on (see ADR-0007). */
  enabled?: boolean;
}

export class PreviewSynth {
  private readonly createAudioContext: AudioContextFactory;
  private enabled: boolean;
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  /** Sounding voices keyed by note number — one per held note (polyphonic). */
  private readonly voices = new Map<number, Voice>();
  /** Set once the injected factory fails (e.g. jsdom/SSR); the synth stays silent. */
  private audioUnavailable = false;

  constructor(options: PreviewSynthOptions = {}) {
    this.createAudioContext = options.createAudioContext ?? defaultAudioContextFactory;
    this.enabled = options.enabled ?? true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Toggles the synth. Turning it off immediately releases every held voice. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  /** Starts a voice for `note`. Silent while disabled; retriggers a held note. */
  noteOn(note: number): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    // Retrigger: release the held voice so we never orphan its oscillator.
    if (this.voices.has(note)) this.noteOff(note);

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = OSC_TYPE;
    osc.frequency.setValueAtTime(midiToFrequency(note), now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(PEAK_LEVEL, now + ATTACK_SECONDS);
    gain.gain.linearRampToValueAtTime(SUSTAIN_LEVEL, now + ATTACK_SECONDS + DECAY_SECONDS);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);

    this.voices.set(note, { osc, gain });
  }

  /** Releases `note`'s voice with a short tail. No-op if the note isn't held. */
  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice) return;
    this.voices.delete(note);
    this.releaseVoice(voice);
  }

  /** Releases every held voice (toggle-off, window blur, mouse-up). */
  releaseAll(): void {
    for (const voice of this.voices.values()) this.releaseVoice(voice);
    this.voices.clear();
  }

  /** Ramps a voice down to silence over the release tail, then stops its oscillator. */
  private releaseVoice(voice: Voice): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const endTime = now + RELEASE_SECONDS;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, endTime);
    voice.osc.stop(endTime);
  }

  /**
   * Lazily creates the AudioContext and its shared master gain on first use,
   * resuming a suspended context (autoplay). Returns null — and stays silent —
   * if Web Audio is unavailable.
   */
  private ensureContext(): AudioContextLike | null {
    if (this.ctx) return this.ctx;
    if (this.audioUnavailable) return null;

    try {
      const ctx = this.createAudioContext();
      const master = ctx.createGain();
      master.gain.setValueAtTime(MASTER_GAIN, ctx.currentTime);
      master.connect(ctx.destination);
      if (ctx.state === 'suspended') void ctx.resume?.();
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      this.audioUnavailable = true;
      return null;
    }
  }
}
