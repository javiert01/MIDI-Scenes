/**
 * The Warm Analog Tone (see **Tone** in `CONTEXT.md`): the default sound,
 * synthesised, carried over unchanged from the Preview Synth it replaces
 * (ADR-0007, ADR-0009). Each voice is a detuned sawtooth unison plus a
 * sub-octave sine, through a resonant low-pass filter and an ADSR, with a short
 * release tail so a note-off never clicks. It ignores velocity.
 */
import type { AudioContextLike, AudioNodeLike, GainNodeLike, OscillatorNodeLike } from './audio';
import type { Tone, ToneVoice } from './tonePlayer';
import { DEFAULT_TONE_ID, toneById } from '@/tones/catalogue';

/** Its fixed gain, attack and release, from the Tone catalogue. */
const DEFINITION = toneById(DEFAULT_TONE_ID);

/** Waveform of the unison oscillators — harmonically rich, tamed by the filter. */
const OSC_TYPE: OscillatorType = 'sawtooth';
/** Waveform of the sub-octave voice — a clean sine for weight, no extra buzz. */
const SUB_OSC_TYPE: OscillatorType = 'sine';
/**
 * Detune (in cents) of the unison oscillators around the played pitch. One sits
 * dead-on, the others a touch sharp/flat so they beat against each other — the
 * shimmer that makes the tone feel analog rather than static.
 */
const UNISON_OFFSETS_CENTS = [-7, 0, 7];
/** Summed level of the three unison oscillators, feeding the amplitude envelope. */
const UNISON_MIX_LEVEL = 0.28;
/** Level of the sub-octave sine — present for body, under the unison so it never booms. */
const SUB_MIX_LEVEL = 0.2;
/** Filter resonance: a gentle bump at the cutoff for a little analog character. */
const FILTER_Q = 1;
/** Low-pass cutoff multipliers over the note's own frequency, so high notes stay bright. */
const FILTER_PEAK_MULTIPLE = 14; // open and bright at the attack transient
const FILTER_SUSTAIN_MULTIPLE = 6; // settles warmer while the note is held
/** Cutoff bounds (Hz) so the filter neither closes to a thud nor opens past usefulness. */
const FILTER_MIN_HZ = 500;
const FILTER_MAX_HZ = 16000;
/** Fast attack so notes speak immediately (seconds), from the catalogue. */
const ATTACK_SECONDS = DEFINITION.attackSeconds;
/** Brief decay from peak to the sustain level (seconds). */
const DECAY_SECONDS = 0.08;
/**
 * The voice's overall level: the Preview Synth's old master gain, folded into the
 * voice so the Tone Player's master can sit at 1.0 and Warm Analog still sounds
 * exactly as loud as it did (ADR-0009).
 */
const VOICE_LEVEL = 0.15;
/** Envelope peak at the end of the attack. */
const PEAK_LEVEL = 1 * VOICE_LEVEL;
/** Envelope level a held note settles to. */
const SUSTAIN_LEVEL = 0.7 * VOICE_LEVEL;
/** Short release tail on note-off, from the catalogue, avoiding a hard click. */
const RELEASE_SECONDS = DEFINITION.releaseSeconds;

/** Equal-tempered MIDI note number to frequency in Hz (A4 = note 69 = 440 Hz). */
export function midiToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/** Shifts a frequency by a number of cents (1200 cents = one octave). */
function detune(freq: number, cents: number): number {
  return freq * 2 ** (cents / 1200);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function startVoice(
  ctx: AudioContextLike,
  note: number,
  output: AudioNodeLike,
  bendCents: number,
): ToneVoice {
  const now = ctx.currentTime;
  const freq = midiToFrequency(note);
  const decayEnd = now + ATTACK_SECONDS + DECAY_SECONDS;

  // Amplitude envelope shared by the whole voice: silent -> peak -> sustain.
  const envelope: GainNodeLike = ctx.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(PEAK_LEVEL, now + ATTACK_SECONDS);
  envelope.gain.linearRampToValueAtTime(SUSTAIN_LEVEL, decayEnd);

  // Low-pass filter with its own envelope: bright at the attack, warmer as it settles.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.setValueAtTime(FILTER_Q, now);
  filter.frequency.setValueAtTime(
    clamp(freq * FILTER_SUSTAIN_MULTIPLE, FILTER_MIN_HZ, FILTER_MAX_HZ),
    now,
  );
  filter.frequency.linearRampToValueAtTime(
    clamp(freq * FILTER_PEAK_MULTIPLE, FILTER_MIN_HZ, FILTER_MAX_HZ),
    now + ATTACK_SECONDS,
  );
  filter.frequency.linearRampToValueAtTime(
    clamp(freq * FILTER_SUSTAIN_MULTIPLE, FILTER_MIN_HZ, FILTER_MAX_HZ),
    decayEnd,
  );
  filter.connect(envelope);
  envelope.connect(output);

  const oscillators: OscillatorNodeLike[] = [];

  // Detuned unison of sawtooth oscillators, summed through one mix gain.
  const unisonMix = ctx.createGain();
  unisonMix.gain.setValueAtTime(UNISON_MIX_LEVEL, now);
  unisonMix.connect(filter);
  for (const cents of UNISON_OFFSETS_CENTS) {
    const osc = ctx.createOscillator();
    osc.type = OSC_TYPE;
    osc.frequency.setValueAtTime(detune(freq, cents), now);
    osc.detune.setValueAtTime(bendCents, now);
    osc.connect(unisonMix);
    osc.start(now);
    oscillators.push(osc);
  }

  // Sub-octave sine for body, one octave below the played pitch.
  const subMix = ctx.createGain();
  subMix.gain.setValueAtTime(SUB_MIX_LEVEL, now);
  subMix.connect(filter);
  const sub = ctx.createOscillator();
  sub.type = SUB_OSC_TYPE;
  sub.frequency.setValueAtTime(freq / 2, now);
  sub.detune.setValueAtTime(bendCents, now);
  sub.connect(subMix);
  sub.start(now);
  oscillators.push(sub);

  const stop = (time: number) => {
    for (const osc of oscillators) osc.stop(time);
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
    bend(cents, time, timeConstant) {
      for (const osc of oscillators) osc.detune.setTargetAtTime(cents, time, timeConstant);
    },
    stop,
  };
}

/** Warm Analog: first in the Tone list and the default. Fixed gain 0 dB, the reference level. */
export const WARM_ANALOG: Tone = {
  id: DEFINITION.id,
  gainDb: DEFINITION.gainDb,
  // Synthesised, so every note has a sound.
  sounds: () => true,
  // Ignores velocity, as the Preview Synth did.
  startVoice: (ctx, note, _velocity, output, bendCents) => startVoice(ctx, note, output, bendCents),
};
