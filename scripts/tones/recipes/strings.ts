// Strings: VSCO 2 CE's sustained-vibrato sections, the Cello Section below C4 and the
// Violin Section from C4, each in its two dynamic layers. The samples have no loop
// points, so a 2 s equal-power crossfade loop is baked into each one.

import { readFileSync } from 'node:fs';
import { COVERED_NOTES, type ToneRegion } from '../../../src/tones/toneAssets';
import { bakeCrossfadeLoop, trimLeadingSilence, type CrossfadeLoopPlacement } from '../dsp';
import { decode, type Audio } from '../ffmpeg';
import type { Recipe } from '../recipe';
import { keyRange, parseSfz, regionFromSfz, widenToCover } from '../sfz';
import { fetchFromGitHub, type GitHubSet } from '../sources';

/** The samples live on the default branch, and their SFZ mappings on the `SFZ` branch. */
const SAMPLES: GitHubSet = {
  repo: 'sgossner/VSCO-2-CE',
  commit: '440300901dfe9275fd84e0b7763af1f8443ae62e',
};
const MAPPINGS: GitHubSet = {
  repo: 'sgossner/VSCO-2-CE',
  commit: '6dd651d55dde97fd4028699be9d4481f26917891',
};

/** C4. The cello plays below it, the violins from it. */
const SPLIT = 60;

const SECTIONS = [
  { name: 'cello', sfz: 'CelloEnsSusVib.sfz', below: true },
  { name: 'violin', sfz: 'ViolinEnsSusVib.sfz', below: false },
];

const LOOP: CrossfadeLoopPlacement = {
  crossfadeSeconds: 2,
  endBeforeEndSeconds: 0.6,
  leadSeconds: 0.5,
};

/** "susvib_E1_v1_2.wav" → "cello-E1-v1-2.mp3". No "#" in URLs. VSCO names C3 as MIDI 60. */
function shippedName(section: string, sample: string): string {
  const m = /_([A-G]#?\d)_(v\d(?:_\d)?)\.wav$/.exec(sample);
  if (!m) throw new Error(`unexpected sample name: ${sample}`);
  return `${section}-${m[1].replace('#', 's')}-${m[2].replace('_', '-')}.mp3`;
}

export const strings: Recipe = {
  toneId: 'strings',
  async build() {
    const files = new Map<string, Audio>();
    const regions: ToneRegion[] = [];

    for (const section of SECTIONS) {
      const sfz = parseSfz(readFileSync(await fetchFromGitHub(MAPPINGS, section.sfz), 'utf8'));
      for (const op of sfz) {
        if (section.below ? keyRange(op).lo >= SPLIT : keyRange(op).hi < SPLIT) continue;

        const sample = `${op.default_path}${op.sample}`.replace(/\\/g, '/');
        const file = shippedName(section.name, op.sample);
        const source = decode(await fetchFromGitHub(SAMPLES, sample));
        const trimmed = trimLeadingSilence(source.channels, source.sampleRate);
        const { channels, loop } = bakeCrossfadeLoop(trimmed.channels, source.sampleRate, LOOP);

        files.set(file, { sampleRate: source.sampleRate, channels });
        const mapped = regionFromSfz(op, {
          file,
          cut: trimmed.start,
          sampleRate: source.sampleRate,
        });
        regions.push({
          ...mapped,
          keyLo: section.below ? mapped.keyLo : Math.max(mapped.keyLo, SPLIT),
          keyHi: section.below ? Math.min(mapped.keyHi, SPLIT - 1) : mapped.keyHi,
          loop: { start: loop.start / source.sampleRate, end: loop.end / source.sampleRate },
        });
      }
    }

    return {
      sources: [
        {
          name: 'VSCO 2 Community Edition: Cello Section and Violin Section, sustained vibrato',
          url: `https://github.com/${SAMPLES.repo}`,
          pin: { commit: SAMPLES.commit },
          licence: 'CC0-1.0',
          author: 'Versilian Studios (Sam Gossner, Simon Dalzell)',
          changes: `Cello Section below C4 and Violin Section from C4, both dynamic layers. Leading silence trimmed (−48 dBFS, 1 ms kept). A ${LOOP.crossfadeSeconds} s equal-power crossfade loop baked in, ending ${LOOP.endBeforeEndSeconds} s before the sample ends (the rest is cut) and starting ${LOOP.leadSeconds} s after the crossfade does. Re-encoded as 128 kbps MP3.`,
        },
        {
          name: 'VSCO 2 Community Edition SFZ mappings',
          url: `https://github.com/${MAPPINGS.repo}/tree/SFZ`,
          pin: { commit: MAPPINGS.commit },
          licence: 'CC0-1.0',
          author: 'Versilian Studios (Sam Gossner, Simon Dalzell)',
          changes: `Key ranges, velocity layers and volumes from CelloEnsSusVib.sfz and ViolinEnsSusVib.sfz, split at C4 and widened to cover ${COVERED_NOTES.lo}–${COVERED_NOTES.hi}.`,
        },
      ],
      files,
      regions: widenToCover(regions, COVERED_NOTES.lo, COVERED_NOTES.hi),
    };
  },
};
