// @vitest-environment node
// Checks the committed output of `npm run tones:build`: every Tone folder here must
// still meet the pipeline's rules, so a hand edit or a stale rebuild fails `npm test`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkToneAssets, type ToneAssets } from './toneAssets';

const TONES_DIR = path.dirname(fileURLToPath(import.meta.url));
const built = readdirSync(TONES_DIR).filter((name) =>
  existsSync(path.join(TONES_DIR, name, 'regions.json')),
);

describe('committed Tone assets', () => {
  it('include the Accordion', () => {
    expect(built).toContain('accordion');
  });

  describe.each(built)('%s', (toneId) => {
    const dir = path.join(TONES_DIR, toneId);
    const assets = JSON.parse(readFileSync(path.join(dir, 'regions.json'), 'utf8')) as ToneAssets;

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
