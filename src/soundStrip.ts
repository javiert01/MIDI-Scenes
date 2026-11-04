// Turns the engine's sound state into what the sidebar's Sound strip, and the
// Device card's sound hint, show. Pure, so every segment and message can be
// tested without React or real audio (see `deviceStatus.ts`).

import type { SoundGates } from '@/engine/VisualizerEngine';
import { type ToneMenu, toneMenu } from '@/tones/catalogue';

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
}

export interface SoundStripView {
  mode: SoundMode;
  /** The muted line warning that sound lags the keys, or null. */
  latencyHint: string | null;
  /** What the Device card says while Device sound waits for a gesture, or null. */
  deviceHint: string | null;
  /** The Tone dropdown, shown whenever sound isn't Off, or null. */
  tonePicker: { menu: ToneMenu; selected: string } | null;
}

/** The catalogue is fixed, so the dropdown's layout is built once. */
const TONE_MENU = toneMenu();

/** Output latency above this is worth warning about (ms). */
const LATENCY_HINT_THRESHOLD_MS = 60;

export function describeSoundStrip(state: SoundState): SoundStripView {
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

  const tonePicker = mode === 'off' ? null : { menu: TONE_MENU, selected: toneId };

  return { mode, latencyHint, deviceHint, tonePicker };
}

/** The stored gates a segment sets. */
export function gatesForSoundMode(mode: SoundMode): SoundGates {
  return { soundEnabled: mode !== 'off', deviceSoundEnabled: mode === 'all' };
}
