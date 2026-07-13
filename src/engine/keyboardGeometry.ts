/**
 * Piano-key note→position model, ported from the original piano.js/key.js.
 * Shared by the engine's Crystals (which need each note's column) and, later,
 * the Piano Preview (which draws each key). Base note is C2 (MIDI 36) and the
 * board spans 35 white keys across the full canvas width.
 */

/** The lowest note the keyboard models: C2. Notes below it wrap to negative octaves. */
export const KEYBOARD_BASE_NOTE = 36;
/** How many white keys tile the full canvas width. */
export const KEYBOARD_TOTAL_WHITE_KEYS = 35;

const WHITE_KEYS_PER_OCTAVE = 7;
const BLACK_KEY_X_OFFSET_RATIO = 2 / 3;
const WHITE_KEY_Y_RATIO = 0.15;
const BLACK_KEY_Y_RATIO = 0.09375;
/** How many octaves the 35 white keys span (35 / 7). */
const KEYBOARD_OCTAVES = KEYBOARD_TOTAL_WHITE_KEYS / WHITE_KEYS_PER_OCTAVE;

interface KeyLayoutEntry {
  isWhite: boolean;
  whiteIndex: number;
}

/** White-key letter per semitone (C..B), matching OCTAVE_KEY_LAYOUT's order; null marks a black key. */
const NOTE_LETTERS: readonly (string | null)[] = [
  'C',
  null,
  'D',
  null,
  'E',
  'F',
  null,
  'G',
  null,
  'A',
  null,
  'B',
];

/** One chromatic octave (C..B), matching the original Piano's white/black key skip pattern. */
const OCTAVE_KEY_LAYOUT: KeyLayoutEntry[] = [
  { isWhite: true, whiteIndex: 0 }, // C
  { isWhite: false, whiteIndex: 0 }, // C#
  { isWhite: true, whiteIndex: 1 }, // D
  { isWhite: false, whiteIndex: 1 }, // D#
  { isWhite: true, whiteIndex: 2 }, // E
  { isWhite: true, whiteIndex: 3 }, // F
  { isWhite: false, whiteIndex: 3 }, // F#
  { isWhite: true, whiteIndex: 4 }, // G
  { isWhite: false, whiteIndex: 4 }, // G#
  { isWhite: true, whiteIndex: 5 }, // A
  { isWhite: false, whiteIndex: 5 }, // A#
  { isWhite: true, whiteIndex: 6 }, // B
];

export interface KeyPosition {
  x: number;
  y: number;
  isWhite: boolean;
}

/** The width of a single white key when 35 of them tile `width`. */
export function whiteKeyWidth(width: number): number {
  return width / KEYBOARD_TOTAL_WHITE_KEYS;
}

/** Splits a note into its octave (relative to C2), semitone, and layout entry within that octave. */
function decompose(note: number): { octaveIndex: number; semitone: number; layout: KeyLayoutEntry } {
  const offset = note - KEYBOARD_BASE_NOTE;
  const octaveIndex = Math.floor(offset / 12);
  const semitone = ((offset % 12) + 12) % 12;
  return { octaveIndex, semitone, layout: OCTAVE_KEY_LAYOUT[semitone] };
}

/** The x of a note's key column within a canvas of `width` — what a Crystal spawns at. */
export function keyColumnX(note: number, width: number): number {
  const { octaveIndex, layout } = decompose(note);
  const keyWidth = whiteKeyWidth(width);
  const octaveOriginX = octaveIndex * keyWidth * WHITE_KEYS_PER_OCTAVE;
  const whiteX = octaveOriginX + layout.whiteIndex * keyWidth;
  return layout.isWhite ? whiteX : whiteX + BLACK_KEY_X_OFFSET_RATIO * keyWidth;
}

/**
 * The full piano-key position for a note: its column x, a rest-height y (white
 * and black keys sit at different heights), and whether it is a white key.
 */
export function keyPosition(note: number, width: number, visHeight: number): KeyPosition {
  const { isWhite } = decompose(note).layout;
  return {
    x: keyColumnX(note, width),
    y: visHeight * (isWhite ? WHITE_KEY_Y_RATIO : BLACK_KEY_Y_RATIO),
    isWhite,
  };
}

/**
 * A white key's note letter (e.g. "D"), with its octave suffixed only on C
 * (e.g. "C3") so the Piano Preview can label octave boundaries. Black keys
 * are unlabelled, returning null.
 */
export function keyLabel(note: number): string | null {
  const { octaveIndex, semitone } = decompose(note);
  const letter = NOTE_LETTERS[semitone];
  if (letter === null) return null;
  return letter === 'C' ? `${letter}${octaveIndex + 2}` : letter;
}

export interface KeyboardKey {
  note: number;
  /** The key's column x — identical to keyColumnX, so it aligns with its Crystal. */
  x: number;
  isWhite: boolean;
  /** Note letter for white keys (with octave on each C); null for black keys. */
  label: string | null;
}

/**
 * Every note the keyboard models — 5 octaves from C2 through B6, one entry
 * per semitone — with each key's column, white/black-ness, and label. Backs
 * the Piano Preview Overlay.
 */
export function keyboardKeys(width: number): KeyboardKey[] {
  const totalNotes = KEYBOARD_OCTAVES * 12;
  const keys: KeyboardKey[] = [];
  for (let i = 0; i < totalNotes; i++) {
    const note = KEYBOARD_BASE_NOTE + i;
    const { layout } = decompose(note);
    keys.push({ note, x: keyColumnX(note, width), isWhite: layout.isWhite, label: keyLabel(note) });
  }
  return keys;
}
