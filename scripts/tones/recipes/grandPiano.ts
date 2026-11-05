// Grand Piano: Salamander Grand Piano V3, three of its 16 velocity layers (v4, v12,
// v16) at all 30 pitches, a minor third apart from A0 to C8. Key ranges come from the
// set's own region map. Tails are capped at 5 s, so the Tone stays within budget.

import { readFileSync } from 'node:fs';
import type { ToneRegion } from '../../../src/tones/toneAssets';
import { capTail, trimLeadingSilence } from '../dsp';
import { decode, type Audio } from '../ffmpeg';
import type { Recipe } from '../recipe';
import { parseSfz, sfzKey } from '../sfz';
import { fetchFromGitHub, type GitHubSet } from '../sources';

const SET: GitHubSet = {
  repo: 'sfzinstruments/SalamanderGrandPiano',
  commit: '3382bf9496bba2486f5ab0de55a264d1dfc38404',
};
/** The set's 30 note regions, shared by every layer: `sample=A0$VEL.$EXT` and its keys. */
const REGION_MAP = 'Data/region.txt';

const LAYERS = [
  { name: 'v4', velLo: 1, velHi: 42 },
  { name: 'v12', velLo: 43, velHi: 84 },
  { name: 'v16', velLo: 85, velHi: 127 },
];

/** Salamander samples every minor third from A0 to C8. */
const PITCHES = 30;

const TAIL_SECONDS = 5;
const TAIL_FADE_SECONDS = 0.06;

/** "D#1" + "v4" → "Ds1-v4.mp3". No "#" in URLs. */
function shippedName(pitch: string, layer: string): string {
  return `${pitch.replace('#', 's')}-${layer}.mp3`;
}

export const grandPiano: Recipe = {
  toneId: 'grand-piano',
  async build() {
    const notes = parseSfz(readFileSync(await fetchFromGitHub(SET, REGION_MAP), 'utf8')).map(
      (op) => {
        const m = /^([A-G]#?\d)\$VEL\.\$EXT$/.exec(op.sample);
        if (!m) throw new Error(`unexpected sample in ${REGION_MAP}: ${op.sample}`);
        return {
          pitch: m[1],
          keycentre: sfzKey(op.pitch_keycenter),
          keyLo: sfzKey(op.lokey),
          keyHi: sfzKey(op.hikey),
        };
      },
    );
    if (notes.length !== PITCHES) {
      throw new Error(`expected ${PITCHES} pitches, found ${notes.length}`);
    }

    const files = new Map<string, Audio>();
    const regions: ToneRegion[] = [];
    for (const layer of LAYERS) {
      for (const note of notes) {
        const file = shippedName(note.pitch, layer.name);
        const source = decode(
          await fetchFromGitHub(SET, `Samples/${note.pitch}${layer.name}.flac`),
        );
        const { channels } = trimLeadingSilence(source.channels, source.sampleRate);
        files.set(file, {
          sampleRate: source.sampleRate,
          channels: capTail(
            channels,
            Math.round(TAIL_SECONDS * source.sampleRate),
            Math.round(TAIL_FADE_SECONDS * source.sampleRate),
          ),
        });
        regions.push({
          file,
          keycentre: note.keycentre,
          keyLo: note.keyLo,
          keyHi: note.keyHi,
          velLo: layer.velLo,
          velHi: layer.velHi,
          tune: 0,
          gainDb: 0,
          pan: 0,
          loop: null,
          release: false,
        });
      }
    }

    return {
      sources: [
        {
          name: 'Salamander Grand Piano V3',
          url: `https://github.com/${SET.repo}`,
          pin: { commit: SET.commit },
          licence: 'CC-BY-3.0',
          author: 'Alexander Holm',
          changes: `Velocity layers ${LAYERS.map((l) => l.name).join(', ')} only, at the natural tuning, without release, resonance or pedal samples. Leading silence trimmed (−48 dBFS, 1 ms kept). Tails cut at ${TAIL_SECONDS} s with a ${TAIL_FADE_SECONDS * 1000} ms linear fade-out. Re-encoded as 128 kbps MP3.`,
        },
      ],
      files,
      regions,
    };
  },
};
