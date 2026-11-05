/**
 * The Villera Lead Tone (see **Tone** in `CONTEXT.md`, and ADR-0009): a bright,
 * nasal keyboard lead for cumbia villera, synthesised, so it has no download.
 * It is variant D from the audition bench (`prototype/tone-audition` at
 * 250075e), unchanged, as #50 decided: a square plus a saw, through a 320 Hz
 * high-pass, a nasal 1.7 kHz peak and an 11 kHz low-pass, gliding into each
 * note from a semitone below, with a gentle vibrato that fades in once the note
 * has spoken. "Villera Lead" is a working name; its saved id never changes.
 */
import type {
  AudioContextLike,
  AudioNodeLike,
  BiquadFilterNodeLike,
  OscillatorNodeLike,
} from './audio';
import type { Tone, ToneVoice } from './tonePlayer';
import { midiToFrequency } from './warmAnalog';
import { toneById } from '@/tones/catalogue';

/** Its fixed gain, attack, release and velocity tracking, from the Tone catalogue. */
const DEFINITION = toneById('villera-lead');

/** The oscillators: a square on the note, and a saw a touch sharp so the two beat. */
const WAVES: readonly { type: OscillatorType; cents: number; level: number }[] = [
  { type: 'square', cents: 0, level: 0.5 },
  { type: 'sawtooth', cents: 6, level: 0.35 },
];

/** A high-pass that thins the body out, so the lead sits above the band. */
const HIGH_PASS_HZ = 320;
const HIGH_PASS_Q = 0.7;
/** The nasal peak: a narrow, strong boost that gives the lead its reedy bite. */
const PEAK_HZ = 1700;
const PEAK_Q = 3.2;
const PEAK_DB = 11;
/** A low-pass that only trims the fizz above the peak. */
const LOW_PASS_HZ = 11000;
const LOW_PASS_Q = 0.8;

/** Each note scoops up from this far below (semitones), over GLIDE_SECONDS. */
const GLIDE_FROM_SEMITONES = 1;
const GLIDE_SECONDS = 0.04;

/** The vibrato: a sine LFO on the oscillators' detune. */
const VIBRATO_RATE_HZ = 5.6;
const VIBRATO_CENTS = 18;
/** The vibrato stays out for this long after the note starts (seconds)... */
const VIBRATO_DELAY_SECONDS = 0.22;
/** ...then fades in to full depth over this long (seconds). */
const VIBRATO_FADE_IN_SECONDS = 0.35;

/** The voice's peak level at full velocity, matched by ear with the fixed gain against Warm Analog. */
const VOICE_LEVEL = 0.11;
/** How quickly a note speaks (seconds), from the catalogue. */
const ATTACK_SECONDS = DEFINITION.attackSeconds;
/** When a held note has settled from its peak (seconds after it starts)... */
const SETTLE_SECONDS = 0.12;
/** ...to this share of the peak. */
const SUSTAIN_RATIO = 0.85;
/** How long a released note takes to fall silent (seconds), from the catalogue. */
const RELEASE_SECONDS = DEFINITION.releaseSeconds;
/** How far velocity shapes the level: level × (1 − t + t · v/127), so (0.55 + 0.45 · v/127). */
const VELOCITY_TRACKING = DEFINITION.velocityTracking;

function filter(
  ctx: AudioContextLike,
  type: BiquadFilterType,
  frequency: number,
  q: number,
  now: number,
): BiquadFilterNodeLike {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.setValueAtTime(frequency, now);
  node.Q.setValueAtTime(q, now);
  return node;
}

function startVoice(
  ctx: AudioContextLike,
  note: number,
  velocity: number,
  output: AudioNodeLike,
  bendCents: number,
): ToneVoice {
  const now = ctx.currentTime;
  const freq = midiToFrequency(note);

  // Amplitude envelope: silent -> the velocity's peak -> a little under it.
  const level = VOICE_LEVEL * (1 - VELOCITY_TRACKING + VELOCITY_TRACKING * (velocity / 127));
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(level, now + ATTACK_SECONDS);
  envelope.gain.linearRampToValueAtTime(level * SUSTAIN_RATIO, now + SETTLE_SECONDS);
  envelope.connect(output);

  // High-pass -> nasal peak -> low-pass -> envelope.
  const highPass = filter(ctx, 'highpass', HIGH_PASS_HZ, HIGH_PASS_Q, now);
  const peak = filter(ctx, 'peaking', PEAK_HZ, PEAK_Q, now);
  peak.gain.setValueAtTime(PEAK_DB, now);
  const lowPass = filter(ctx, 'lowpass', LOW_PASS_HZ, LOW_PASS_Q, now);
  highPass.connect(peak);
  peak.connect(lowPass);
  lowPass.connect(envelope);

  // Delayed vibrato: an LFO whose depth, in cents, fades in once the note has spoken.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(VIBRATO_RATE_HZ, now);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, now);
  depth.gain.setValueAtTime(0, now + VIBRATO_DELAY_SECONDS);
  depth.gain.linearRampToValueAtTime(
    VIBRATO_CENTS,
    now + VIBRATO_DELAY_SECONDS + VIBRATO_FADE_IN_SECONDS,
  );
  lfo.connect(depth);
  lfo.start(now);

  // The sounding oscillators. Each one's offset lives in its frequency, so its
  // detune carries only the bend (and the vibrato on top), and a bend keeps it.
  const oscillators: OscillatorNodeLike[] = WAVES.map(({ type, cents, level: mixLevel }) => {
    const target = freq * 2 ** (cents / 1200);
    const mix = ctx.createGain();
    mix.gain.setValueAtTime(mixLevel, now);
    mix.connect(highPass);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(target * 2 ** (-GLIDE_FROM_SEMITONES / 12), now);
    osc.frequency.exponentialRampToValueAtTime(target, now + GLIDE_SECONDS);
    osc.detune.setValueAtTime(bendCents, now);
    depth.connect(osc.detune);
    osc.connect(mix);
    osc.start(now);
    return osc;
  });

  const stop = (time: number) => {
    for (const osc of oscillators) osc.stop(time);
    lfo.stop(time);
  };

  return {
    release(time) {
      const endTime = time + RELEASE_SECONDS;
      envelope.gain.cancelScheduledValues(time);
      envelope.gain.setValueAtTime(envelope.gain.value, time);
      envelope.gain.linearRampToValueAtTime(0, endTime);
      stop(endTime);
      return endTime;
    },
    // Bends every sounding oscillator, as Warm Analog does; the vibrato's rate stays put.
    bend(cents, time, timeConstant) {
      for (const osc of oscillators) osc.detune.setTargetAtTime(cents, time, timeConstant);
    },
    stop,
  };
}

/** Villera Lead, listed under Cumbia. Fixed gain −3 dB. */
export const VILLERA_LEAD: Tone = {
  id: DEFINITION.id,
  gainDb: DEFINITION.gainDb,
  // Synthesised, so every note has a sound.
  sounds: () => true,
  startVoice,
};
