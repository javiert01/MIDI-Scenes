import { describe, expect, it } from 'vitest';
import { noteNumberToName, parseMidiMessage } from '@/engine/midi';

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

describe('parseMidiMessage', () => {
  it('parses a note-on byte array into a noteon NoteEvent', () => {
    const result = parseMidiMessage([0x90, 60, 100]);

    expect(result).toEqual({
      type: 'noteon',
      event: { note: 60, name: 'C4', velocity: 100 / 127, raw: 100, channel: 1 },
    });
  });

  it('normalizes velocity to 0..1 while keeping raw 0..127', () => {
    const result = parseMidiMessage([0x90, 60, 127]);

    expect(result).toMatchObject({ event: { velocity: 1, raw: 127 } });
  });

  it('treats note-on with velocity 0 as note-off with velocity 0', () => {
    const result = parseMidiMessage([0x90, 60, 0]);

    expect(result).toEqual({
      type: 'noteoff',
      event: { note: 60, name: 'C4', velocity: 0, raw: 0, channel: 1 },
    });
  });

  it('parses an explicit note-off byte array', () => {
    const result = parseMidiMessage([0x80, 60, 64]);

    expect(result).toEqual({
      type: 'noteoff',
      event: { note: 60, name: 'C4', velocity: 0, raw: 0, channel: 1 },
    });
  });

  it('derives the 1-based channel from the status byte low nibble', () => {
    const result = parseMidiMessage([0x91, 60, 100]);

    expect(result).toMatchObject({ event: { channel: 2 } });
  });

  describe('the sustain pedal (CC64)', () => {
    it('reads 64 and above as down', () => {
      expect(parseMidiMessage([0xb0, 64, 64])).toEqual({ type: 'sustain', down: true });
      expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'sustain', down: true });
    });

    it('reads below 64 as up, ignoring half-pedalling', () => {
      expect(parseMidiMessage([0xb0, 64, 63])).toEqual({ type: 'sustain', down: false });
      expect(parseMidiMessage([0xb0, 64, 30])).toEqual({ type: 'sustain', down: false });
      expect(parseMidiMessage([0xb0, 64, 0])).toEqual({ type: 'sustain', down: false });
    });

    it('ignores the channel', () => {
      expect(parseMidiMessage([0xbf, 64, 127])).toEqual({ type: 'sustain', down: true });
    });

    it('ignores every other control change, the mod wheel and RPN 0 (bend range) included', () => {
      expect(parseMidiMessage([0xb0, 1, 127])).toBeNull(); // mod wheel
      expect(parseMidiMessage([0xb0, 101, 0])).toBeNull(); // RPN MSB
      expect(parseMidiMessage([0xb0, 100, 0])).toBeNull(); // RPN LSB
      expect(parseMidiMessage([0xb0, 6, 12])).toBeNull(); // data entry: a 12-semitone range
    });
  });

  describe('pitch bend', () => {
    it('reads the 14-bit centre (8192) as 0', () => {
      expect(parseMidiMessage([0xe0, 0x00, 0x40])).toEqual({ type: 'pitchbend', amount: 0 });
    });

    it('maps the full 14-bit range onto -1..1', () => {
      expect(parseMidiMessage([0xe0, 0x00, 0x00])).toEqual({ type: 'pitchbend', amount: -1 });
      expect(parseMidiMessage([0xe0, 0x7f, 0x7f])).toEqual({ type: 'pitchbend', amount: 1 });
    });

    it('combines the LSB and MSB data bytes', () => {
      // 0x20 << 7 | 0x00 = 4096: halfway down.
      expect(parseMidiMessage([0xe0, 0x00, 0x20])).toEqual({ type: 'pitchbend', amount: -0.5 });
      // 0x40 << 7 | 0x01 = 8193: just above centre.
      const nudge = parseMidiMessage([0xe0, 0x01, 0x40]);
      expect(nudge?.type === 'pitchbend' && nudge.amount).toBeCloseTo(1 / 8191, 9);
    });

    it('ignores the channel', () => {
      expect(parseMidiMessage([0xe9, 0x7f, 0x7f])).toEqual({ type: 'pitchbend', amount: 1 });
    });
  });

  it('ignores other messages, such as aftertouch and program change', () => {
    expect(parseMidiMessage([0xd0, 100])).toBeNull();
    expect(parseMidiMessage([0xa0, 60, 100])).toBeNull();
    expect(parseMidiMessage([0xc0, 5, 0])).toBeNull();
  });

  it('ignores malformed short messages', () => {
    expect(parseMidiMessage([0x90, 60])).toBeNull();
  });
});
