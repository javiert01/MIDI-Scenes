// Accordion: FreePats Button Accordion HN, one layer of 17 pitches with release
// samples. Its SFZ loop points, per-note `tune` and release samples are kept.

import { readFileSync } from 'node:fs';
import { COVERED_NOTES } from '../../../src/tones/toneAssets';
import { cropStart, fadeIn, trimLeadingSilence } from '../dsp';
import { decode, type Audio } from '../ffmpeg';
import type { Recipe } from '../recipe';
import { parseSfz, regionFromSfz, widenToCover } from '../sfz';
import { fetchFromGitHub, type GitHubSet } from '../sources';

const SET: GitHubSet = {
  repo: 'freepats/button-accordion-HN',
  commit: 'd70d16456fd99305d1c24c612b205ab38846eb0f',
};
const SFZ = 'PRESET Button Accordion HN tuned.sfz';

/** "rel/Button Accordion HN F#4_rel.flac" → "Fs4-release.mp3". No "#" or spaces in URLs. */
function shippedName(sample: string): string {
  const m = /Button Accordion HN ([A-G]#?\d)(_rel)?\.flac$/.exec(sample);
  if (!m) throw new Error(`unexpected sample name: ${sample}`);
  return `${m[1].replace('#', 's')}${m[2] ? '-release' : ''}.mp3`;
}

export const accordion: Recipe = {
  toneId: 'accordion',
  async build() {
    const sfz = parseSfz(readFileSync(await fetchFromGitHub(SET, SFZ), 'utf8'));
    const files = new Map<string, Audio>();
    const regions = [];

    for (const op of sfz) {
      const sample = op.sample.replace(/\\/g, '/');
      const file = shippedName(sample);
      const source = decode(await fetchFromGitHub(SET, sample));
      const release = op.trigger === 'release';

      // A release sample's `offset` skips into it, and its group's 30 ms attack hides
      // the cut, so both are baked in. The sustain group's offsets are random or
      // velocity-driven, which regions.json can't express, so they are dropped.
      const offset = release ? Number(op.offset ?? 0) : 0;
      const trimmed = trimLeadingSilence(cropStart(source.channels, offset), source.sampleRate);
      let channels = trimmed.channels;
      if (release && op.ampeg_attack !== undefined) {
        channels = fadeIn(channels, Math.round(Number(op.ampeg_attack) * source.sampleRate));
      }

      files.set(file, { sampleRate: source.sampleRate, channels });
      regions.push(
        regionFromSfz(op, { file, cut: offset + trimmed.start, sampleRate: source.sampleRate }),
      );
    }

    return {
      sources: [
        {
          name: 'FreePats Button Accordion HN',
          url: `https://github.com/${SET.repo}`,
          pin: { commit: SET.commit },
          licence: 'CC0-1.0',
          author: 'Jeff Stauffer (recording), michael02022 (sound bank), FreePats',
          changes:
            'Leading silence trimmed (−48 dBFS, 1 ms kept). Release samples start at their SFZ offset with a 30 ms linear fade-in. Random and velocity-driven start offsets on the sustain samples are dropped. Re-encoded as 128 kbps MP3, loop points moved to match.',
        },
      ],
      files,
      regions: widenToCover(regions, COVERED_NOTES.lo, COVERED_NOTES.hi),
    };
  },
};
