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
  it('include the Accordion and the Grand Piano', () => {
    expect(built).toContain('accordion');
    expect(built).toContain('grand-piano');
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
