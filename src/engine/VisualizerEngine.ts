import p5 from 'p5';
import type { P5Factory, P5Like } from './types';
import type { ParamSpec, ParamValue, Scene, SceneContext } from './scene';
import { SceneRegistry } from './SceneRegistry';
import { parseNoteMessage } from './midi';
import type { MidiAccessLike, MidiFactory } from './midiTypes';
import { defaultMidiFactory } from './webMidiAdapter';

const CHROMA_KEY_RATIO = 1 / 3;

export type ResolutionPresetId = '1600x800' | '1920x1080';

const RESOLUTION_PRESETS: Record<ResolutionPresetId, { width: number; height: number }> = {
  '1600x800': { width: 1600, height: 800 },
  '1920x1080': { width: 1920, height: 1080 },
};

const DEFAULT_PRESET: ResolutionPresetId = '1600x800';

function presetIdForDimensions(width: number, height: number): ResolutionPresetId | undefined {
  return (Object.keys(RESOLUTION_PRESETS) as ResolutionPresetId[]).find(
    (id) => RESOLUTION_PRESETS[id].width === width && RESOLUTION_PRESETS[id].height === height,
  );
}

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

/** Validates `value` against `spec`, clamping range values to [min, max] and snapping to `step`. */
function clampParamValue(spec: ParamSpec, value: ParamValue): ParamValue | undefined {
  switch (spec.type) {
    case 'range': {
      if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
      let clamped = value;
      if (spec.step) {
        const base = spec.min ?? 0;
        clamped = base + Math.round((clamped - base) / spec.step) * spec.step;
      }
      if (spec.min !== undefined) clamped = Math.max(spec.min, clamped);
      if (spec.max !== undefined) clamped = Math.min(spec.max, clamped);
      return clamped;
    }
    case 'toggle':
      return typeof value === 'boolean' ? value : undefined;
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
    case 'select':
      return typeof value === 'string' && spec.options?.some((option) => option.value === value)
        ? value
        : undefined;
  }
}

export interface ActiveParam {
  spec: ParamSpec;
  value: ParamValue;
}

/**
 * Framework-agnostic core that owns the single p5 instance and the Scene
 * Registry. Created once at startup; Scene switching swaps which Scene the
 * render loop calls and never recreates the p5 instance.
 */
export class VisualizerEngine {
  private widthState: number;
  private heightState: number;
  private visualizationHeightState: number;
  private chromaKeyHeightState: number;
  private resolutionPresetState: ResolutionPresetId;
  private readonly chromaKeyRatio: number;

  // Assigned synchronously inside the createP5 sketch callback below, before
  // the constructor returns — the factory always invokes that callback inline.
  private p!: P5Like;
  private readonly registry: SceneRegistry;
  private readonly paramValues = new Map<string, Record<string, ParamValue>>();
  private readonly listeners = new Set<() => void>();

  private activeScene: Scene | null = null;
  private sceneStartMillis = 0;
  private lastFrameMillis = 0;
  private chromaKeyVisibleState = true;

  private readonly storage?: Storage;
  private midiAccess: MidiAccessLike | null = null;
  private selectedDeviceId: string | null = null;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeDeviceChange: (() => void) | null = null;
  // Cached so useSyncExternalStore's getSnapshot returns a stable reference
  // between notify() calls instead of a fresh array on every render.
  private cachedDevices: DeviceDescriptor[] = [];
  // Same reasoning as cachedDevices, for the Active Scene's param specs + current values.
  private cachedParams: ActiveParam[] = [];
  // Bumped on every dispatched note so the sidebar activity indicator can
  // detect "a note just happened" via useSyncExternalStore, without the
  // engine tracking any note-specific state itself.
  private noteActivityTick = 0;

  constructor(container: HTMLElement, options: VisualizerEngineOptions = {}) {
    const width = options.width ?? RESOLUTION_PRESETS[DEFAULT_PRESET].width;
    const height = options.height ?? RESOLUTION_PRESETS[DEFAULT_PRESET].height;
    this.chromaKeyRatio = options.chromaKeyRatio ?? CHROMA_KEY_RATIO;
    this.resolutionPresetState = presetIdForDimensions(width, height) ?? DEFAULT_PRESET;
    this.widthState = width;
    this.heightState = height;
    ({
      chromaKeyHeight: this.chromaKeyHeightState,
      visualizationHeight: this.visualizationHeightState,
    } = this.splitHeight(height));
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

  get width(): number {
    return this.widthState;
  }

  get height(): number {
    return this.heightState;
  }

  get visualizationHeight(): number {
    return this.visualizationHeightState;
  }

  get chromaKeyHeight(): number {
    return this.chromaKeyHeightState;
  }

  /** The active resolution preset. Switching never recreates the canvas. */
  get resolutionPreset(): ResolutionPresetId {
    return this.resolutionPresetState;
  }

  /** Resolution presets available for the sidebar to list. */
  get resolutionPresets(): ResolutionPresetId[] {
    return Object.keys(RESOLUTION_PRESETS) as ResolutionPresetId[];
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
    return this.cachedDevices;
  }

  get activeDeviceId(): string | null {
    return this.selectedDeviceId;
  }

  /** Whether the Chroma Key area is painted green. Toggling never recreates the canvas. */
  get chromaKeyVisible(): boolean {
    return this.chromaKeyVisibleState;
  }

  /** Bumped on every dispatched note-on/off; sidebar can diff it to flash an activity indicator. */
  get activityTick(): number {
    return this.noteActivityTick;
  }

  /** The Active Scene's ParamSpecs paired with their current values, for the sidebar to render. */
  get params(): ActiveParam[] {
    return this.cachedParams;
  }

  /** Validates/clamps `value` against the Scene's ParamSpec for `key`; invalid input is a no-op. */
  setParam(sceneId: string, key: string, value: ParamValue): void {
    const scene = this.registry.get(sceneId);
    if (!scene) return;
    const spec = scene.params.find((paramSpec) => paramSpec.key === key);
    if (!spec) return;
    const clamped = clampParamValue(spec, value);
    if (clamped === undefined) return;

    const values = this.paramValues.get(sceneId);
    if (!values) return;
    values[key] = clamped;

    if (scene === this.activeScene) this.cachedParams = this.computeActiveParams();
    this.notify();
  }

  /** Resizes the internal render buffer to `id`'s dimensions. Never recreates the canvas. */
  setResolutionPreset(id: ResolutionPresetId): void {
    const preset = RESOLUTION_PRESETS[id];
    if (!preset) return;
    if (id === this.resolutionPresetState) return;

    this.resolutionPresetState = id;
    this.widthState = preset.width;
    this.heightState = preset.height;
    ({
      chromaKeyHeight: this.chromaKeyHeightState,
      visualizationHeight: this.visualizationHeightState,
    } = this.splitHeight(preset.height));
    this.p.resizeCanvas(preset.width, preset.height);
    this.notify();
  }

  /** Switches the Active Scene: tears down the outgoing Scene, sets up the incoming one. */
  selectScene(id: string): void {
    if (id === this.activeScene?.id) return;
    const scene = this.registry.get(id);
    if (!scene) return;
    this.activateScene(scene);
  }

  /** Shows or hides the Chroma Key area at engine level, affecting all Scenes uniformly. */
  setChromaKeyVisible(visible: boolean): void {
    if (visible === this.chromaKeyVisibleState) return;
    this.chromaKeyVisibleState = visible;
    this.notify();
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

  private splitHeight(height: number): { chromaKeyHeight: number; visualizationHeight: number } {
    const chromaKeyHeight = height * this.chromaKeyRatio;
    return { chromaKeyHeight, visualizationHeight: height - chromaKeyHeight };
  }

  private activateScene(scene: Scene): void {
    this.activeScene?.teardown();
    this.activeScene = scene;
    this.sceneStartMillis = this.p.millis();
    this.lastFrameMillis = this.sceneStartMillis;
    scene.setup(this.buildContext(0, 0));
    this.cachedParams = this.computeActiveParams();
    this.notify();
  }

  private computeActiveParams(): ActiveParam[] {
    const scene = this.activeScene;
    if (!scene) return [];
    const values = this.paramValues.get(scene.id) ?? {};
    return scene.params.map((spec) => ({ spec, value: values[spec.key] ?? spec.default }));
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
    this.cachedDevices = inputs.map(({ id, name }) => ({ id, label: name }));
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
    this.noteActivityTick += 1;
    this.notify();
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
    if (this.chromaKeyVisibleState) {
      p.noStroke();
      p.fill(...CHROMA_KEY_GREEN);
      p.rect(0, this.visualizationHeight, this.width, this.chromaKeyHeight);
    }

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
