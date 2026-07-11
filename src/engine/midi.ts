import type { NoteEvent } from './scene';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const STATUS_NOTE_OFF = 0x8;
const STATUS_NOTE_ON = 0x9;

export interface ParsedNoteMessage {
  type: 'noteon' | 'noteoff';
  event: NoteEvent;
}

/** MIDI note number (0..127) to scientific pitch name, e.g. 60 -> 'C4'. */
export function noteNumberToName(note: number): string {
  const octave = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[note % 12]}${octave}`;
}

/**
 * Normalizes a raw 3-byte MIDI message into a NoteEvent. Only note-on/note-off
 * are recognized; CC, pitch-bend, sustain, etc. return null (ignored in v1).
 * A note-on with velocity 0 is normalized to note-off per the MIDI spec.
 */
export function parseNoteMessage(data: ArrayLike<number>): ParsedNoteMessage | null {
  if (data.length < 3) return null;

  const statusByte = data[0];
  const command = statusByte >> 4;
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
