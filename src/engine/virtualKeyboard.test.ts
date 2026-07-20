import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_NOTE,
  MAX_OCTAVE_SHIFT,
  MIN_OCTAVE_SHIFT,
  clampOctaveShift,
  noteForKey,
  octaveLabel,
  octaveShiftForKey,
} from '@/engine/virtualKeyboard';
import { KEYBOARD_BASE_NOTE, KEYBOARD_TOP_NOTE } from '@/engine/keyboardGeometry';

describe('noteForKey', () => {
  it('maps the home row A..K to a full ascending octave from the base note', () => {
    const expected: Array<[string, number]> = [
      ['KeyA', 0],
      ['KeyS', 2],
      ['KeyD', 4],
      ['KeyF', 5],
      ['KeyG', 7],
      ['KeyH', 9],
      ['KeyJ', 11],
      ['KeyK', 12],
    ];
    for (const [code, offset] of expected) {
      expect(noteForKey(code, 0)).toBe(DEFAULT_BASE_NOTE + offset);
    }
  });

  it('maps the upper row W E T Y U to the black keys', () => {
    expect(noteForKey('KeyW', 0)).toBe(DEFAULT_BASE_NOTE + 1); // C#
    expect(noteForKey('KeyE', 0)).toBe(DEFAULT_BASE_NOTE + 3); // D#
    expect(noteForKey('KeyT', 0)).toBe(DEFAULT_BASE_NOTE + 6); // F#
    expect(noteForKey('KeyY', 0)).toBe(DEFAULT_BASE_NOTE + 8); // G#
    expect(noteForKey('KeyU', 0)).toBe(DEFAULT_BASE_NOTE + 10); // A#
  });

  it('returns null for an unmapped key', () => {
    expect(noteForKey('KeyP', 0)).toBeNull();
    expect(noteForKey('Space', 0)).toBeNull();
  });

  it('shifts every mapped note by an octave per shift step', () => {
    expect(noteForKey('KeyA', 1)).toBe(DEFAULT_BASE_NOTE + 12);
    expect(noteForKey('KeyA', -1)).toBe(DEFAULT_BASE_NOTE - 12);
  });

  it('stays within the C2–B6 board at the octave extremes', () => {
    expect(noteForKey('KeyA', MIN_OCTAVE_SHIFT)).toBe(KEYBOARD_BASE_NOTE); // C2
    // At the top octave the base octave's C is on-board, but the topmost K (a
    // semitone past B6) falls off and returns null.
    expect(noteForKey('KeyA', MAX_OCTAVE_SHIFT)).toBeLessThanOrEqual(KEYBOARD_TOP_NOTE);
    expect(noteForKey('KeyK', MAX_OCTAVE_SHIFT)).toBeNull();
  });

  it('clamps out-of-range octave shifts rather than leaving the board', () => {
    expect(noteForKey('KeyA', -99)).toBe(KEYBOARD_BASE_NOTE);
    expect(noteForKey('KeyA', 99)).toBe(noteForKey('KeyA', MAX_OCTAVE_SHIFT));
  });
});

describe('octaveShiftForKey', () => {
  it('reads Z as down and X as up, and null for anything else', () => {
    expect(octaveShiftForKey('KeyZ')).toBe(-1);
    expect(octaveShiftForKey('KeyX')).toBe(1);
    expect(octaveShiftForKey('KeyA')).toBeNull();
  });
});

describe('clampOctaveShift', () => {
  it('clamps to the octave-shift bounds', () => {
    expect(clampOctaveShift(-99)).toBe(MIN_OCTAVE_SHIFT);
    expect(clampOctaveShift(99)).toBe(MAX_OCTAVE_SHIFT);
    expect(clampOctaveShift(0)).toBe(0);
  });
});

describe('octaveLabel', () => {
  it('labels the mapped octave span from the base note', () => {
    expect(octaveLabel(0)).toBe('C4 – C5');
    expect(octaveLabel(-1)).toBe('C3 – C4');
    expect(octaveLabel(1)).toBe('C5 – C6');
  });
});
