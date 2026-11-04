// The shape of a sampled Tone's generated `regions.json`, and the rules every built
// Tone must meet. `npm run tones:build` writes these files and checks them, and the
// contract test checks them again over what is committed.

import { KEYBOARD_BASE_NOTE, KEYBOARD_TOP_NOTE } from '../engine/keyboardGeometry';
import { readMp3Info, type Mp3Info } from './mp3Info';

export const LICENCES = ['CC0-1.0', 'CC-BY-3.0'] as const;
export type Licence = (typeof LICENCES)[number];

export interface ToneSource {
  name: string;
  url: string;
  pin: { commit: string } | { sha256: string };
  licence: Licence;
  author: string;
  changes: string;
}

export interface ToneRegion {
  file: string;
  keycentre: number;
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  /** Cents. */
  tune: number;
  gainDb: number;
  /** −1 (left) to 1 (right). */
  pan: number;
  /** Seconds into the file as shipped, after the trim. `end` is exclusive. */
  loop: { start: number; end: number } | null;
  release: boolean;
}

export interface ToneAssets {
  toneId: string;
  sources: ToneSource[];
  regions: ToneRegion[];
}

/** Every Tone sounds at least across the Piano Preview's keys, C2 to B6. */
export const COVERED_NOTES = { lo: KEYBOARD_BASE_NOTE, hi: KEYBOARD_TOP_NOTE } as const;

/** About 175 MB once decoded at 48 kHz. A mono second counts as half a stereo one. */
export const MAX_HELD_STEREO_SECONDS = 450;
export const MAX_MIB = 7;

export const MP3_BITRATE_KBPS = 128;

export interface ToneCheck {
  problems: string[];
  heldStereoSeconds: number;
  mib: number;
}

/**
 * Checks a built Tone against the pipeline's rules. `readFile` returns the bytes of a
 * file in the Tone's folder, or undefined when it doesn't exist.
 */
export function checkToneAssets(
  assets: ToneAssets,
  readFile: (name: string) => Uint8Array | undefined,
): ToneCheck {
  const problems: string[] = [];
  let heldStereoSeconds = 0;
  let bytes = 0;

  if (assets.sources.length === 0) problems.push('sources is empty');
  for (const s of assets.sources) {
    if (!(LICENCES as readonly string[]).includes(s.licence)) {
      problems.push(`${s.name}: licence ${s.licence} is not on the allowlist`);
    }
  }

  const infos = new Map<string, Mp3Info | null>();
  for (const file of new Set(assets.regions.map((r) => r.file))) {
    const data = readFile(file);
    if (!data) {
      problems.push(`${file} is missing`);
      infos.set(file, null);
      continue;
    }
    bytes += data.length;
    try {
      const info = readMp3Info(data);
      infos.set(file, info);
      heldStereoSeconds += (info.durationSeconds * info.channels) / 2;
      if (info.tag !== 'Info' || info.bitrateKbps !== MP3_BITRATE_KBPS) {
        problems.push(`${file} is not CBR ${MP3_BITRATE_KBPS} kbps`);
      }
      if (!info.lameTag) problems.push(`${file} has no LAME tag`);
    } catch (e) {
      problems.push(`${file}: ${(e as Error).message}`);
      infos.set(file, null);
    }
  }

  for (const r of assets.regions) {
    const info = infos.get(r.file);
    if (!r.loop || !info) continue;
    const frame = 1 / info.sampleRate;
    if (!(
      r.loop.start >= 0 &&
      r.loop.start < r.loop.end &&
      r.loop.end <= info.durationSeconds + frame
    )) {
      problems.push(`${r.file}: loop ${r.loop.start}–${r.loop.end} s falls outside the file`);
    }
  }

  const gaps = uncoveredNotes(assets.regions, COVERED_NOTES.lo, COVERED_NOTES.hi);
  if (gaps.length > 0) problems.push(`notes ${gaps.join(', ')} have no region for every velocity`);

  const mib = bytes / 2 ** 20;
  if (heldStereoSeconds > MAX_HELD_STEREO_SECONDS) {
    problems.push(
      `holds ${heldStereoSeconds.toFixed(1)} s of stereo, over ${MAX_HELD_STEREO_SECONDS} s`,
    );
  }
  if (mib > MAX_MIB) problems.push(`weighs ${mib.toFixed(2)} MiB, over ${MAX_MIB} MiB`);

  return { problems, heldStereoSeconds, mib };
}

/** Notes in lo..hi where some velocity 1..127 has no sustaining (non-release) region. */
export function uncoveredNotes(regions: ToneRegion[], lo: number, hi: number): number[] {
  const gaps: number[] = [];
  for (let note = lo; note <= hi; note++) {
    const here = regions.filter((r) => !r.release && r.keyLo <= note && note <= r.keyHi);
    for (let vel = 1; vel <= 127; vel++) {
      if (!here.some((r) => r.velLo <= vel && vel <= r.velHi)) {
        gaps.push(note);
        break;
      }
    }
  }
  return gaps;
}
