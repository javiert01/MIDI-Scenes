// @vitest-environment node
// Checks the committed output of `npm run tones:build`: every Tone folder here must
// still meet the pipeline's rules, so a hand edit or a stale rebuild fails `npm test`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkToneAssets, type ToneAssets } from './toneAssets';
import { TONES } from './catalogue';

const TONES_DIR = path.dirname(fileURLToPath(import.meta.url));
const built = readdirSync(TONES_DIR).filter((name) =>
  existsSync(path.join(TONES_DIR, name, 'regions.json')),
);

const readAssets = (folder: string) =>
  JSON.parse(readFileSync(path.join(TONES_DIR, folder, 'regions.json'), 'utf8')) as ToneAssets;

describe('committed Tone assets', () => {
  it('include the Accordion', () => {
    expect(built).toContain('accordion');
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
});
