import { describe, expect, it } from 'vitest';
import { DEFAULT_TONE_ID, TONES, toneById, toneMenu } from '@/tones/catalogue';

describe('the Tone catalogue', () => {
  it('holds Warm Analog, synthesised, at the 0 dB reference with no Genre', () => {
    expect(toneById('warm-analog')).toMatchObject({
      id: 'warm-analog',
      name: 'Warm Analog',
      genre: null,
      kind: 'synth',
      gainDb: 0,
      releaseSeconds: 0.2,
      velocityTracking: 0,
    });
  });

  it('holds the sampled Accordion under Cumbia, at its fixed gain and envelope', () => {
    expect(toneById('accordion')).toEqual({
      id: 'accordion',
      name: 'Accordion',
      genre: 'Cumbia',
      kind: 'sampled',
      gainDb: -17,
      releaseSeconds: 0.13,
      attackSeconds: 0.03,
      velocityTracking: 0.4,
      assets: 'accordion',
    });
  });

  it('holds the synthesised Villera Lead under Cumbia, with its own velocity response and no download', () => {
    expect(toneById('villera-lead')).toEqual({
      id: 'villera-lead',
      name: 'Villera Lead',
      genre: 'Cumbia',
      kind: 'synth',
      gainDb: -3,
      releaseSeconds: 0.12,
      attackSeconds: 0.006,
      velocityTracking: 0.45,
    });
  });

  it("keeps Villera Lead's saved id whatever it is called: the name is only a label", () => {
    const villera = TONES.find((t) => t.name === 'Villera Lead');
    expect(villera?.id).toBe('villera-lead');
  });

  it('defaults to Warm Analog', () => {
    expect(DEFAULT_TONE_ID).toBe('warm-analog');
  });

  it('falls back to Warm Analog for an id it does not hold, or one that is not a string', () => {
    for (const id of ['grand-piano-v2', '', 'Accordion', undefined, null, 42]) {
      expect(toneById(id).id).toBe('warm-analog');
    }
  });

  it('gives every Tone a unique id, and every sampled Tone, and only those, an asset folder', () => {
    expect(new Set(TONES.map((t) => t.id)).size).toBe(TONES.length);
    for (const tone of TONES) expect(tone.assets !== undefined).toBe(tone.kind === 'sampled');
  });
});

describe('toneMenu', () => {
  it('lists Warm Analog first, then one group per Genre that has Tones', () => {
    expect(toneMenu()).toEqual({
      first: { id: 'warm-analog', name: 'Warm Analog' },
      groups: [
        {
          genre: 'Cumbia',
          tones: [
            { id: 'accordion', name: 'Accordion' },
            { id: 'villera-lead', name: 'Villera Lead' },
          ],
        },
      ],
    });
  });

  it('orders the groups Classical, Rock, Cumbia, keeping catalogue order within each', () => {
    const tone = (id: string, genre: 'Classical' | 'Rock' | 'Cumbia') => ({
      ...toneById('accordion'),
      id,
      name: id,
      genre,
    });
    const menu = toneMenu([
      toneById('warm-analog'),
      tone('c1', 'Cumbia'),
      tone('r1', 'Rock'),
      tone('k1', 'Classical'),
      tone('c2', 'Cumbia'),
    ]);

    expect(menu.groups.map((g) => [g.genre, g.tones.map((t) => t.id)])).toEqual([
      ['Classical', ['k1']],
      ['Rock', ['r1']],
      ['Cumbia', ['c1', 'c2']],
    ]);
  });
});
