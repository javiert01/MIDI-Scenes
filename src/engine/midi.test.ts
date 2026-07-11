import { describe, expect, it } from 'vitest';
import { noteNumberToName, parseNoteMessage } from '@/engine/midi';

describe('noteNumberToName', () => {
  it('maps MIDI note 60 to middle C (C4)', () => {
    expect(noteNumberToName(60)).toBe('C4');
  });

  it('maps note 21 to A0 (lowest piano key)', () => {
    expect(noteNumberToName(21)).toBe('A0');
  });

  it('maps note 61 to a sharp', () => {
    expect(noteNumberToName(61)).toBe('C#4');
  });
});

describe('parseNoteMessage', () => {
  it('parses a note-on byte array into a noteon NoteEvent', () => {
    const result = parseNoteMessage([0x90, 60, 100]);

    expect(result).toEqual({
      type: 'noteon',
      event: { note: 60, name: 'C4', velocity: 100 / 127, raw: 100, channel: 1 },
    });
  });

  it('normalizes velocity to 0..1 while keeping raw 0..127', () => {
    const result = parseNoteMessage([0x90, 60, 127]);

    expect(result?.event.velocity).toBe(1);
    expect(result?.event.raw).toBe(127);
  });

  it('treats note-on with velocity 0 as note-off with velocity 0', () => {
    const result = parseNoteMessage([0x90, 60, 0]);

    expect(result).toEqual({
      type: 'noteoff',
      event: { note: 60, name: 'C4', velocity: 0, raw: 0, channel: 1 },
    });
  });

  it('parses an explicit note-off byte array', () => {
    const result = parseNoteMessage([0x80, 60, 64]);

    expect(result).toEqual({
      type: 'noteoff',
      event: { note: 60, name: 'C4', velocity: 0, raw: 0, channel: 1 },
    });
  });

  it('derives the 1-based channel from the status byte low nibble', () => {
    const result = parseNoteMessage([0x91, 60, 100]);

    expect(result?.event.channel).toBe(2);
  });

  it('ignores control-change messages', () => {
    expect(parseNoteMessage([0xb0, 64, 127])).toBeNull();
  });

  it('ignores pitch-bend messages', () => {
    expect(parseNoteMessage([0xe0, 0, 64])).toBeNull();
  });

  it('ignores malformed short messages', () => {
    expect(parseNoteMessage([0x90, 60])).toBeNull();
  });
});
