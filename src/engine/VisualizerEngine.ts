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

/** Single versioned key holding the whole remembered setup (Scene, params, Device, etc). */
export const STORAGE_KEY = 'midiviz.v1';

/** Shape written to/read from `STORAGE_KEY`. Device is remembered by name, not id. */
export interface PersistedStateV1 {
  version: 1;
  activeSceneId: string | null;
  paramValues: Record<string, Record<string, ParamValue>>;
  deviceName: string | null;
  resolutionPreset: ResolutionPresetId;
  chromaKeyVisible: boolean;
}

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
  // The user's remembered Device preference, by name: set on an explicit
  // selectDevice()/restore() call, consulted whenever Devices (re)connect. A
  // hot-unplug never clears this, so the preference survives the Device
  // being temporarily absent (see unwireActiveDevice).
  private rememberedDeviceName: string | null = null;
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
        const raw = this.storage?.getItem(STORAGE_KEY);
        if (raw) {
          try {
            this.restore(JSON.parse(raw));
          } catch {
            // Corrupt persisted state; fall through to defaults below.
          }
        }
        if (!this.activeScene) {
          const [firstScene] = this.registry.list();
          if (firstScene) this.activateScene(firstScene);
        }
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
    this.persist();
    this.notify();
  }

  /** Resizes the internal render buffer to `id`'s dimensions. Never recreates the canvas. */
  setResolutionPreset(id: ResolutionPresetId): void {
    if (!RESOLUTION_PRESETS[id]) return;
    if (!this.applyResolutionPreset(id)) return;
    this.persist();
    this.notify();
  }

  /** Switches the Active Scene: tears down the outgoing Scene, sets up the incoming one. */
  selectScene(id: string): void {
    if (id === this.activeScene?.id) return;
    const scene = this.registry.get(id);
    if (!scene) return;
    this.activateScene(scene);
    this.persist();
  }

  /** Shows or hides the Chroma Key area at engine level, affecting all Scenes uniformly. */
  setChromaKeyVisible(visible: boolean): void {
    if (visible === this.chromaKeyVisibleState) return;
    this.chromaKeyVisibleState = visible;
    this.persist();
    this.notify();
  }

  /** Selects the single Device the engine binds MIDI message handlers to. */
  selectDevice(id: string): void {
    if (!this.midiAccess) return;
    if (id === this.selectedDeviceId) return;
    const input = this.midiAccess.inputs.find((candidate) => candidate.id === id);
    if (!input) return;
    this.wireDevice(id);
    this.rememberedDeviceName = input.name;
    this.persist();
    this.notify();
  }

  /** Snapshots the whole remembered setup. Pairs with `restore()` to round-trip via storage. */
  serialize(): PersistedStateV1 {
    const paramValues: Record<string, Record<string, ParamValue>> = {};
    for (const [sceneId, values] of this.paramValues) paramValues[sceneId] = { ...values };
    return {
      version: 1,
      activeSceneId: this.activeScene?.id ?? null,
      paramValues,
      deviceName: this.rememberedDeviceName,
      resolutionPreset: this.resolutionPresetState,
      chromaKeyVisible: this.chromaKeyVisibleState,
    };
  }

  /** Applies a persisted snapshot: params clamp to current Scene schemas, unknown keys/ids/names are dropped. */
  restore(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const state = data as Partial<PersistedStateV1>;
    if (state.version !== 1) return;

    if (state.paramValues && typeof state.paramValues === 'object') {
      const savedByScene = state.paramValues as Record<string, unknown>;
      for (const scene of this.registry.list()) {
        const saved = savedByScene[scene.id];
        if (!saved || typeof saved !== 'object') continue;
        const current = this.paramValues.get(scene.id);
        if (!current) continue;
        const savedValues = saved as Record<string, ParamValue>;
        for (const spec of scene.params) {
          const value = savedValues[spec.key];
          if (value === undefined) continue;
          const clamped = clampParamValue(spec, value);
          if (clamped !== undefined) current[spec.key] = clamped;
        }
      }
    }

    if (typeof state.chromaKeyVisible === 'boolean') {
      this.chromaKeyVisibleState = state.chromaKeyVisible;
    }

    if (
      typeof state.resolutionPreset === 'string' &&
      state.resolutionPreset in RESOLUTION_PRESETS
    ) {
      this.applyResolutionPreset(state.resolutionPreset as ResolutionPresetId);
    }

    if (typeof state.activeSceneId === 'string') {
      const scene = this.registry.get(state.activeSceneId);
      if (scene && scene !== this.activeScene) this.activateScene(scene);
    }

    this.applyPreferredDeviceName(typeof state.deviceName === 'string' ? state.deviceName : null);

    this.cachedParams = this.computeActiveParams();
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

  /** Resizes the render buffer to `id`'s dimensions; a no-op if already active. Returns whether it changed. */
  private applyResolutionPreset(id: ResolutionPresetId): boolean {
    if (id === this.resolutionPresetState) return false;
    const preset = RESOLUTION_PRESETS[id];
    this.resolutionPresetState = id;
    this.widthState = preset.width;
    this.heightState = preset.height;
    ({
      chromaKeyHeight: this.chromaKeyHeightState,
      visualizationHeight: this.visualizationHeightState,
    } = this.splitHeight(preset.height));
    this.p.resizeCanvas(preset.width, preset.height);
    return true;
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

  private persist(): void {
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
  }

  /** Remembers `name` as the Device preference and reconciles against Devices already connected. */
  private applyPreferredDeviceName(name: string | null): void {
    this.rememberedDeviceName = name;
    if (!this.midiAccess) return;
    const match = name ? this.midiAccess.inputs.find((input) => input.name === name) : undefined;
    if (match) {
      if (match.id !== this.selectedDeviceId) this.wireDevice(match.id);
    } else if (!this.selectedDeviceId) {
      this.syncDevices();
    }
  }

  private async initMidi(createMidi: MidiFactory): Promise<void> {
    try {
      this.midiAccess = await createMidi();
    } catch {
      this.midiAccess = null;
      return;
    }
    this.unsubscribeDeviceChange = this.midiAccess.onDeviceChange(() => this.syncDevices());
    this.syncDevices();
  }

  /** Reconciles the active Device against the current Device list (startup + hot-plug). */
  private syncDevices(): void {
    const inputs = this.midiAccess?.inputs ?? [];
    this.cachedDevices = inputs.map(({ id, name }) => ({ id, label: name }));
    const stillPresent = inputs.some((input) => input.id === this.selectedDeviceId);
    if (this.selectedDeviceId && !stillPresent) {
      this.unwireActiveDevice();
    }

    if (!this.selectedDeviceId) {
      const preferred = this.rememberedDeviceName
        ? inputs.find((input) => input.name === this.rememberedDeviceName)
        : undefined;
      const nextId = preferred ? preferred.id : inputs[0]?.id;
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
  }

  // Leaves rememberedDeviceName untouched: an unplug is transient, and the
  // user's preference should survive it (see the field's doc comment).
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
