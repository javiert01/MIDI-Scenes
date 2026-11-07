// @vitest-environment node
// Checks the committed output of `npm run tones:build`: every Tone folder here must
// still meet the pipeline's rules, so a hand edit or a stale rebuild fails `npm test`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkToneAssets, type ToneAssets } from './toneAssets';
import { TONES } from './catalogue';
import { readMp3Info } from './mp3Info';

const TONES_DIR = path.dirname(fileURLToPath(import.meta.url));
const built = readdirSync(TONES_DIR).filter((name) =>
  existsSync(path.join(TONES_DIR, name, 'regions.json')),
);

const readAssets = (folder: string) =>
  JSON.parse(readFileSync(path.join(TONES_DIR, folder, 'regions.json'), 'utf8')) as ToneAssets;

describe('committed Tone assets', () => {
  it('include every sampled Tone: Grand Piano, Strings, Overdriven Guitar, Rock Organ and Accordion', () => {
    expect([...built].sort()).toEqual(
      ['accordion', 'grand-piano', 'overdriven-guitar', 'rock-organ', 'strings'].sort(),
    );
  });

  it('exist for every sampled Tone in the catalogue, and belong to one', () => {
    const sampled = TONES.filter((tone) => tone.kind === 'sampled');
    expect(sampled.map((tone) => tone.assets).sort()).toEqual([...built].sort());
    for (const tone of sampled) expect(readAssets(tone.assets!).toneId).toBe(tone.id);
  });

  it('are credited in the catalogue wherever a source is CC BY', () => {
    for (const tone of TONES.filter((t) => t.assets)) {
      const attributed = readAssets(tone.assets!).sources.filter((s) =>
        s.licence.startsWith('CC-BY'),
      );
      if (attributed.length > 0) expect(tone.credit, tone.id).toBeTruthy();
      for (const source of attributed) {
        // "CC-BY-3.0" is credited as "CC BY 3.0", by whom the source names.
        expect(tone.credit, tone.id).toContain(source.licence.replaceAll('-', ' '));
        expect(tone.credit, tone.id).toContain(source.author);
      }
    }
  });

  describe.each(built)('%s', (toneId) => {
    const dir = path.join(TONES_DIR, toneId);
    const assets = readAssets(toneId);

    it('is named for its folder', () => {
      expect(assets.toneId).toBe(toneId);
    });

    it('meets every pipeline rule', () => {
      const check = checkToneAssets(assets, (name) => {
        const file = path.join(dir, name);
        return existsSync(file) ? readFileSync(file) : undefined;
      });
      expect(check.problems).toEqual([]);
    });
  });

  const C2 = 36;
  const C4 = 60;
  const B6 = 95;
  const infoOf = (folder: string, file: string) =>
    readMp3Info(readFileSync(path.join(TONES_DIR, folder, file)));
  /**
   * A loop cut at the end of its file ends there, give or take the encoder: when the
   * last MP3 frame would hold 1–46 samples, libmp3lame pads it to 47, past the loop.
   */
  const expectLoopToEndTheFile = (folder: string, r: ToneAssets['regions'][number]) => {
    const info = infoOf(folder, r.file);
    const tail = (info.durationSeconds - r.loop!.end) * info.sampleRate;
    expect(tail, r.file).toBeGreaterThan(-0.5);
    expect(tail, r.file).toBeLessThan(47);
  };
  const uniqueFiles = (assets: ToneAssets) => [...new Set(assets.regions.map((r) => r.file))];
  /** Velocity ranges, as "lo–hi", of the regions sounding `note`. */
  const layersAt = (assets: ToneAssets, note: number) =>
    assets.regions
      .filter((r) => r.keyLo <= note && note <= r.keyHi)
      .map((r) => `${r.velLo}–${r.velHi}`)
      .sort();

  describe('the Strings', () => {
    const assets = readAssets('strings');

    it('credit VSCO 2 CE, CC0, its samples and SFZ mappings each pinned to a commit', () => {
      expect(assets.sources).toHaveLength(2);
      for (const source of assets.sources) {
        expect(source).toMatchObject({
          licence: 'CC0-1.0',
          url: expect.stringContaining('github.com/sgossner/VSCO-2-CE'),
          pin: { commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
        });
      }
    });

    it('play the Cello Section below C4 and the Violin Section from C4, across C2–B6', () => {
      for (const r of assets.regions) {
        if (r.file.startsWith('cello-')) expect(r.keyHi, r.file).toBeLessThan(C4);
        else if (r.file.startsWith('violin-')) expect(r.keyLo, r.file).toBeGreaterThanOrEqual(C4);
        else throw new Error(`${r.file} is from neither section`);
      }
      expect(Math.min(...assets.regions.map((r) => r.keyLo))).toBeLessThanOrEqual(C2);
      expect(Math.max(...assets.regions.map((r) => r.keyHi))).toBeGreaterThanOrEqual(B6);
    });

    it('have two dynamic layers, split at velocity 63', () => {
      for (const note of [C2 + 7, C4 - 1, C4, B6]) {
        const top = assets.regions.filter(
          (r) => r.keyLo <= note && note <= r.keyHi && r.velHi === 127,
        );
        expect(
          top.map((r) => r.velLo),
          `note ${note}`,
        ).toEqual([63]);
        expect(layersAt(assets, note).at(0), `note ${note}`).toMatch(/^1–/);
      }
    });

    it('loop over a baked 2 s crossfade: from 2.5 s in to the end of the file', () => {
      for (const r of assets.regions) {
        expect(r.loop, r.file).not.toBeNull();
        expect(r.loop!.start, r.file).toBeCloseTo(2.5, 4);
        expectLoopToEndTheFile('strings', r);
      }
    });
  });

  describe('the Overdriven Guitar', () => {
    const assets = readAssets('overdriven-guitar');
    const distorted = assets.regions.filter((r) => r.file.startsWith('distorted-'));
    const clean = assets.regions.filter((r) => r.file.startsWith('clean-'));

    it('credits FreePats FSBS Distorted #2 and Clean #1 small, CC0, pinned to commits', () => {
      expect(assets.sources.map((s) => s.name)).toEqual([
        'FreePats Electric Guitar FSBS, Distorted #2',
        'FreePats Electric Guitar FSBS, Clean #1 small',
      ]);
      for (const source of assets.sources) {
        expect(source).toMatchObject({
          licence: 'CC0-1.0',
          pin: { commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
        });
      }
    });

    it('plays Distorted #2 below C4, in its two velocity layers, and driven Clean #1 from C4', () => {
      expect(distorted.length + clean.length).toBe(assets.regions.length);
      for (const r of distorted) expect(r.keyHi, r.file).toBeLessThan(C4);
      for (const r of clean) expect(r.keyLo, r.file).toBeGreaterThanOrEqual(C4);
      expect(layersAt(assets, C4 - 1)).toEqual(['1–92', '93–127']);
      expect(layersAt(assets, C4)).toEqual(['1–127']);
    });

    it('uses one round robin: one sample per key range and layer', () => {
      expect(uniqueFiles(assets)).toHaveLength(assets.regions.length);
      const keys = assets.regions.map((r) => `${r.keyLo}/${r.velLo}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('lifts or cuts the clean side by one level-matching gain, and leaves the distorted side as recorded', () => {
      for (const r of distorted) expect(r.gainDb, r.file).toBe(0);
      const offsets = new Set(clean.map((r) => r.gainDb));
      expect(offsets.size).toBe(1);
      expect([...offsets][0]).not.toBe(0);
    });

    it('caps every tail at 8 s, keeping only the clean SFZ loops that end inside it', () => {
      for (const r of assets.regions) {
        const info = infoOf('overdriven-guitar', r.file);
        expect(info.durationSeconds, r.file).toBeLessThanOrEqual(8);
        if (r.loop) expect(r.loop.end, r.file).toBeLessThanOrEqual(info.durationSeconds);
      }
      for (const r of distorted) expect(r.loop, r.file).toBeNull();
      // B3's loop ends at 8.4 s, past the cap, so B3 fades out there instead.
      expect(clean.filter((r) => r.loop).map((r) => r.keycentre)).toEqual([64, 67, 71]);
    });
  });

  describe('the Rock Organ', () => {
    const assets = readAssets('rock-organ');

    it('credits FreePats Rock Organ Emulation, CC0, its archive pinned by SHA-256', () => {
      expect(assets.sources).toMatchObject([
        {
          name: 'FreePats Rock Organ Emulation',
          licence: 'CC0-1.0',
          pin: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        },
      ]);
    });

    it('gives each note one stereo file, centred, so a note takes one voice', () => {
      expect(uniqueFiles(assets)).toHaveLength(assets.regions.length);
      for (const r of assets.regions) {
        expect(infoOf('rock-organ', r.file).channels, r.file).toBe(2);
        expect(r).toMatchObject({ pan: 0, velLo: 1, velHi: 127, release: false });
      }
    });

    it('loops every note up to the end of its file', () => {
      for (const r of assets.regions) {
        expect(r.loop, r.file).not.toBeNull();
        expectLoopToEndTheFile('rock-organ', r);
        expect(r.loop!.end - r.loop!.start, r.file).toBeGreaterThan(0.1);
      }
    });
  });

  describe('the Grand Piano', () => {
    const assets = readAssets('grand-piano');
    const A0 = 21;
    const C8 = 108;

    it('credits Salamander Grand Piano V3, CC BY 3.0, pinned to a commit', () => {
      expect(assets.sources).toMatchObject([
        {
          name: 'Salamander Grand Piano V3',
          licence: 'CC-BY-3.0',
          author: 'Alexander Holm',
          pin: { commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
        },
      ]);
    });

    it("plays Salamander's 30 pitches, a minor third apart from A0 to C8, in three velocity layers", () => {
      const layers = [
        [1, 42],
        [43, 84],
        [85, 127],
      ];
      expect(assets.regions).toHaveLength(90);
      for (const [velLo, velHi] of layers) {
        const layer = assets.regions.filter((r) => r.velLo === velLo && r.velHi === velHi);
        expect(layer.map((r) => r.keycentre)).toEqual(
          Array.from({ length: 30 }, (_, i) => A0 + 3 * i),
        );
        // Each key range is the keycentre and its neighbours, end to end across A0–C8.
        expect(layer[0].keyLo).toBe(A0);
        expect(layer.at(-1)!.keyHi).toBe(C8);
        layer.slice(1).forEach((r, i) => expect(r.keyLo).toBe(layer[i].keyHi + 1));
      }
      for (const r of assets.regions) {
        expect(r).toMatchObject({ tune: 0, gainDb: 0, pan: 0, loop: null, release: false });
      }
    });

    it('caps every tail at 5 s', () => {
      for (const file of new Set(assets.regions.map((r) => r.file))) {
        const info = readMp3Info(readFileSync(path.join(TONES_DIR, 'grand-piano', file)));
        expect(info.durationSeconds, file).toBeLessThanOrEqual(5);
      }
    });
  });
});
