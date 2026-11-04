import { describe, expect, it } from 'vitest';
import { describeSoundStrip, gatesForSoundMode, type SoundState } from '@/soundStrip';

function state(overrides: Partial<SoundState> = {}): SoundState {
  return {
    soundEnabled: true,
    deviceSoundEnabled: false,
    audioSuspended: false,
    outputLatencyMs: null,
    toneId: 'warm-analog',
    ...overrides,
  };
}

describe('describeSoundStrip', () => {
  it('selects Off when both gates are off', () => {
    expect(describeSoundStrip(state({ soundEnabled: false })).mode).toBe('off');
  });

  it('selects Computer when only Virtual Input sound is on, the first-load default', () => {
    expect(describeSoundStrip(state()).mode).toBe('computer');
  });

  it('selects All notes when both gates are on', () => {
    expect(describeSoundStrip(state({ deviceSoundEnabled: true })).mode).toBe('all');
  });

  it('shows All notes for Device sound on with Virtual Input sound off, so a sounding Device is never hidden', () => {
    const strip = describeSoundStrip(state({ soundEnabled: false, deviceSoundEnabled: true }));

    expect(strip.mode).toBe('all');
  });

  it('asks for a click in the Device card while Device sound waits on suspended audio', () => {
    const strip = describeSoundStrip(state({ deviceSoundEnabled: true, audioSuspended: true }));

    expect(strip.deviceHint).toBe('Click anywhere to turn sound on');
  });

  it('asks for nothing once audio runs, where there is no audio to resume, or when the Device is not meant to sound', () => {
    expect(describeSoundStrip(state({ deviceSoundEnabled: true })).deviceHint).toBeNull();
    expect(describeSoundStrip(state({ audioSuspended: true })).deviceHint).toBeNull();
  });

  it('warns about output latency over about 60 ms, rounded to whole milliseconds', () => {
    const strip = describeSoundStrip(state({ outputLatencyMs: 84.6 }));

    expect(strip.latencyHint).toBe(
      'Sound may lag about 85 ms behind your keys. Wired headphones or speakers help.',
    );
  });

  it('keeps quiet about latency at or under 60 ms, where it is not reported, and when sound is Off', () => {
    expect(describeSoundStrip(state({ outputLatencyMs: 60 })).latencyHint).toBeNull();
    expect(describeSoundStrip(state({ outputLatencyMs: null })).latencyHint).toBeNull();
    expect(
      describeSoundStrip(state({ soundEnabled: false, outputLatencyMs: 120 })).latencyHint,
    ).toBeNull();
  });
});

describe('the Tone dropdown', () => {
  it('shows whenever sound is not Off, on the selected Tone', () => {
    expect(describeSoundStrip(state()).tonePicker?.selected).toBe('warm-analog');
    expect(
      describeSoundStrip(state({ deviceSoundEnabled: true, toneId: 'accordion' })).tonePicker
        ?.selected,
    ).toBe('accordion');
  });

  it('hides while sound is Off', () => {
    expect(describeSoundStrip(state({ soundEnabled: false })).tonePicker).toBeNull();
  });

  it('lists Warm Analog first, then each Genre as a group: only Cumbia, with the Accordion, for now', () => {
    expect(describeSoundStrip(state()).tonePicker?.menu).toEqual({
      first: { id: 'warm-analog', name: 'Warm Analog' },
      groups: [{ genre: 'Cumbia', tones: [{ id: 'accordion', name: 'Accordion' }] }],
    });
  });
});

describe('gatesForSoundMode', () => {
  it('maps each segment onto the two stored gates', () => {
    expect(gatesForSoundMode('off')).toEqual({ soundEnabled: false, deviceSoundEnabled: false });
    expect(gatesForSoundMode('computer')).toEqual({
      soundEnabled: true,
      deviceSoundEnabled: false,
    });
    expect(gatesForSoundMode('all')).toEqual({ soundEnabled: true, deviceSoundEnabled: true });
  });

  it('round-trips: the gates a segment sets select that same segment', () => {
    for (const mode of ['off', 'computer', 'all'] as const) {
      expect(describeSoundStrip(state(gatesForSoundMode(mode))).mode).toBe(mode);
    }
  });
});
