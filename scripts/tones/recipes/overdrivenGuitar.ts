// Overdriven Guitar: FreePats FSBS Distorted #2 below C4. From C4 up, where the
// distorted set turns harsh, FSBS Clean #1 small with an amp drive baked into each note.
// The clean side is level-matched to the distorted side at the split. One round robin,
// and every tail capped at 8 s: only the clean notes whose SFZ loops end inside the cap
// keep them.

import { readFileSync } from 'node:fs';
import { COVERED_NOTES, type ToneRegion } from '../../../src/tones/toneAssets';
import {
  capTail,
  drive,
  fadeOut,
  levelMatchDb,
  trimLeadingSilence,
  type BiquadSettings,
  type DriveSettings,
} from '../dsp';
import { decode, type Audio } from '../ffmpeg';
import type { Recipe } from '../recipe';
import { keyRange, parseSfz, regionFromSfz, widenToCover, type SfzOpcodes } from '../sfz';
import { fetchFromGitHub, type GitHubSet } from '../sources';

const DISTORTED: GitHubSet = {
  repo: 'freepats/electric-guitar-FSBS-dist2',
  commit: '21261b8bcb02d1cbf52dc02f1b1636df52d4a947',
};
const DISTORTED_SFZ = 'EGuitarFSBS-dist2 bridge 20220911.sfz';
const CLEAN: GitHubSet = {
  repo: 'freepats/electric-guitar-FSBS-clean',
  commit: '192cf0d9bf2c4ba6ead8e3524ba3f78818e4fe91',
};
const CLEAN_SFZ = 'EGuitarFSBS-clean bridge small 20260807.sfz';

/** C4. Distorted #2 plays below it, the driven Clean #1 small from it. */
const SPLIT = 60;

/** The amp chain auditioned in #45 and #50, as Web Audio nodes would render it. */
const DRIVE: DriveSettings = {
  preGain: 4.25,
  curveK: 3.2,
  oversample: 4,
  filters: [
    { type: 'highpass', frequency: 90, Q: 1 },
    { type: 'peaking', frequency: 900, Q: 0.8, gain: 4 },
    { type: 'lowpass', frequency: 4600, Q: 0.9 },
  ],
  postGain: 0.28,
};

const TAIL_SECONDS = 8;
const TAIL_FADE_SECONDS = 0.06;

/** Levels match over the 3 notes each side of the split, on their first 1.5 s. */
const MATCH_NOTES = 3;
const MATCH_SECONDS = 1.5;
/** The distorted set's loud layer starts here; the clean set has one layer. */
const LOUD_VELOCITY = 93;

/** "a 90 Hz high-pass", "+4 dB at 900 Hz": for the credit's list of changes. */
function describeFilter(f: BiquadSettings): string {
  const hz = f.frequency >= 1000 ? `${f.frequency / 1000} kHz` : `${f.frequency} Hz`;
  if (f.type === 'peaking') return `${f.gain > 0 ? '+' : ''}${f.gain} dB at ${hz}`;
  return `a ${hz} ${f.type === 'lowpass' ? 'low' : 'high'}-pass`;
}

/** "samples/bridge/small/G#5_s6_03.flac" → "clean-Gs5-s6-03.mp3". No "#" in URLs. */
function shippedName(side: string, sample: string): string {
  const m = /\/([A-G]#?\d)_(\w+)\.flac$/.exec(sample);
  if (!m) throw new Error(`unexpected sample name: ${sample}`);
  return `${side}-${m[1].replace('#', 's')}-${m[2].replace(/_/g, '-')}.mp3`;
}

interface Note {
  region: ToneRegion;
  audio: Audio;
}

/**
 * Drives (clean side only) and trims a note, then ends it within the cap. A note keeps
 * its SFZ loop when the loop ends before the cap's fade; any other note fades out over
 * its last 60 ms, at the cap or at its own end, so no held note stops with a click.
 */
async function prepare(set: GitHubSet, op: SfzOpcodes, side: 'distorted' | 'clean'): Promise<Note> {
  const file = shippedName(side, op.sample);
  const { sampleRate, channels: source } = decode(await fetchFromGitHub(set, op.sample));
  const driven = side === 'clean' ? drive(source, sampleRate, DRIVE) : source;
  const trimmed = trimLeadingSilence(driven, sampleRate);
  const region = regionFromSfz(op, { file, cut: trimmed.start, sampleRate });

  const cap = Math.round(TAIL_SECONDS * sampleRate);
  const fade = Math.round(TAIL_FADE_SECONDS * sampleRate);
  const length = trimmed.channels[0].length;
  const loopFits =
    region.loop !== null &&
    Math.round(region.loop.end * sampleRate) <= (length > cap ? cap - fade : length);
  const capped = capTail(trimmed.channels, cap, fade);
  return {
    audio: {
      sampleRate,
      channels: loopFits || length > cap ? capped : fadeOut(capped, fade),
    },
    region: loopFits ? region : { ...region, loop: null },
  };
}

/** The `count` loud-layer notes nearest the split, from below or from above. */
function nearestSplit(notes: Note[], below: boolean, count: number): Note[] {
  return notes
    .filter((n) => n.region.velHi >= LOUD_VELOCITY)
    .sort((a, b) => (below ? -1 : 1) * (a.region.keycentre - b.region.keycentre))
    .slice(0, count);
}

export const overdrivenGuitar: Recipe = {
  toneId: 'overdriven-guitar',
  async build() {
    const sfz = async (set: GitHubSet, name: string) =>
      parseSfz(readFileSync(await fetchFromGitHub(set, name), 'utf8')).filter(
        // One round robin: the first of each random group.
        (op) => Number(op.lorand ?? 0) === 0,
      );

    const low: Note[] = [];
    for (const op of await sfz(DISTORTED, DISTORTED_SFZ)) {
      if (keyRange(op).lo >= SPLIT) continue;
      const note = await prepare(DISTORTED, op, 'distorted');
      low.push({
        ...note,
        region: { ...note.region, keyHi: Math.min(note.region.keyHi, SPLIT - 1) },
      });
    }
    const high: Note[] = [];
    for (const op of await sfz(CLEAN, CLEAN_SFZ)) {
      if (keyRange(op).hi < SPLIT) continue;
      const note = await prepare(CLEAN, op, 'clean');
      high.push({ ...note, region: { ...note.region, keyLo: Math.max(note.region.keyLo, SPLIT) } });
    }

    const matchFrames = (notes: Note[]) =>
      notes.map((n) =>
        n.audio.channels.map((c) => c.slice(0, Math.round(MATCH_SECONDS * n.audio.sampleRate))),
      );
    const offsetDb = levelMatchDb(
      matchFrames(nearestSplit(low, true, MATCH_NOTES)),
      matchFrames(nearestSplit(high, false, MATCH_NOTES)),
    );
    const matched = high.map((n) => ({
      ...n,
      region: { ...n.region, gainDb: Math.round((n.region.gainDb + offsetDb) * 100) / 100 },
    }));

    const notes = [...low, ...matched];
    return {
      sources: [
        {
          name: 'FreePats Electric Guitar FSBS, Distorted #2',
          url: `https://github.com/${DISTORTED.repo}`,
          pin: { commit: DISTORTED.commit },
          licence: 'CC0-1.0',
          author: 'FreePats',
          changes: `Below C4 only, both velocity layers, the first of four round robins. Leading silence trimmed (−48 dBFS, 1 ms kept). Tails cut at ${TAIL_SECONDS} s with a ${TAIL_FADE_SECONDS * 1000} ms linear fade-out. Re-encoded as 128 kbps MP3.`,
        },
        {
          name: 'FreePats Electric Guitar FSBS, Clean #1 small',
          url: `https://github.com/${CLEAN.repo}`,
          pin: { commit: CLEAN.commit },
          licence: 'CC0-1.0',
          author: 'FreePats',
          changes: `From C4 up only. An amp drive baked in: gain ${DRIVE.preGain}, a tanh curve (k ${DRIVE.curveK}) at ${DRIVE.oversample}× oversampling, ${DRIVE.filters.map(describeFilter).join(', ')}, then gain ${DRIVE.postGain}. Level-matched to Distorted #2 at C4 by region gain. Leading silence trimmed (−48 dBFS, 1 ms kept). SFZ loops kept where they end within ${TAIL_SECONDS} s; every other note fades out over its last ${TAIL_FADE_SECONDS * 1000} ms, cut at ${TAIL_SECONDS} s where longer. Re-encoded as 128 kbps MP3.`,
        },
      ],
      files: new Map(notes.map((n) => [n.region.file, n.audio])),
      regions: widenToCover(
        notes.map((n) => n.region),
        COVERED_NOTES.lo,
        COVERED_NOTES.hi,
      ),
    };
  },
};
