import type { Scene } from './scene';

/** Catalog of available Scenes the sidebar lists and the engine switches between. */
export class SceneRegistry {
  private readonly scenes = new Map<string, Scene>();

  constructor(scenes: Scene[] = []) {
    for (const scene of scenes) this.register(scene);
  }

  register(scene: Scene): void {
    this.scenes.set(scene.id, scene);
  }

  get(id: string): Scene | undefined {
    return this.scenes.get(id);
  }

  list(): Scene[] {
    return [...this.scenes.values()];
  }
}
