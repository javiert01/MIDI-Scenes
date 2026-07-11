import p5 from 'p5';
import type { P5Factory, P5Like } from './types';
import type { ParamSpec, ParamValue, Scene, SceneContext } from './scene';
import { SceneRegistry } from './SceneRegistry';
import { parseNoteMessage } from './midi';
import type { MidiAccessLike, MidiFactory } from './midiTypes';
import { defaultMidiFactory } from './webMidiAdapter';

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 800;
const CHROMA_KEY_RATIO = 1 / 3;

const BACKGROUND_GRAY = 10;
const CHROMA_KEY_GREEN: [number, number, number] = [0, 177, 64];

const DEVICE_STORAGE_KEY = 'midi-visualizer:device-id';

export const defaultP5Factory: P5Factory = (sketch, node) =>
  new p5(sketch, node) as unknown as P5Like;

export interface SceneDescriptor {
  id: string;
  label: string;
}

export interface DeviceDescriptor {
  id: string;
  label: string;
}

export interface VisualizerEngineOptions {
  width?: number;
  height?: number;
  chromaKeyRatio?: number;
  createP5?: P5Factory;
  scenes?: Scene[];
  createMidi?: MidiFactory;
  storage?: Storage;
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

  private readonly storage?: Storage;
  private midiAccess: MidiAccessLike | null = null;
  private selectedDeviceId: string | null = null;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeDeviceChange: (() => void) | null = null;

  constructor(container: HTMLElement, options: VisualizerEngineOptions = {}) {
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.chromaKeyHeight = this.height * (options.chromaKeyRatio ?? CHROMA_KEY_RATIO);
    this.visualizationHeight = this.height - this.chromaKeyHeight;
    this.storage =
      options.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);

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

    void this.initMidi(options.createMidi ?? defaultMidiFactory);
  }

  /** Scenes available for the sidebar to list. */
  get scenes(): SceneDescriptor[] {
    return this.registry.list().map(({ id, label }) => ({ id, label }));
  }

  get activeSceneId(): string | null {
    return this.activeScene?.id ?? null;
  }

  /** MIDI Devices available for the sidebar to list. */
  get devices(): DeviceDescriptor[] {
    return this.midiAccess?.inputs.map(({ id, name }) => ({ id, label: name })) ?? [];
  }

  get activeDeviceId(): string | null {
    return this.selectedDeviceId;
  }

  /** Switches the Active Scene: tears down the outgoing Scene, sets up the incoming one. */
  selectScene(id: string): void {
    if (id === this.activeScene?.id) return;
    const scene = this.registry.get(id);
    if (!scene) return;
    this.activateScene(scene);
  }

  /** Selects the single Device the engine binds MIDI message handlers to. */
  selectDevice(id: string): void {
    if (!this.midiAccess) return;
    if (id === this.selectedDeviceId) return;
    const exists = this.midiAccess.inputs.some((input) => input.id === id);
    if (!exists) return;
    this.wireDevice(id);
    this.notify();
  }

  /** Registers a listener notified whenever engine state (e.g. Active Scene) changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stops the draw loop and removes the p5 canvas. Call on unmount. */
  destroy(): void {
    this.activeScene?.teardown();
    this.unwireActiveDevice();
    this.unsubscribeDeviceChange?.();
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

  private async initMidi(createMidi: MidiFactory): Promise<void> {
    try {
      this.midiAccess = await createMidi();
    } catch {
      this.midiAccess = null;
      return;
    }
    this.unsubscribeDeviceChange = this.midiAccess.onDeviceChange(() => this.syncDevices());
    this.syncDevices(this.storage?.getItem(DEVICE_STORAGE_KEY) ?? undefined);
  }

  /** Reconciles the active Device against the current Device list (startup + hot-plug). */
  private syncDevices(preferredId?: string): void {
    const inputs = this.midiAccess?.inputs ?? [];
    const stillPresent = inputs.some((input) => input.id === this.selectedDeviceId);
    if (this.selectedDeviceId && !stillPresent) {
      this.unwireActiveDevice();
    }

    if (!this.selectedDeviceId) {
      const preferred = preferredId && inputs.some((input) => input.id === preferredId);
      const nextId = preferred ? preferredId : inputs[0]?.id;
      if (nextId) this.wireDevice(nextId);
    }

    this.notify();
  }

  // Only called once midiAccess has resolved (initMidi/syncDevices/selectDevice all guard it).
  private wireDevice(id: string): void {
    if (!this.midiAccess) return;
    this.unwireActiveDevice();
    this.selectedDeviceId = id;
    this.unsubscribeMessage = this.midiAccess.onMessage(id, (data) => this.handleRawMessage(data));
    this.storage?.setItem(DEVICE_STORAGE_KEY, id);
  }

  private unwireActiveDevice(): void {
    this.unsubscribeMessage?.();
    this.unsubscribeMessage = null;
    this.selectedDeviceId = null;
  }

  private handleRawMessage(data: number[]): void {
    if (!this.activeScene) return;
    const parsed = parseNoteMessage(data);
    if (!parsed) return;
    const ctx = this.buildContext(this.p.millis() - this.sceneStartMillis, 0);
    if (parsed.type === 'noteon') {
      this.activeScene.onNoteOn(parsed.event, ctx);
    } else {
      this.activeScene.onNoteOff(parsed.event, ctx);
    }
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
