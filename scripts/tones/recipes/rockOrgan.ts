// Rock Organ: FreePats Rock Organ Emulation, rendered from setBfree, one layer of 16
// pitches with its SFZ loop points. The set keeps each note's left and right in two
// mono files, hard-panned; here they become one stereo file, so a note takes one voice.

import { readFileSync } from 'node:fs';
import { COVERED_NOTES, type ToneRegion } from '../../../src/tones/toneAssets';
import { equalPowerLoopCrossfade, mergeToStereo, trimLeadingSilence } from '../dsp';
import { decode, type Audio } from '../ffmpeg';
import type { Recipe } from '../recipe';
import { parseSfz, regionFromSfz, widenToCover, type SfzOpcodes } from '../sfz';
import { fetchFromArchive, type ArchiveSet } from '../sources';

const SET: ArchiveSet = {
  url: 'https://freepats.zenvoid.org/Organ/RockOrganEmulation/RockOrganEmulation-SFZ-20190715.tar.xz',
  sha256: '07321d9498dc31982c44ea9483919df3f426e3d392a15bb2947b0e3fe247f718',
};
const ROOT = 'RockOrganEmulation-SFZ-20190715';
const SFZ = `${ROOT}/RockOrganEmulation-20190715.sfz`;

/** The two sides loop from different starts, so the merged loop's seam is crossfaded. */
const SEAM_CROSSFADE_SECONDS = 0.1;

/** "samples/G#4L.wav" → { note: "G#4", side: "L" }. */
function sideOf(sample: string): { note: string; side: 'L' | 'R' } {
  const m = /([A-G]#?\d)([LR])\.wav$/.exec(sample);
  if (!m) throw new Error(`unexpected sample name: ${sample}`);
  return { note: m[1], side: m[2] as 'L' | 'R' };
}

export const rockOrgan: Recipe = {
  toneId: 'rock-organ',
  async build() {
    const sfz = parseSfz(readFileSync(await fetchFromArchive(SET, SFZ), 'utf8'));
    const pairs = new Map<string, { L?: SfzOpcodes; R?: SfzOpcodes }>();
    for (const op of sfz) {
      const { note, side } = sideOf(op.sample);
      pairs.set(note, { ...pairs.get(note), [side]: op });
    }

    const files = new Map<string, Audio>();
    const regions: ToneRegion[] = [];
    for (const [note, { L, R }] of pairs) {
      if (!L || !R) throw new Error(`${note} needs both a left and a right sample`);
      const left = decode(await fetchFromArchive(SET, `${ROOT}/${L.sample}`));
      const right = decode(await fetchFromArchive(SET, `${ROOT}/${R.sample}`));
      if (left.sampleRate !== right.sampleRate) throw new Error(`${note}: sides differ in rate`);
      const sampleRate = left.sampleRate;

      // The later start, so the loop holds only audio both sides loop over. SFZ's
      // loop_end is the loop's last frame; `end` here is exclusive.
      const points = [L.loop_start, R.loop_start, L.loop_end, R.loop_end].map(Number);
      if (!points.every(Number.isInteger)) throw new Error(`${note}: both sides need loop points`);
      const start = Math.max(points[0], points[1]);
      const end = Math.min(points[2], points[3]) + 1;
      const looped = equalPowerLoopCrossfade(
        mergeToStereo(left.channels, right.channels),
        start,
        end,
        Math.round(SEAM_CROSSFADE_SECONDS * sampleRate),
      ).map((c) => c.slice(0, end));
      const trimmed = trimLeadingSilence(looped, sampleRate);

      const file = `${note.replace('#', 's')}.mp3`;
      files.set(file, { sampleRate, channels: trimmed.channels });
      regions.push({
        ...regionFromSfz(
          { ...L, loop_start: String(start), loop_end: String(end - 1) },
          { file, cut: trimmed.start, sampleRate },
        ),
        pan: 0,
      });
    }

    return {
      sources: [
        {
          name: 'FreePats Rock Organ Emulation',
          // The archive itself, so the SHA-256 below says which bytes it covers.
          url: SET.url,
          pin: { sha256: SET.sha256 },
          licence: 'CC0-1.0',
          author: 'Strix SoundFont Team (samples, rendered from setBfree), FreePats',
          changes: `Each note's left and right samples merged into one stereo file, looping from the later of their two loop starts to the earlier end, with a ${SEAM_CROSSFADE_SECONDS * 1000} ms equal-power crossfade baked in at the seam and the audio after the loop cut. Leading silence trimmed (−48 dBFS, 1 ms kept). Re-encoded as 128 kbps MP3, loop points moved to match.`,
        },
      ],
      files,
      regions: widenToCover(regions, COVERED_NOTES.lo, COVERED_NOTES.hi),
    };
  },
};
