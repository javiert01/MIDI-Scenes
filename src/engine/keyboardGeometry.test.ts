import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_BASE_NOTE,
  KEYBOARD_TOTAL_WHITE_KEYS,
  keyColumnX,
  keyLabel,
  keyPosition,
  keyboardKeys,
  whiteKeyWidth,
} from '@/engine/keyboardGeometry';

const WIDTH = 900;

describe('keyboardGeometry', () => {
  it('places the base note (C2) at the left edge, column 0', () => {
    expect(keyColumnX(KEYBOARD_BASE_NOTE, WIDTH)).toBeCloseTo(0);
  });

  it('places each successive white key one white-key width to the right', () => {
    const w = whiteKeyWidth(WIDTH);
    // C2 (36) -> 0, D2 (38) -> 1 white step, E2 (40) -> 2 white steps.
    expect(keyColumnX(38, WIDTH)).toBeCloseTo(w);
    expect(keyColumnX(40, WIDTH)).toBeCloseTo(2 * w);
  });

  it('offsets a black key partway into its owning white key, not onto a white column', () => {
    const w = whiteKeyWidth(WIDTH);
    // C#2 (37) sits to the right of C2's column but left of D2's.
    const cSharp = keyColumnX(37, WIDTH);
    expect(cSharp).toBeGreaterThan(0);
    expect(cSharp).toBeLessThan(w);
  });

  it('spans exactly the 35 white keys across the full width', () => {
    const w = whiteKeyWidth(WIDTH);
    expect(w * KEYBOARD_TOTAL_WHITE_KEYS).toBeCloseTo(WIDTH);
    // The 35th white key (index 34) is B6: 36 + 4 octaves + 11 semitones = 95.
    expect(keyColumnX(95, WIDTH)).toBeCloseTo(34 * w);
  });

  it('maps distinct notes to distinct columns across an octave', () => {
    const columns = new Set<number>();
    for (let note = KEYBOARD_BASE_NOTE; note < KEYBOARD_BASE_NOTE + 12; note++) {
      columns.add(Math.round(keyColumnX(note, WIDTH) * 1000));
    }
    expect(columns.size).toBe(12);
  });

  it('keyPosition marks white keys vs black keys and gives each its own vertical rest height', () => {
    const visHeight = 600;
    const white = keyPosition(36, WIDTH, visHeight); // C2
    const black = keyPosition(37, WIDTH, visHeight); // C#2
    expect(white.isWhite).toBe(true);
    expect(black.isWhite).toBe(false);
    expect(white.y).not.toBe(black.y);
    expect(white.x).toBeCloseTo(keyColumnX(36, WIDTH));
  });

  it('keyLabel names white keys by letter, with an octave suffix only on C', () => {
    expect(keyLabel(36)).toBe('C2'); // C2, the base note
    expect(keyLabel(38)).toBe('D'); // D2
    expect(keyLabel(48)).toBe('C3'); // one octave up
    expect(keyLabel(60)).toBe('C4');
  });

  it('keyLabel returns null for black keys', () => {
    expect(keyLabel(37)).toBeNull(); // C#2
    expect(keyLabel(39)).toBeNull(); // D#2
  });

  it('keyboardKeys enumerates every note across the 5-octave board with column, white/black-ness, and label', () => {
    const keys = keyboardKeys(WIDTH);

    // 5 octaves * 12 semitones = 60 notes, from C2 (36) through B6 (95).
    expect(keys).toHaveLength(60);
    expect(keys[0]).toMatchObject({ note: 36, isWhite: true, label: 'C2' });
    expect(keys.at(-1)).toMatchObject({ note: 95, isWhite: true, label: 'B' });

    const whiteKeys = keys.filter((k) => k.isWhite);
    expect(whiteKeys).toHaveLength(KEYBOARD_TOTAL_WHITE_KEYS);

    const cKeys = keys.filter((k) => k.label?.startsWith('C') && k.label !== undefined);
    expect(cKeys.map((k) => k.label)).toEqual(['C2', 'C3', 'C4', 'C5', 'C6']);

    // Each key's x matches keyColumnX, so it aligns with its Crystal column.
    for (const key of keys) {
      expect(key.x).toBeCloseTo(keyColumnX(key.note, WIDTH));
    }
  });
});
