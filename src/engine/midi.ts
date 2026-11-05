import type { NoteEvent } from './scene';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const STATUS_NOTE_OFF = 0x8;
const STATUS_NOTE_ON = 0x9;
const STATUS_CONTROL_CHANGE = 0xb;
const STATUS_PITCH_BEND = 0xe;

/** The sustain (damper) pedal's controller number. */
const CC_SUSTAIN = 64;
/** CC64 at or above this counts as down; half-pedalling is ignored. */
const SUSTAIN_DOWN_THRESHOLD = 64;
/** The 14-bit pitch-bend value of a centred wheel. */
const PITCH_BEND_CENTRE = 8192;
/** The 14-bit pitch-bend maximum, so a wheel pushed fully up reads exactly 1. */
const PITCH_BEND_MAX = 16383;

/**
 * A Device message the engine acts on. Notes are dispatched to the visuals;
 * sustain and pitch bend only ever reach the Tone Player (ADR-0009).
 */
export type ParsedMidiMessage =
  | { type: 'noteon' | 'noteoff'; event: NoteEvent }
  /** CC64: down at 64 or above. */
  | { type: 'sustain'; down: boolean }
  /** −1 (wheel fully down) .. 0 (centred) .. 1 (fully up). */
  | { type: 'pitchbend'; amount: number };

/** MIDI note number (0..127) to scientific pitch name, e.g. 60 -> 'C4'. */
export function noteNumberToName(note: number): string {
  const octave = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[note % 12]}${octave}`;
}

/**
 * Parses a raw MIDI message into a note on/off, a sustain-pedal change or a
 * pitch bend. Everything else (other CCs, RPN 0 bend-range messages included,
 * aftertouch, program change…) returns null. The channel never filters (omni):
 * a note keeps it on its NoteEvent, and sustain and bend ignore it. A note-on
 * with velocity 0 is normalized to note-off per the MIDI spec.
 */
export function parseMidiMessage(data: ArrayLike<number>): ParsedMidiMessage | null {
  if (data.length < 3) return null;

  const statusByte = data[0];
  const command = statusByte >> 4;

  if (command === STATUS_CONTROL_CHANGE) {
    if (data[1] !== CC_SUSTAIN) return null;
    return { type: 'sustain', down: data[2] >= SUSTAIN_DOWN_THRESHOLD };
  }

  if (command === STATUS_PITCH_BEND) {
    const value = (data[2] << 7) | data[1];
    const offset = value - PITCH_BEND_CENTRE;
    const span = offset < 0 ? PITCH_BEND_CENTRE : PITCH_BEND_MAX - PITCH_BEND_CENTRE;
    return { type: 'pitchbend', amount: offset / span };
  }

  if (command !== STATUS_NOTE_ON && command !== STATUS_NOTE_OFF) return null;

  const channel = (statusByte & 0x0f) + 1;
  const note = data[1];
  const rawVelocity = data[2];
  const isNoteOn = command === STATUS_NOTE_ON && rawVelocity > 0;
  const raw = isNoteOn ? rawVelocity : 0;

  return {
    type: isNoteOn ? 'noteon' : 'noteoff',
    event: { note, name: noteNumberToName(note), velocity: raw / 127, raw, channel },
  };
}
