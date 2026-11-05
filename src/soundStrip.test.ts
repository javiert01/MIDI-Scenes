import { describe, expect, it } from 'vitest';
import { describeSoundStrip, gatesForSoundMode, sizeLabelMb, type SoundState } from '@/soundStrip';

function state(overrides: Partial<SoundState> = {}): SoundState {
  return {
    soundEnabled: true,
    deviceSoundEnabled: false,
    audioSuspended: false,
    outputLatencyMs: null,
    toneId: 'warm-analog',
    toneStatus: 'ready',
    toneProgress: null,
    downloadedToneIds: [],
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

  it('lists Warm Analog first, then each Genre as a group, sized from the committed files', () => {
    expect(describeSoundStrip(state()).tonePicker?.menu).toEqual({
      first: { id: 'warm-analog', label: 'Warm Analog' },
      groups: [
        { genre: 'Classical', tones: [{ id: 'grand-piano', label: 'Grand Piano (7 MB)' }] },
        { genre: 'Cumbia', tones: [{ id: 'accordion', label: 'Accordion (1 MB)' }] },
      ],
    });
  });

  const label = (strip: ReturnType<typeof describeSoundStrip>, id: string) =>
    strip.tonePicker?.menu.groups.flatMap((g) => g.tones).find((t) => t.id === id)?.label;

  it("labels a Tone not yet downloaded with its download's size, from its committed files", () => {
    const strip = describeSoundStrip(state(), { accordion: 3.4 * 2 ** 20 });

    expect(label(strip, 'accordion')).toBe('Accordion (3 MB)');
  });

  it('drops the size once the Tone has downloaded, and never gives Warm Analog one', () => {
    const strip = describeSoundStrip(state({ downloadedToneIds: ['accordion'] }));

    expect(strip.tonePicker?.menu.first.label).toBe('Warm Analog');
    expect(label(strip, 'accordion')).toBe('Accordion');
  });
});

describe('the credit line', () => {
  it('credits Salamander while the Grand Piano is selected, linking CC BY 3.0 to its licence', () => {
    const strip = describeSoundStrip(state({ toneId: 'grand-piano' }));

    expect(strip.credit).toEqual({
      before: 'Salamander Grand Piano by Alexander Holm, ',
      licence: { label: 'CC BY 3.0', href: 'https://creativecommons.org/licenses/by/3.0/' },
      after: ', trimmed and re-encoded.',
    });
  });

  it('stays while the Grand Piano downloads, or after it failed', () => {
    for (const toneStatus of ['loading', 'failed'] as const) {
      expect(
        describeSoundStrip(state({ toneId: 'grand-piano', toneStatus })).credit,
      ).not.toBeNull();
    }
  });

  it('shows nothing for a Tone whose sources ask for no credit, or while sound is Off', () => {
    expect(describeSoundStrip(state()).credit).toBeNull();
    expect(describeSoundStrip(state({ toneId: 'accordion' })).credit).toBeNull();
    expect(
      describeSoundStrip(state({ soundEnabled: false, toneId: 'grand-piano' })).credit,
    ).toBeNull();
  });
});

describe('sizeLabelMb', () => {
  it('rounds to whole MB', () => {
    expect(sizeLabelMb(7.3 * 2 ** 20)).toBe('7 MB');
    expect(sizeLabelMb(6.5 * 2 ** 20)).toBe('7 MB');
    expect(sizeLabelMb(2.49 * 2 ** 20)).toBe('2 MB');
  });

  it('never says less than 1 MB', () => {
    expect(sizeLabelMb(0.2 * 2 ** 20)).toBe('1 MB');
    expect(sizeLabelMb(1)).toBe('1 MB');
  });
});

describe('the download line', () => {
  const loading = (filesDone: number, filesTotal: number) =>
    state({
      toneId: 'accordion',
      toneStatus: 'loading',
      toneProgress: { filesDone, filesTotal },
    });

  it('shows files done out of the total while a Tone downloads, with Warm Analog standing in', () => {
    const strip = describeSoundStrip(loading(12, 34));

    expect(strip.download).toEqual({
      kind: 'progress',
      fraction: 12 / 34,
      text: "Downloading Accordion: 12 of 34 files · Warm Analog plays until it's ready",
    });
  });

  it('starts at nothing done before the first file is in', () => {
    expect(describeSoundStrip(loading(0, 34)).download).toMatchObject({
      fraction: 0,
      text: "Downloading Accordion: 0 of 34 files · Warm Analog plays until it's ready",
    });
    expect(
      describeSoundStrip(state({ toneId: 'accordion', toneStatus: 'loading' })).download,
    ).toEqual({
      kind: 'progress',
      fraction: 0,
      text: "Downloading Accordion… · Warm Analog plays until it's ready",
    });
  });

  it('says Preparing once every file is in and the Tone decodes, with the bar full', () => {
    expect(describeSoundStrip(loading(34, 34)).download).toEqual({
      kind: 'progress',
      fraction: 1,
      text: "Preparing Accordion… · Warm Analog plays until it's ready",
    });
  });

  it('offers Retry when the download failed', () => {
    const strip = describeSoundStrip(state({ toneId: 'accordion', toneStatus: 'failed' }));

    expect(strip.download).toEqual({
      kind: 'failed',
      text: "Couldn't download Accordion. Warm Analog is playing.",
    });
  });

  it('shows nothing once the Tone is ready, or while sound is Off', () => {
    expect(describeSoundStrip(state({ toneId: 'accordion' })).download).toBeNull();
    expect(
      describeSoundStrip(state({ toneId: 'accordion', toneStatus: 'idle' })).download,
    ).toBeNull();
    expect(
      describeSoundStrip(state({ soundEnabled: false, toneId: 'accordion', toneStatus: 'failed' }))
        .download,
    ).toBeNull();
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
