// Turns the engine's sound state into what the sidebar's Sound strip, and the
// Device card's sound hint, show. Pure, so every segment and message can be
// tested without React or real audio (see `deviceStatus.ts`).

import type { SoundGates, ToneLoadProgress, ToneStatus } from '@/engine/VisualizerEngine';
import {
  DEFAULT_TONE_ID,
  type Genre,
  type ToneMenuItem,
  toneById,
  toneMenu,
} from '@/tones/catalogue';
import { TONE_DOWNLOAD_BYTES } from '@/tones/toneLoader';

/** The strip's three segments: nothing sounds, the Virtual Input sounds, or every note does. */
export type SoundMode = 'off' | 'computer' | 'all';

export const SOUND_MODE_OPTIONS: { value: SoundMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'computer', label: 'Computer' },
  { value: 'all', label: 'All notes' },
];

export interface SoundState extends SoundGates {
  /** Whether the AudioContext exists but the browser holds it suspended until a gesture. */
  audioSuspended: boolean;
  /** The context's output latency, or null where the browser doesn't report it. */
  outputLatencyMs: number | null;
  /** The selected Tone. */
  toneId: string;
  /** Whether the selected Tone plays yet, or Warm Analog stands in while it loads or after it failed. */
  toneStatus: ToneStatus;
  /** How far the selected Tone's download has got, or null before anything is reported. */
  toneProgress: ToneLoadProgress | null;
  /** Sampled Tones already downloaded, which need no size label. */
  downloadedToneIds: readonly string[];
}

/** One entry in the Tone dropdown: its id, and its name with a size if it still needs downloading. */
export interface ToneOption {
  id: string;
  label: string;
}

/** The Tone dropdown's layout, as the catalogue's menu, with labels in place of names. */
export interface ToneOptions {
  first: ToneOption;
  groups: { genre: Genre; tones: ToneOption[] }[];
}

/**
 * The line under the dropdown while a sampled Tone loads, with a bar filled to
 * `fraction`, or after it failed, with a Retry button.
 */
export type DownloadLine =
  { kind: 'progress'; fraction: number; text: string } | { kind: 'failed'; text: string };

/**
 * The attribution under the dropdown, split so the licence's name can link to its
 * text: `before`, then the licence, then `after`. `licence` is null when the credit
 * names no licence the strip knows.
 */
export interface CreditLine {
  before: string;
  licence: { label: string; href: string } | null;
  after: string;
}

export interface SoundStripView {
  mode: SoundMode;
  /** The muted line warning that sound lags the keys, or null. */
  latencyHint: string | null;
  /** What the Device card says while Device sound waits for a gesture, or null. */
  deviceHint: string | null;
  /** The Tone dropdown, shown whenever sound isn't Off, or null. */
  tonePicker: { menu: ToneOptions; selected: string } | null;
  /** Download progress or failure for the selected Tone, while sound isn't Off, or null. */
  download: DownloadLine | null;
  /** The selected Tone's credit, while sound isn't Off, where its licence asks for one; or null. */
  credit: CreditLine | null;
}

/** The catalogue is fixed, so the dropdown's layout is built once. */
const TONE_MENU = toneMenu();

/** The Tone that plays while the selected one loads, or after it failed. */
const STAND_IN_TONE_NAME = toneById(DEFAULT_TONE_ID).name;

/** Licences a credit may name, and where their text lives. */
const LICENCE_LINKS: Record<string, string> = {
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
};

/** Output latency above this is worth warning about (ms). */
const LATENCY_HINT_THRESHOLD_MS = 60;

/**
 * Derives the strip from engine state. `downloadBytes` holds each sampled
 * Tone's download size, by id; it defaults to the committed files' sizes.
 */
export function describeSoundStrip(
  state: SoundState,
  downloadBytes: Readonly<Record<string, number>> = TONE_DOWNLOAD_BYTES,
): SoundStripView {
  const { soundEnabled, deviceSoundEnabled, audioSuspended, outputLatencyMs, toneId } = state;
  // Device sound on with Virtual Input sound off can't be picked from the strip,
  // but is accepted if saved (spec #53). It shows as All notes, so a Device that
  // would sound into a recording is never shown as quiet.
  const mode: SoundMode = deviceSoundEnabled ? 'all' : soundEnabled ? 'computer' : 'off';

  const latencyHint =
    mode !== 'off' && outputLatencyMs !== null && outputLatencyMs > LATENCY_HINT_THRESHOLD_MS
      ? `Sound may lag about ${Math.round(outputLatencyMs)} ms behind your keys. Wired headphones or speakers help.`
      : null;

  // After a reload the AudioContext starts suspended, and Device notes are
  // dropped until a click or key press anywhere resumes it. Where there is no
  // context at all (no Web Audio), no click would help, so nothing is asked.
  const deviceHint =
    deviceSoundEnabled && audioSuspended ? 'Click anywhere to turn sound on' : null;

  if (mode === 'off') {
    return { mode, latencyHint, deviceHint, tonePicker: null, download: null, credit: null };
  }

  const option = ({ id, name }: ToneMenuItem): ToneOption => {
    const bytes = downloadBytes[id];
    const needsDownload = bytes !== undefined && !state.downloadedToneIds.includes(id);
    return { id, label: needsDownload ? `${name} (${sizeLabelMb(bytes)})` : name };
  };
  const menu: ToneOptions = {
    first: option(TONE_MENU.first),
    groups: TONE_MENU.groups.map(({ genre, tones }) => ({ genre, tones: tones.map(option) })),
  };

  return {
    mode,
    latencyHint,
    deviceHint,
    tonePicker: { menu, selected: toneId },
    download: describeDownload(state),
    credit: describeCredit(toneById(toneId).credit),
  };
}

/** Splits a Tone's credit around the first licence it names, so that name can link to the licence. */
function describeCredit(credit: string | undefined): CreditLine | null {
  if (!credit) return null;
  for (const [label, href] of Object.entries(LICENCE_LINKS)) {
    const at = credit.indexOf(label);
    if (at !== -1) {
      return {
        before: credit.slice(0, at),
        licence: { label, href },
        after: credit.slice(at + label.length),
      };
    }
  }
  return { before: credit, licence: null, after: '' };
}

/** The selected Tone's download line: progress while it loads, Retry once it failed. */
function describeDownload({ toneId, toneStatus, toneProgress }: SoundState): DownloadLine | null {
  const name = toneById(toneId).name;
  if (toneStatus === 'failed') {
    return { kind: 'failed', text: `Couldn't download ${name}. ${STAND_IN_TONE_NAME} is playing.` };
  }
  if (toneStatus !== 'loading') return null;

  const standsIn = ` · ${STAND_IN_TONE_NAME} plays until it's ready`;
  if (!toneProgress)
    return { kind: 'progress', fraction: 0, text: `Downloading ${name}…${standsIn}` };
  const { filesDone, filesTotal } = toneProgress;
  // The loader decodes only once every file is in.
  if (filesDone >= filesTotal) {
    return { kind: 'progress', fraction: 1, text: `Preparing ${name}…${standsIn}` };
  }
  return {
    kind: 'progress',
    fraction: filesDone / filesTotal,
    text: `Downloading ${name}: ${filesDone} of ${filesTotal} files${standsIn}`,
  };
}

/**
 * A download's size, rounded to whole MB, never less than 1 MB. An MB here is
 * 2^20 bytes, the unit of the asset pipeline's budget (`MAX_MIB`), so a Tone
 * within budget is never labelled larger than it.
 */
export function sizeLabelMb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 2 ** 20))} MB`;
}

/** The stored gates a segment sets. */
export function gatesForSoundMode(mode: SoundMode): SoundGates {
  return { soundEnabled: mode !== 'off', deviceSoundEnabled: mode === 'all' };
}
