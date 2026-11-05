/**
 * The Tone Player (see **Tone Player** in `CONTEXT.md` and
 * `docs/adr/0009-tone-player.md`): the engine-owned player that sounds notes with
 * the selected Tone, on native Web Audio behind the injected `AudioContextLike`
 * seam. It owns no DOM or engine state; each source's entry point calls it
 * before dispatching the note, naming the source, so `NoteEvent` needs no source
 * tag.
 *
 * Output chain: each voice -> its Tone's fixed gain -> master (1.0) -> a
 * soft-clip wave-shaper ceiling -> destination.
 */
import {
  type AudioBufferLike,
  type AudioContextFactory,
  type AudioContextLike,
  type AudioNodeLike,
  type GainNodeLike,
  dbToGain,
  defaultAudioContextFactory,
} from './audio';

/**
 * Who is sounding a note: the Virtual Input (both its surfaces), or a Device.
 * Coarser than the engine's per-surface `SoundSource`.
 */
export type SoundSource = 'virtual' | 'device';

/** One sounding note of a Tone, as the Tone built it. */
export interface ToneVoice {
  /** Starts the release tail at `time`; returns the time the voice falls silent. */
  release(time: number): number;
  /**
   * Glides the voice's pitch, release samples included, to `cents` off the note
   * from `time`, approaching it exponentially with `timeConstant` seconds.
   */
  bend(cents: number, time: number, timeConstant: number): void;
  /** Stops the voice's sources at `time`, once the Tone Player's fade is done. */
  stop(time: number): void;
}

/**
 * A Tone the Tone Player can sound: synthesised, or sampled from decoded
 * buffers. Builds a voice for each note, routed into `output`.
 */
export interface Tone {
  id: string;
  /** The Tone's fixed gain, matched to Warm Analog (0 dB) by ear. */
  gainDb: number;
  /** Whether the Tone has a sound for `note` at `velocity`. Outside every region a sampled Tone has none. */
  sounds(note: number, velocity: number): boolean;
  /** Starts a voice for `note`, already bent `bendCents` off it, with no glide. */
  startVoice(
    ctx: AudioContextLike,
    note: number,
    velocity: number,
    output: AudioNodeLike,
    bendCents: number,
  ): ToneVoice;
}

/** Master gain: 1.0, so Warm Analog sounds exactly as loud as the Preview Synth did (ADR-0009). */
const MASTER_GAIN = 1;
/** Most voices sounding at once, counting key-held voices, pedal-held voices and release tails alike. */
const MAX_VOICES = 32;
/** How fast a stolen, silenced or retriggered voice fades out (seconds), fast but click-free. */
const FADE_SECONDS = 0.02;
/** A bend wheel at full travel bends ±2 semitones, for every Tone; RPN 0 can't change it. */
const BEND_RANGE_CENTS = 200;
/** Bends glide towards the wheel with this time constant (seconds), so they never step. */
const BEND_TIME_CONSTANT = 0.004;

/** The ceiling passes signal through unchanged below this level (about -6 dBFS). */
const CEILING_KNEE = dbToGain(-6);
/** The level the ceiling's tanh knee approaches but never reaches (about -0.3 dBFS). */
const CEILING_LIMIT = dbToGain(-0.3);
/**
 * How far over full scale the ceiling's curve reaches. A wave shaper clamps its
 * input to ±1, which would hard-clip anything louder, so a drive gain of
 * 1/CEILING_RANGE scales the signal into the curve, which spans ±CEILING_RANGE.
 */
const CEILING_RANGE = 8;
/** Curve resolution: odd, so silence lands exactly on the middle sample. */
const CEILING_CURVE_SAMPLES = 8193;

/** The ceiling's transfer function: linear below the knee, then a tanh bend towards the limit. */
function softClip(x: number): number {
  const magnitude = Math.abs(x);
  if (magnitude <= CEILING_KNEE) return x;
  const span = CEILING_LIMIT - CEILING_KNEE;
  return Math.sign(x) * (CEILING_KNEE + span * Math.tanh((magnitude - CEILING_KNEE) / span));
}

/** The ceiling's curve, sampled over ±CEILING_RANGE. Built once, on the first context. */
function ceilingCurve(): Float32Array {
  const curve = new Float32Array(CEILING_CURVE_SAMPLES);
  for (let i = 0; i < CEILING_CURVE_SAMPLES; i += 1) {
    const x = ((2 * i) / (CEILING_CURVE_SAMPLES - 1) - 1) * CEILING_RANGE;
    curve[i] = softClip(x);
  }
  return curve;
}

export interface TonePlayerOptions {
  /** The Tone notes sound with until `setTone` picks another. */
  tone: Tone;
  /** Injected AudioContext factory; defaults to the real browser context. */
  createAudioContext?: AudioContextFactory;
  /** Called once a suspended context has resumed. */
  onResumed?: () => void;
}

interface Voice {
  note: number;
  /** The Tone the voice sounds with, kept across a switch so the voice finishes on it. */
  tone: Tone;
  /** The sources keeping the note down. Empty once the pedal holds it, or it is releasing. */
  holders: Set<SoundSource>;
  /** Whether the sustain pedal holds the note: its last key came up while the pedal was down. */
  pedalHeld: boolean;
  /** When a releasing voice falls silent; Infinity while held by a key or the pedal. */
  endTime: number;
  /** What the Tone built to sound the note. */
  sound: ToneVoice;
  /** The voice's own copy of its Tone's fixed gain. */
  output: GainNodeLike;
}

export class TonePlayer {
  private readonly createAudioContext: AudioContextFactory;
  private tone: Tone;
  private readonly onResumed?: () => void;
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  /** Set once the injected factory fails (e.g. jsdom/SSR); the player stays silent. */
  private audioUnavailable = false;
  /** Every voice still sounding, held or releasing, oldest first. */
  private readonly voices: Voice[] = [];
  /** Whether the Device's sustain pedal is down. */
  private sustainDown = false;
  /** Where the Device's bend wheel sits, in cents off every note. */
  private bendCents = 0;

  constructor(options: TonePlayerOptions) {
    this.createAudioContext = options.createAudioContext ?? defaultAudioContextFactory;
    this.tone = options.tone;
    this.onResumed = options.onResumed;
  }

  /** Whether audio is running: a context exists and the browser isn't holding it suspended. */
  get running(): boolean {
    return this.ctx !== null && (this.ctx.state ?? 'running') === 'running';
  }

  /** Whether a context exists and the browser holds it suspended, waiting for a gesture. */
  get suspended(): boolean {
    return this.ctx?.state === 'suspended';
  }

  /**
   * The ids of the Tones the player still holds: the selected one first, then
   * any it was switched away from whose voices still sound. A Tone is let go,
   * with its buffers, at the first note or switch after its last voice ends: the
   * player keeps no timers, and that is as soon as a released note is noticed.
   */
  get heldToneIds(): string[] {
    const ids = [this.tone.id];
    for (const voice of this.voices) if (!ids.includes(voice.tone.id)) ids.push(voice.tone.id);
    return ids;
  }

  /** The context's output latency in seconds, or null before a context exists or where it isn't reported. */
  get outputLatency(): number | null {
    return this.ctx?.outputLatency ?? null;
  }

  /**
   * Sounds every note from the next one with `tone`. Voices already sounding
   * finish on their old Tone, at its gain.
   */
  setTone(tone: Tone): void {
    this.tone = tone;
    if (this.ctx) this.forgetEnded(this.ctx.currentTime);
  }

  /**
   * Decodes a sampled Tone's file through the context, creating it (without
   * resuming it) if need be. Rejects where Web Audio is unavailable.
   */
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    const ctx = this.ensureContext();
    if (!ctx) return Promise.reject(new Error('Web Audio API is unavailable'));
    return ctx.decodeAudioData(data);
  }

  /**
   * Sounds `note` for `source`. `velocity` is the raw MIDI value, 1..127. A note
   * another source already holds gains a hold with no new attack; a note this
   * source already holds retriggers, its old voice releasing. A note the pedal
   * holds retriggers too, its old voice fading out over 20 ms. A note the Tone
   * has no sound for stays silent and takes no voice. A note starts bent as far
   * as the wheel is.
   */
  noteOn(source: SoundSource, note: number, velocity: number): void {
    const ctx = this.start();
    if (!ctx || !this.master) return;

    const held = this.heldVoice(note);
    if (held && !held.holders.has(source)) {
      held.holders.add(source);
      return;
    }
    if (held) this.release(held, ctx.currentTime);
    const pedalled = this.voices.find((v) => v.note === note && v.pedalHeld);
    if (pedalled) this.fadeOut(pedalled, ctx.currentTime);
    const tone = this.tone;
    if (!tone.sounds(note, velocity)) return;
    this.makeRoom(ctx.currentTime);

    const output = ctx.createGain();
    output.gain.setValueAtTime(dbToGain(tone.gainDb), ctx.currentTime);
    output.connect(this.master);
    this.voices.push({
      note,
      tone,
      holders: new Set([source]),
      pedalHeld: false,
      endTime: Infinity,
      sound: tone.startVoice(ctx, note, velocity, output, this.bendCents),
      output,
    });
  }

  /**
   * Lets go of `source`'s hold on `note`. When its last holder lets go the voice
   * releases, or, while the pedal is down, the pedal holds it.
   */
  noteOff(source: SoundSource, note: number): void {
    const held = this.heldVoice(note);
    if (!held || !this.ctx || !held.holders.delete(source)) return;
    if (held.holders.size > 0) return;
    if (this.sustainDown) held.pedalHeld = true;
    else this.release(held, this.ctx.currentTime);
  }

  /**
   * Presses or lifts the Device's sustain pedal. It holds every source's notes,
   * Virtual Input ones included, since it is one instrument. Lifting it releases
   * every note no key still holds.
   */
  setSustain(down: boolean): void {
    this.sustainDown = down;
    if (down || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.voices.filter((v) => v.pedalHeld)) this.release(voice, now);
  }

  /**
   * Moves the Device's bend wheel, −1..1, bending every sounding voice (key-held,
   * pedal-held and releasing, from every source) by up to ±2 semitones, gliding
   * there with a 4 ms time constant. Notes started later start bent.
   */
  setPitchBend(amount: number): void {
    this.bendCents = Math.max(-1, Math.min(1, amount)) * BEND_RANGE_CENTS;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.voices) voice.sound.bend(this.bendCents, now, BEND_TIME_CONSTANT);
  }

  /**
   * Lifts the pedal and centres the bend wheel, as when the Device is unplugged
   * or switched, or Device sound turns off, so neither stays stuck.
   */
  resetDeviceControls(): void {
    this.setSustain(false);
    this.setPitchBend(0);
  }

  /**
   * Lets go of every hold `source` has, as if each of its note-offs had arrived:
   * a voice another source still holds keeps sounding (Device sound turned off,
   * a Device unplugged).
   */
  releaseSource(source: SoundSource): void {
    for (const voice of this.voices.filter((v) => v.holders.has(source))) {
      this.noteOff(source, voice.note);
    }
  }

  /** Fades every voice, held or releasing, out over 20 ms (sound turned off). */
  silenceAll(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of [...this.voices]) this.fadeOut(voice, now);
  }

  /**
   * Creates the AudioContext, with its output chain, if it doesn't exist yet,
   * and resumes it if suspended. Call it on the gesture that turns sound on, so
   * the first note doesn't pay for a cold start; a note calls it too, as a
   * Virtual Input press is itself a gesture. Returns null, and the player stays
   * silent, where Web Audio is unavailable.
   */
  start(): AudioContextLike | null {
    const ctx = this.ensureContext();
    this.resume();
    return ctx;
  }

  /**
   * Creates the AudioContext without resuming it. At page load, with no gesture
   * yet, the browser leaves it suspended until `resume()`; creating it early
   * spares the first note a cold start.
   */
  prepare(): void {
    this.ensureContext();
  }

  /** Resumes the context if the browser holds it suspended. Never creates one. */
  resume(): void {
    const ctx = this.ctx;
    if (ctx?.state !== 'suspended' || !ctx.resume) return;
    void ctx.resume().then(
      () => this.onResumed?.(),
      () => {
        // Refused without a gesture: stays suspended until the next one.
      },
    );
  }

  /**
   * Tears the player down on engine destroy: silences every voice and closes the
   * AudioContext, so none leaks across an unmount/remount. A no-op before any
   * context was created.
   */
  dispose(): void {
    this.silenceAll();
    void this.ctx?.close?.();
    this.ctx = null;
    this.master = null;
  }

  /** The voice key-held on `note`, if any. There is at most one. */
  private heldVoice(note: number): Voice | undefined {
    return this.voices.find((v) => v.note === note && v.holders.size > 0);
  }

  /** Starts a key-held or pedal-held voice's release tail. */
  private release(voice: Voice, now: number): void {
    voice.holders.clear();
    voice.pedalHeld = false;
    voice.endTime = voice.sound.release(now);
  }

  /**
   * Forgets release tails that have fallen silent, then, at the cap, steals the
   * oldest voice: a release tail if there is one, then a pedal-held voice, and
   * only then a key-held one.
   */
  private makeRoom(now: number): void {
    this.forgetEnded(now);
    if (this.voices.length < MAX_VOICES) return;
    const victim =
      this.voices.find((v) => v.holders.size === 0 && !v.pedalHeld) ??
      this.voices.find((v) => v.pedalHeld) ??
      this.voices[0];
    this.fadeOut(victim, now);
  }

  /** Forgets release tails that have fallen silent, and with them any Tone only they still held. */
  private forgetEnded(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i -= 1) {
      if (this.voices[i].endTime <= now) this.voices.splice(i, 1);
    }
  }

  /** Fades a voice out over 20 ms and forgets it, whatever state it was in. */
  private fadeOut(voice: Voice, now: number): void {
    const endTime = now + FADE_SECONDS;
    const { gain } = voice.output;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, endTime);
    voice.sound.stop(endTime);
    this.voices.splice(this.voices.indexOf(voice), 1);
  }

  /** Creates the AudioContext and its output chain on first use; null where Web Audio is unavailable. */
  private ensureContext(): AudioContextLike | null {
    if (this.ctx) return this.ctx;
    if (this.audioUnavailable) return null;

    try {
      const ctx = this.createAudioContext({ latencyHint: 0 });
      // Oversampling off: it would add latency, and the curve is linear where
      // ordinary playing sits, so only rare peaks could alias.
      const ceiling = ctx.createWaveShaper();
      ceiling.curve = ceilingCurve();
      ceiling.oversample = 'none';
      ceiling.connect(ctx.destination);
      const drive = ctx.createGain();
      drive.gain.setValueAtTime(1 / CEILING_RANGE, ctx.currentTime);
      drive.connect(ceiling);
      const master = ctx.createGain();
      master.gain.setValueAtTime(MASTER_GAIN, ctx.currentTime);
      master.connect(drive);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      this.audioUnavailable = true;
      return null;
    }
  }
}
