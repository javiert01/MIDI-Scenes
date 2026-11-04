import type { ToneRegion, ToneSource } from '../../src/tones/toneAssets';
import type { Audio } from './ffmpeg';

/** A hand-written recipe: how one sampled Tone is made from its pinned sources. */
export interface Recipe {
  toneId: string;
  build(): Promise<BuiltTone>;
}

export interface BuiltTone {
  sources: ToneSource[];
  /** Prepared audio, keyed by the file name the regions use. */
  files: Map<string, Audio>;
  regions: ToneRegion[];
}
