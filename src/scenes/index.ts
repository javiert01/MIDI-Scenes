import type { Scene } from '@/engine/scene';
import { StarfieldScene } from './StarfieldScene';
import { UnderwaterScene } from './UnderwaterScene';

/** Fresh Scene instances for a new engine — Scenes hold mutable per-instance state. */
export function createDefaultScenes(): Scene[] {
  return [new StarfieldScene(), new UnderwaterScene()];
}
