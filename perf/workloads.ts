/**
 * Scripted performances the workbench plays into every Scene. Each is a pure
 * function of the frame number, so every run (and both sides of a base-vs-PR
 * comparison) receives exactly the same notes on exactly the same frames.
 */

export interface NoteCommand {
  type: 'on' | 'off';
  note: number;
  /** Raw MIDI velocity, 1–127 (ignored for `off`). */
  velocity: number;
}

export interface Workload {
  id: string;
  description: string;
  /** The notes to send just before drawing `frame` (0-based, warmup included). */
  at(frame: number): NoteCommand[];
}

/** The Piano Preview's range (A0–C8). */
const LOWEST = 21;
const HIGHEST = 108;
const RANGE = HIGHEST - LOWEST + 1;

/** A note number that sweeps up and down the whole keyboard as `step` grows. */
function sweep(step: number): number {
  const span = RANGE - 1;
  const t = step % (span * 2);
  return LOWEST + (t <= span ? t : span * 2 - t);
}

const on = (note: number, velocity: number): NoteCommand => ({ type: 'on', note, velocity });
const off = (note: number): NoteCommand => ({ type: 'off', note, velocity: 0 });

const idle: Workload = {
  id: 'idle',
  description: 'No notes: the Scene’s ambient animation alone',
  at: () => [],
};

/** One note every 10 frames walking the keyboard, each held for 8 frames. */
const melody: Workload = {
  id: 'melody',
  description: 'A single-note line across the keyboard, ~6 notes a second',
  at(frame) {
    const commands: NoteCommand[] = [];
    if (frame % 10 === 0) {
      const step = frame / 10;
      commands.push(on(sweep(step * 5), 60 + ((step * 17) % 50)));
    }
    if (frame % 10 === 8) {
      commands.push(off(sweep(Math.floor(frame / 10) * 5)));
    }
    return commands;
  },
};

/** A bass note plus a four-note chord every second, held almost to the next. */
const chords: Workload = {
  id: 'chords',
  description: 'Sustained five-note chords, one a second, for tall Crystals',
  at(frame) {
    const shape = (index: number): number[] => {
      const root = 36 + ((index * 7) % 24);
      return [root, root + 24, root + 28, root + 31, root + 36];
    };
    const index = Math.floor(frame / 60);
    const commands: NoteCommand[] = [];
    if (frame % 60 === 0) {
      for (const note of shape(index)) commands.push(on(note, 90));
    }
    if (frame % 60 === 55) {
      for (const note of shape(index)) commands.push(off(note));
    }
    return commands;
  },
};

/**
 * The worst case the app should still survive: two new notes every frame,
 * full velocity, each held for 12 frames (~24 sounding at once), sweeping the
 * whole keyboard so every column fills with Crystals and Dust.
 */
const storm: Workload = {
  id: 'storm',
  description: 'Stress: 120 notes a second at full velocity, ~24 held at once',
  at(frame) {
    const commands: NoteCommand[] = [];
    const notesAt = (f: number) => [sweep(f * 3), sweep(f * 3 + RANGE)];
    if (frame >= 12) for (const note of notesAt(frame - 12)) commands.push(off(note));
    for (const note of notesAt(frame)) commands.push(on(note, 127));
    return commands;
  },
};

export const WORKLOADS: readonly Workload[] = [idle, melody, chords, storm];
