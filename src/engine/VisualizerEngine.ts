import p5 from 'p5';
import type { P5Factory, P5Like } from './types';
import type { ParamSpec, ParamValue, Scene, SceneContext } from './scene';
import { SceneRegistry } from './SceneRegistry';

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 800;
const CHROMA_KEY_RATIO = 1 / 3;

const BACKGROUND_GRAY = 10;
const CHROMA_KEY_GREEN: [number, number, number] = [0, 177, 64];

export const defaultP5Factory: P5Factory = (sketch, node) =>
  new p5(sketch, node) as unknown as P5Like;

export interface SceneDescriptor {
  id: string;
  label: string;
}

export interface VisualizerEngineOptions {
  width?: number;
  height?: number;
  chromaKeyRatio?: number;
  createP5?: P5Factory;
  scenes?: Scene[];
}

function defaultParamValues(specs: ParamSpec[]): Record<string, ParamValue> {
  const values: Record<string, ParamValue> = {};
  for (const spec of specs) values[spec.key] = spec.default;
  return values;
}

/**
 * Framework-agnostic core that owns the single p5 instance and the Scene
 * Registry. Created once at startup; Scene switching swaps which Scene the
 * render loop calls and never recreates the p5 instance.
 */
export class VisualizerEngine {
  readonly width: number;
  readonly height: number;
  readonly visualizationHeight: number;
  readonly chromaKeyHeight: number;

  // Assigned synchronously inside the createP5 sketch callback below, before
  // the constructor returns — the factory always invokes that callback inline.
  private p!: P5Like;
  private readonly registry: SceneRegistry;
  private readonly paramValues = new Map<string, Record<string, ParamValue>>();
  private readonly listeners = new Set<() => void>();

  private activeScene: Scene | null = null;
  private sceneStartMillis = 0;
  private lastFrameMillis = 0;

  constructor(container: HTMLElement, options: VisualizerEngineOptions = {}) {
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.chromaKeyHeight = this.height * (options.chromaKeyRatio ?? CHROMA_KEY_RATIO);
    this.visualizationHeight = this.height - this.chromaKeyHeight;

    this.registry = new SceneRegistry(options.scenes ?? []);
    for (const scene of this.registry.list()) {
      this.paramValues.set(scene.id, defaultParamValues(scene.params));
    }

    const createP5 = options.createP5 ?? defaultP5Factory;
    createP5((p) => {
      this.p = p;
      p.setup = () => {
        p.createCanvas(this.width, this.height);
        this.lastFrameMillis = p.millis();
        const [firstScene] = this.registry.list();
        if (firstScene) this.activateScene(firstScene);
      };
      p.draw = () => {
        this.renderFrame(p);
      };
    }, container);
  }

  /** Scenes available for the sidebar to list. */
  get scenes(): SceneDescriptor[] {
    return this.registry.list().map(({ id, label }) => ({ id, label }));
  }

  get activeSceneId(): string | null {
    return this.activeScene?.id ?? null;
  }

  /** Switches the Active Scene: tears down the outgoing Scene, sets up the incoming one. */
  selectScene(id: string): void {
    if (id === this.activeScene?.id) return;
    const scene = this.registry.get(id);
    if (!scene) return;
    this.activateScene(scene);
  }

  /** Registers a listener notified whenever engine state (e.g. Active Scene) changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stops the draw loop and removes the p5 canvas. Call on unmount. */
  destroy(): void {
    this.activeScene?.teardown();
    this.p.remove();
  }

  private activateScene(scene: Scene): void {
    this.activeScene?.teardown();
    this.activeScene = scene;
    this.sceneStartMillis = this.p.millis();
    this.lastFrameMillis = this.sceneStartMillis;
    scene.setup(this.buildContext(0, 0));
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private buildContext(elapsed: number, deltaTime: number): SceneContext {
    const scene = this.activeScene;
    return {
      p: this.p,
      width: this.width,
      height: this.height,
      chromaKeyHeight: this.chromaKeyHeight,
      params: (scene && this.paramValues.get(scene.id)) ?? {},
      elapsed,
      deltaTime,
    };
  }

  private renderFrame(p: P5Like): void {
    p.background(BACKGROUND_GRAY);
    p.noStroke();
    p.fill(...CHROMA_KEY_GREEN);
    p.rect(0, this.visualizationHeight, this.width, this.chromaKeyHeight);

    if (!this.activeScene) return;

    const now = p.millis();
    const deltaTime = now - this.lastFrameMillis;
    const elapsed = now - this.sceneStartMillis;
    this.lastFrameMillis = now;

    const ctx = this.buildContext(elapsed, deltaTime);
    this.activeScene.update(ctx);
    this.activeScene.draw(ctx);
  }
}
