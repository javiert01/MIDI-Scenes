// The Tone catalogue (see **Tone** and **Genre** in `CONTEXT.md`, and ADR-0009):
// every Tone the user can pick, hand-written. A Tone's character is fixed, so its
// gain, envelope and velocity response live here rather than in its assets, and
// can be retuned without re-encoding anything. Gains come from #50; the other
// values were auditioned on `prototype/tone-audition`.

export const GENRES = ['Classical', 'Rock', 'Cumbia'] as const;
export type Genre = (typeof GENRES)[number];

export interface ToneDefinition {
  /** Saved as `toneId`, so it never changes, even if the name does. */
  id: string;
  name: string;
  /** The group it's listed under. Warm Analog has none: it's listed first, on its own. */
  genre: Genre | null;
  /** Synthesised in the browser, or played from downloaded samples. */
  kind: 'synth' | 'sampled';
  /** Fixed gain, matched by ear to Warm Analog at 0 dB. */
  gainDb: number;
  /** How long a released note takes to fall silent (seconds). */
  releaseSeconds: number;
  /** How long a note takes to reach full level (seconds). */
  attackSeconds: number;
  /**
   * How far velocity shapes the Tone's level, 0..1. A sampled Tone's gain is
   * scaled by 1 − t + t · (v/127)². A synthesised Tone applies it its own way,
   * as its module says. 0 ignores velocity.
   */
  velocityTracking: number;
  /** Attribution the Sound strip shows while the Tone is selected, where a licence asks for it. */
  credit?: string;
  /** A sampled Tone's folder under `src/tones/`, holding its `regions.json` and samples. */
  assets?: string;
}

export const DEFAULT_TONE_ID = 'warm-analog';

export const TONES: readonly ToneDefinition[] = [
  {
    id: DEFAULT_TONE_ID,
    name: 'Warm Analog',
    genre: null,
    kind: 'synth',
    gainDb: 0,
    releaseSeconds: 0.2,
    attackSeconds: 0.01,
    // Ignores velocity, as the Preview Synth it replaced did.
    velocityTracking: 0,
  },
  {
    id: 'grand-piano',
    name: 'Grand Piano',
    genre: 'Classical',
    kind: 'sampled',
    gainDb: -7,
    releaseSeconds: 0.35,
    attackSeconds: 0.002,
    velocityTracking: 0.45,
    // Salamander is CC BY 3.0, the one source that asks for attribution.
    credit: 'Salamander Grand Piano by Alexander Holm, CC BY 3.0, trimmed and re-encoded.',
    assets: 'grand-piano',
  },
  {
    id: 'accordion',
    name: 'Accordion',
    genre: 'Cumbia',
    kind: 'sampled',
    gainDb: -17,
    releaseSeconds: 0.13,
    attackSeconds: 0.03,
    velocityTracking: 0.4,
    assets: 'accordion',
  },
  {
    // A working name: renaming it changes only `name`, never this saved id.
    id: 'villera-lead',
    name: 'Villera Lead',
    genre: 'Cumbia',
    kind: 'synth',
    gainDb: -3,
    releaseSeconds: 0.12,
    attackSeconds: 0.006,
    // Linear, unlike a sampled Tone's: see `src/engine/villeraLead.ts`.
    velocityTracking: 0.45,
  },
];

const WARM_ANALOG_DEFINITION = TONES[0];

/** The Tone with `id`, or Warm Analog for any id the catalogue doesn't hold, so a stale saved id never breaks sound. */
export function toneById(id: unknown): ToneDefinition {
  return TONES.find((tone) => tone.id === id) ?? WARM_ANALOG_DEFINITION;
}

export interface ToneMenuItem {
  id: string;
  name: string;
}

export interface ToneMenu {
  /** Listed first, outside any group: Warm Analog. */
  first: ToneMenuItem;
  /** One group per Genre that has Tones, in Genre order. */
  groups: { genre: Genre; tones: ToneMenuItem[] }[];
}

/** The Tone dropdown's layout: Warm Analog first, then the Tones grouped by Genre. */
export function toneMenu(tones: readonly ToneDefinition[] = TONES): ToneMenu {
  const item = ({ id, name }: ToneDefinition): ToneMenuItem => ({ id, name });
  const groups = GENRES.map((genre) => ({
    genre,
    tones: tones.filter((tone) => tone.genre === genre).map(item),
  })).filter((group) => group.tones.length > 0);
  return { first: item(WARM_ANALOG_DEFINITION), groups };
}
