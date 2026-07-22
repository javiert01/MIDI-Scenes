import type { Scene } from '@/engine/scene';
import { StarfieldScene } from './StarfieldScene';
import { UnderwaterScene } from './UnderwaterScene';
import { RainScene } from './RainScene';
import { GreatHallScene } from './GreatHallScene';

/** Fresh Scene instances for a new engine — Scenes hold mutable per-instance state. */
export function createDefaultScenes(): Scene[] {
  return [new UnderwaterScene(), new StarfieldScene(), new RainScene(), new GreatHallScene()];
}
