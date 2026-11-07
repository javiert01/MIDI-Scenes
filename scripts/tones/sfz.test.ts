import { describe, expect, it } from 'vitest';
import { keyRange, parseSfz, regionFromSfz, sfzKey, widenToCover } from './sfz';
import type { ToneRegion } from '../../src/tones/toneAssets';

describe('sfzKey', () => {
  it.each([
    ['60', 60],
    ['c4', 60],
    ['C4', 60],
    ['f#4', 66],
    ['eb3', 51],
    ['c-1', 0],
  ])('reads %s as MIDI %i', (value, note) => {
    expect(sfzKey(value)).toBe(note);
  });

  it('rejects anything else', () => {
    expect(() => sfzKey('h4')).toThrow();
  });
});

describe('parseSfz', () => {
  it('gives each region its group opcodes, with sample paths that hold spaces', () => {
    const regions = parseSfz(`
      // a comment
      <group> amp_veltrack=40 loop_mode=loop_continuous
      <region> sample=My Set B3.flac pitch_keycenter=47 lokey=0 hikey=49 tune=-34
       loop_start=10 loop_end=20
      <group> trigger=release volume=-8
      <region> sample=rel/My Set B3_rel.flac pitch_keycenter=47 offset=2700
    `);
    expect(regions).toEqual([
      {
        amp_veltrack: '40',
        loop_mode: 'loop_continuous',
        sample: 'My Set B3.flac',
        pitch_keycenter: '47',
        lokey: '0',
        hikey: '49',
        tune: '-34',
        loop_start: '10',
        loop_end: '20',
      },
      {
        trigger: 'release',
        volume: '-8',
        sample: 'rel/My Set B3_rel.flac',
        pitch_keycenter: '47',
        offset: '2700',
      },
    ]);
  });

  it('lets a region override its group, and inherits control and global opcodes', () => {
    const [region] = parseSfz(`
      <control> default_path=Samples/
      <global> volume=-3
      <group> tune=5
      <region> sample=a.wav tune=-5
    `);
    expect(region).toMatchObject({ default_path: 'Samples/', volume: '-3', tune: '-5' });
  });
});

describe('keyRange', () => {
  it('reads lokey and hikey', () => {
    expect(keyRange({ lokey: 'c4', hikey: '64', pitch_keycenter: '62' })).toEqual({
      lo: 60,
      hi: 64,
    });
  });

  it('reads `key` as both ends when lokey and hikey are missing', () => {
    expect(keyRange({ key: 'g5' })).toEqual({ lo: 79, hi: 79 });
  });

  it('falls back to the keycentre', () => {
    expect(keyRange({ pitch_keycenter: '48' })).toEqual({ lo: 48, hi: 48 });
  });
});

describe('regionFromSfz', () => {
  const SR = 1000;

  it('maps keys, tune, volume and pan', () => {
    const region = regionFromSfz(
      { pitch_keycenter: 'b3', lokey: '0', hikey: '49', tune: '-34', volume: '-8', pan: '-50' },
      { file: 'B3.mp3', cut: 0, sampleRate: SR },
    );
    expect(region).toEqual({
      file: 'B3.mp3',
      keycentre: 59,
      keyLo: 0,
      keyHi: 49,
      velLo: 1,
      velHi: 127,
      tune: -34,
      gainDb: -8,
      pan: -0.5,
      loop: null,
      release: false,
    });
  });

  it('reads a single key as its own range and centre', () => {
    const region = regionFromSfz({ key: '54' }, { file: 'x.mp3', cut: 0, sampleRate: SR });
    expect(region).toMatchObject({ keycentre: 54, keyLo: 54, keyHi: 54 });
  });

  it('gives loop points in seconds after the cut, with the SFZ loop end inclusive', () => {
    const region = regionFromSfz(
      { pitch_keycenter: '60', loop_start: '1500', loop_end: '2999', loop_mode: 'loop_continuous' },
      { file: 'x.mp3', cut: 500, sampleRate: SR },
    );
    expect(region.loop).toEqual({ start: 1, end: 2.5 });
  });

  it('ignores loop points on a region that does not loop', () => {
    const region = regionFromSfz(
      { pitch_keycenter: '60', loop_start: '10', loop_end: '20', loop_mode: 'one_shot' },
      { file: 'x.mp3', cut: 0, sampleRate: SR },
    );
    expect(region.loop).toBeNull();
  });

  it('rejects a cut that eats into the loop', () => {
    expect(() =>
      regionFromSfz(
        { pitch_keycenter: '60', loop_start: '10', loop_end: '20' },
        { file: 'x.mp3', cut: 11, sampleRate: SR },
      ),
    ).toThrow(/loop/);
  });

  it('marks release-triggered regions', () => {
    const region = regionFromSfz(
      { pitch_keycenter: '60', trigger: 'release' },
      { file: 'x.mp3', cut: 0, sampleRate: SR },
    );
    expect(region.release).toBe(true);
  });
});

describe('widenToCover', () => {
  const region = (keyLo: number, keyHi: number, release = false): ToneRegion => ({
    file: `${keyLo}.mp3`,
    keycentre: keyLo,
    keyLo,
    keyHi,
    velLo: 1,
    velHi: 127,
    tune: 0,
    gainDb: 0,
    pan: 0,
    loop: null,
    release,
  });

  it('stretches the lowest and highest regions, release regions included', () => {
    const out = widenToCover(
      [region(47, 49), region(47, 49, true), region(50, 78), region(79, 80)],
      36,
      95,
    );
    expect(out.map((r) => [r.keyLo, r.keyHi])).toEqual([
      [36, 49],
      [36, 49],
      [50, 78],
      [79, 95],
    ]);
  });

  it('never narrows a region that already reaches further', () => {
    const out = widenToCover([region(0, 60), region(61, 127)], 36, 95);
    expect(out.map((r) => [r.keyLo, r.keyHi])).toEqual([
      [0, 60],
      [61, 127],
    ]);
  });
});
