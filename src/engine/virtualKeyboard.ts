/**
 * The computer-keyboard surface of the Virtual Input: maps physical keys to
 * notes so a Scene can be tested without a MIDI Device. Pure and DOM-free — the
 * engine binds the `window` listeners and calls into here (see ADR-0005). Uses
 * `KeyboardEvent.code` (physical position) rather than `.key`, so the layout
 * holds regardless of QWERTY/AZERTY or letter-vs-symbol.
 */

import { noteNumberToName } from './midi';
import { KEYBOARD_BASE_NOTE, KEYBOARD_TOP_NOTE } from './keyboardGeometry';

/**
 * Standard DAW "typing keyboard" layout, as a semitone offset above the mapped
 * base note: the `A..K` home row is the white keys C..C, `W E T Y U` the black.
 */
const KEY_SEMITONES: Readonly<Record<string, number>> = {
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  KeyH: 9, // A
  KeyU: 10, // A#
  KeyJ: 11, // B
  KeyK: 12, // C (next octave)
};

/** Octave-shift keys: `Z` steps the mapped octave down, `X` up. */
const OCTAVE_SHIFT_KEYS: Readonly<Record<string, number>> = { KeyZ: -1, KeyX: 1 };

/** The mapped base note at octave shift 0: Middle C (C4, MIDI 60). */
export const DEFAULT_BASE_NOTE = 60;
/** Octave-shift bounds, chosen so the mapped octave stays on the C2–B6 board. */
export const MIN_OCTAVE_SHIFT = -2;
export const MAX_OCTAVE_SHIFT = 2;

/** Clamps an octave shift into the range that keeps the mapped octave on the board. */
export function clampOctaveShift(shift: number): number {
  return Math.max(MIN_OCTAVE_SHIFT, Math.min(MAX_OCTAVE_SHIFT, shift));
}

/** The octave-shift delta a key triggers (`Z`/`X`), or null if it isn't an octave key. */
export function octaveShiftForKey(code: string): number | null {
  return code in OCTAVE_SHIFT_KEYS ? OCTAVE_SHIFT_KEYS[code] : null;
}

/**
 * The MIDI note a mapped key plays at the given octave shift, or null if the key
 * is unmapped or the resulting note falls off the C2–B6 board (e.g. the top `K`
 * at the highest octave).
 */
export function noteForKey(code: string, octaveShift: number): number | null {
  const semitone = KEY_SEMITONES[code];
  if (semitone === undefined) return null;
  const note = DEFAULT_BASE_NOTE + clampOctaveShift(octaveShift) * 12 + semitone;
  return note < KEYBOARD_BASE_NOTE || note > KEYBOARD_TOP_NOTE ? null : note;
}

/** The mapped octave's label, e.g. "C4 – C5", for the sidebar octave indicator. */
export function octaveLabel(octaveShift: number): string {
  const base = DEFAULT_BASE_NOTE + clampOctaveShift(octaveShift) * 12;
  return `${noteNumberToName(base)} – ${noteNumberToName(base + 12)}`;
}
