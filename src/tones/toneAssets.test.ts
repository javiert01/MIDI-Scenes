import { describe, expect, it } from 'vitest';
import { checkToneAssets, uncoveredNotes, type ToneAssets, type ToneRegion } from './toneAssets';

/** A CBR 128 kbps stereo MP3 header claiming `frames` frames, with no encoder delay. */
function mp3(frames: number, sizeBytes = 1000): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set([0xff, 0xfb, 0x90, 0x00]);
  const tag = 4 + 32;
  bytes.set(
    [...'Info'].map((c) => c.charCodeAt(0)),
    tag,
  );
  bytes.set([0, 0, 0, 1], tag + 4);
  new DataView(bytes.buffer).setUint32(tag + 8, frames);
  bytes.set(
    [...'LAME3.100'].map((c) => c.charCodeAt(0)),
    tag + 12,
  );
  return bytes;
}

const region = (over: Partial<ToneRegion> = {}): ToneRegion => ({
  file: 'a.mp3',
  keycentre: 60,
  keyLo: 0,
  keyHi: 127,
  velLo: 1,
  velHi: 127,
  tune: 0,
  gainDb: 0,
  pan: 0,
  loop: null,
  release: false,
  ...over,
});

const tone = (over: Partial<ToneAssets> = {}): ToneAssets => ({
  toneId: 'test',
  sources: [
    {
      name: 'Set',
      url: 'https://example.com',
      pin: { commit: 'a'.repeat(40) },
      licence: 'CC0-1.0',
      author: 'Someone',
      changes: 'none',
    },
  ],
  regions: [region()],
  ...over,
});

const oneSecond = Math.ceil(44100 / 1152);

describe('checkToneAssets', () => {
  it('passes a complete Tone and reports what it holds', () => {
    const check = checkToneAssets(tone(), () => mp3(oneSecond));
    expect(check.problems).toEqual([]);
    expect(check.heldStereoSeconds).toBeCloseTo(1, 1);
  });

  it('flags a missing file', () => {
    expect(checkToneAssets(tone(), () => undefined).problems).toContain('a.mp3 is missing');
  });

  it('flags an empty sources list and a licence off the allowlist', () => {
    const base = tone();
    const sources = [{ ...base.sources[0], licence: 'CC-BY-SA-3.0' as never }];
    expect(checkToneAssets(tone({ sources: [] }), () => mp3(1)).problems).toContain(
      'sources is empty',
    );
    expect(checkToneAssets(tone({ sources }), () => mp3(1)).problems.join()).toMatch(
      /CC-BY-SA-3.0/,
    );
  });

  it('flags notes in C2–B6 that no region sounds', () => {
    const regions = [region({ keyLo: 40, keyHi: 127 })];
    expect(checkToneAssets(tone({ regions }), () => mp3(1)).problems.join()).toMatch(
      /36, 37, 38, 39/,
    );
  });

  it('flags a loop that runs past the end of its file', () => {
    const regions = [region({ loop: { start: 0.5, end: 2 } })];
    expect(checkToneAssets(tone({ regions }), () => mp3(oneSecond)).problems.join()).toMatch(
      /loop/,
    );
  });

  it('flags a Tone over the held-seconds or size budget', () => {
    const many = Array.from({ length: 451 }, (_, i) => region({ file: `${i}.mp3` }));
    expect(checkToneAssets(tone({ regions: many }), () => mp3(oneSecond)).problems.join()).toMatch(
      /over 450 s/,
    );
    expect(checkToneAssets(tone(), () => mp3(1, 8 * 2 ** 20)).problems.join()).toMatch(
      /over 7 MiB/,
    );
  });

  it('counts each file once, however many regions share it', () => {
    const regions = [region(), region({ release: true })];
    expect(checkToneAssets(tone({ regions }), () => mp3(oneSecond)).heldStereoSeconds).toBeCloseTo(
      1,
      1,
    );
  });
});

describe('uncoveredNotes', () => {
  it('needs every velocity covered, and does not count release regions', () => {
    const regions = [
      region({ keyLo: 60, keyHi: 60, velHi: 63 }),
      region({ keyLo: 60, keyHi: 61, velLo: 64 }),
      region({ keyLo: 61, keyHi: 61, velHi: 63, release: true }),
    ];
    expect(uncoveredNotes(regions, 59, 61)).toEqual([59, 61]);
  });
});
