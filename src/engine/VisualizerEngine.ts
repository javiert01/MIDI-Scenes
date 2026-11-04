import p5 from 'p5';
import type { P5Factory, P5Like } from './types';
import type { NoteEvent, ParamSpec, ParamValue, Scene, SceneContext } from './scene';
import { SceneRegistry } from './SceneRegistry';
import { CRYSTAL_COLORS, CrystalField, hexToRgb } from './crystals';
import { type PianoBand, drawPianoPreview, noteAtCanvasPoint } from './pianoPreview';
import { noteNumberToName, parseNoteMessage } from './midi';
import { clampOctaveShift, noteForKey, octaveLabel, octaveShiftForKey } from './virtualKeyboard';
import type { MidiAccessLike, MidiFactory } from './midiTypes';
import { defaultMidiFactory } from './webMidiAdapter';
import { PreviewSynth, type AudioContextFactory } from './previewSynth';
import { NoteLedger, type NoteSource, type ReleaseResult } from './noteLedger';

/** Fixed velocity (0–127) every synthetic Virtual Input note carries; see ADR-0005. */
const VIRTUAL_INPUT_RAW_VELOCITY = 100;

/**
 * Inputs with no use for letter keys. A click leaves focus on them, so treating
 * them as text entry would silence the Virtual Input right after touching a control.
 */
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'color', 'button']);

/** Whether a DOM node is a text-entry target, so Virtual Input keys don't fire while typing. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!el || !el.tagName) return false;
  return (
    (el.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.has(el.type ?? '')) ||
    el.tagName === 'SELECT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable === true
  );
}

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

function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const DEFAULT_CRYSTAL_LEFT_COLOR = rgbToHex(CRYSTAL_COLORS.left);
const DEFAULT_CRYSTAL_RIGHT_COLOR = rgbToHex(CRYSTAL_COLORS.right);
const DEFAULT_CRYSTALS_VISIBLE = true;
const DEFAULT_CRYSTALS_OPACITY = 1;
const DEFAULT_VIRTUAL_INPUT_ENABLED = false;
const DEFAULT_SOUND_ENABLED = true;

/** Single versioned key holding the whole remembered setup (Scene, params, Device, etc). */
export const STORAGE_KEY = 'midiviz.v1';

/**
 * Sentinel id for the selectable "No Scene" entry: no Active Scene draws, leaving
 * only the background and the Overlays. Reserved — no real Scene may use it.
 * Persisted as a null `activeSceneId`.
 */
export const NO_SCENE_ID = 'none';
const NO_SCENE_LABEL = 'No Scene';

/**
 * Which single Overlay fills the shared keyboard band at the canvas bottom.
 * Piano Preview and the Chroma Key green occupy the same band, so at most one
 * shows: `'piano'` (the Piano Preview), `'chroma'` (the green fill), or `'none'`.
 */
export type KeyboardBand = 'none' | 'piano' | 'chroma';

const KEYBOARD_BANDS: readonly KeyboardBand[] = ['none', 'piano', 'chroma'];

/** The band a fresh load starts on: the Piano Preview stands in for the piano-hands footage. */
const DEFAULT_KEYBOARD_BAND: KeyboardBand = 'piano';

/** Legacy persisted fields (pre–keyboard-band) still read on load to migrate old snapshots. */
interface LegacyBandFields {
  chromaKeyVisible?: unknown;
  pianoPreviewVisible?: unknown;
}

/** Shape written to/read from `STORAGE_KEY`. Device is remembered by name, not id. */
export interface PersistedStateV1 {
  version: 1;
  activeSceneId: string | null;
  paramValues: Record<string, Record<string, ParamValue>>;
  deviceName: string | null;
  resolutionPreset: ResolutionPresetId;
  /** Which Overlay fills the shared keyboard band. Supersedes the old chroma/piano booleans. */
  keyboardBand: KeyboardBand;
  crystalsVisible: boolean;
  /** 0-1, applied to Crystals on every Scene and No Scene alike. */
  crystalsOpacity: number;
  /** `#RRGGBB` — Crystal color for notes on the left half of the keyboard. */
  crystalsLeftColor: string;
  /** `#RRGGBB` — Crystal color for notes on the right half of the keyboard. */
  crystalsRightColor: string;
  /** Whether the Virtual Input's surfaces are live. Octave shift is not persisted. */
  virtualInputEnabled: boolean;
  /** Whether the Preview Synth sounds Virtual Input notes. Defaults to on when absent (see ADR-0007). */
  soundEnabled: boolean;
}

/**
 * Resolves the keyboard band from a persisted snapshot. A modern snapshot carries
 * `keyboardBand` directly; a legacy one carries the old independent `chromaKeyVisible`
 * / `pianoPreviewVisible` booleans (each defaulting to on, as they did then), which
 * migrate here — a "both on" legacy state resolves to Piano Preview (it wins the band).
 */
function resolveKeyboardBand(state: Partial<PersistedStateV1> & LegacyBandFields): KeyboardBand {
  if (typeof state.keyboardBand === 'string' && KEYBOARD_BANDS.includes(state.keyboardBand)) {
    return state.keyboardBand;
  }
  const piano = typeof state.pianoPreviewVisible === 'boolean' ? state.pianoPreviewVisible : true;
  const chroma = typeof state.chromaKeyVisible === 'boolean' ? state.chromaKeyVisible : true;
  if (piano) return 'piano';
  if (chroma) return 'chroma';
  return 'none';
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

/** Whether Devices can be listed at all: awaiting access, have it, or refused/unsupported. */
export type MidiStatus = 'connecting' | 'ready' | 'unavailable';

export interface VisualizerEngineOptions {
  width?: number;
  height?: number;
  chromaKeyRatio?: number;
  createP5?: P5Factory;
  scenes?: Scene[];
  createMidi?: MidiFactory;
  storage?: Storage;
  /** Injected AudioContext factory for the Preview Synth; defaults to the real browser context. */
  createAudioContext?: AudioContextFactory;
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
  // The single Overlay filling the shared keyboard band. Piano Preview and the
  // Chroma Key green occupy the same band, so they are one mutually-exclusive
  // choice rather than two independent booleans (see issue #22).
  private keyboardBandState: KeyboardBand = DEFAULT_KEYBOARD_BAND;
  private crystalsVisibleState = DEFAULT_CRYSTALS_VISIBLE;
  private crystalsOpacityState = DEFAULT_CRYSTALS_OPACITY;
  private crystalsLeftColorState = DEFAULT_CRYSTAL_LEFT_COLOR;
  private crystalsRightColorState = DEFAULT_CRYSTAL_RIGHT_COLOR;

  // The Virtual Input: synthetic notes from the computer keyboard and Piano
  // Preview clicks, gated by one enable flag (see ADR-0005). Both surfaces feed
  // the same dispatch core a real Device does.
  private virtualInputEnabledState = DEFAULT_VIRTUAL_INPUT_ENABLED;
  private virtualOctaveShift = 0;
  // The Preview Synth voices the Virtual Input's surfaces (keyboard + Piano
  // Preview clicks), hooked at those surfaces rather than the source-agnostic
  // dispatch core so a real Device never sounds (ADR-0007). Its own enable flag
  // tracks `soundEnabled && virtualInputEnabled` via syncSynthEnabled().
  private soundEnabledState = DEFAULT_SOUND_ENABLED;
  private readonly synth: PreviewSynth;
  // The Holds of the sources that sound: the synth has one voice per note shared
  // by both Virtual Input surfaces, so a voice ends only on its note's last
  // sounding Hold. Kept apart from `notes` because what sounds and what shows can
  // differ (a Device's Holds light keys but never sound here).
  private readonly soundingNotes = new NoteLedger();
  // Physical key code -> the exact note it triggered, so keyup releases that same
  // note even after an octave shift.
  private readonly virtualHeldKeys = new Map<string, number>();
  // The note a held mouse press is currently sounding on the Piano Preview, if any.
  private virtualMouseNote: number | null = null;
  // Bound window listeners for the keyboard surface + stuck-note cleanup, removed on destroy.
  private readonly windowListeners: Array<[string, EventListener]> = [];

  // The engine owns the Crystal Overlay: a note-on spawns a Crystal regardless
  // of the Active Scene, so Crystals react on every Scene and on No Scene.
  private readonly crystals = new CrystalField();
  // Set when a Scene draws Crystals itself via ctx.drawCrystals(); tells
  // renderFrame to skip the engine's default top-of-Scene Crystal draw.
  private crystalsDrawnThisFrame = false;
  // Every source's Holds (a Device and the Virtual Input can both press note 60
  // at once). Crystals react only to a note's first Hold and last release, so one
  // source letting go never cuts a note another still holds (see ADR-0005). Its
  // held set also lights the Piano Preview's keys, independent of the Crystal
  // pool, so the lighting survives Crystal pool recycling.
  private readonly notes = new NoteLedger();

  private readonly storage?: Storage;
  private settingsSaveCountState = 0;
  private settingsSaveFailedState = false;
  private midiAccess: MidiAccessLike | null = null;
  private midiStatusState: MidiStatus = 'connecting';
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
  // MIDI access can resolve after destroy() (StrictMode destroys the first engine
  // while the permission is still pending), and must then wire nothing.
  private destroyed = false;

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

    // Starts disabled: audio needs both Sound on and the Virtual Input enabled,
    // and the Virtual Input defaults off. syncSynthEnabled() (from restore and the
    // toggles) is the single source of the derived enable flag thereafter.
    this.synth = new PreviewSynth({
      createAudioContext: options.createAudioContext,
      enabled: false,
    });

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
        let restored = false;
        if (raw) {
          try {
            restored = this.restore(JSON.parse(raw));
          } catch {
            // Corrupt persisted state; fall through to the first-ever-load default.
          }
        }
        // A valid snapshot fully decides the Active Scene (a real Scene, or No
        // Scene from a null activeSceneId). Only a first-ever load with nothing
        // valid persisted defaults to the first Scene.
        if (!restored && !this.activeScene) {
          this.activateFirstScene();
          this.notify();
        }
      };
      p.draw = () => {
        this.renderFrame(p);
      };
      // Piano Preview click surface of the Virtual Input: press starts a note,
      // dragging glissandos across keys. p5 reports mouseX/Y in buffer coords.
      p.mousePressed = () => this.handleCanvasPointer();
      p.mouseDragged = () => this.handleCanvasPointer();
    }, container);

    this.bindWindowListeners();
    void this.initMidi(options.createMidi ?? defaultMidiFactory);
  }

  /** Binds the Virtual Input's keyboard surface + stuck-note cleanup to window (guarded for tests/SSR). */
  private bindWindowListeners(): void {
    if (typeof window === 'undefined') return;
    const onKeyDown = ((event: KeyboardEvent) => this.handleKeyDown(event)) as EventListener;
    const onKeyUp = ((event: KeyboardEvent) => this.handleKeyUp(event)) as EventListener;
    const onBlur = (() => this.releaseVirtualNotes()) as EventListener;
    const onMouseUp = (() => this.setMouseNote(null)) as EventListener;
    const bound: Array<[string, EventListener]> = [
      ['keydown', onKeyDown],
      ['keyup', onKeyUp],
      ['blur', onBlur],
      ['mouseup', onMouseUp],
    ];
    for (const [type, listener] of bound) {
      window.addEventListener(type, listener);
      this.windowListeners.push([type, listener]);
    }
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

  /** Scenes available for the sidebar to list, led by the selectable No Scene entry. */
  get scenes(): SceneDescriptor[] {
    return [
      { id: NO_SCENE_ID, label: NO_SCENE_LABEL },
      ...this.registry.list().map(({ id, label }) => ({ id, label })),
    ];
  }

  /** The Active Scene's id, or `NO_SCENE_ID` when No Scene is active. */
  get activeSceneId(): string {
    return this.activeScene?.id ?? NO_SCENE_ID;
  }

  /** MIDI Devices available for the sidebar to list. */
  get devices(): DeviceDescriptor[] {
    return this.cachedDevices;
  }

  get activeDeviceId(): string | null {
    return this.selectedDeviceId;
  }

  get midiStatus(): MidiStatus {
    return this.midiStatusState;
  }

  /** The Device the user explicitly picked, by name, whether or not it is connected right now. */
  get savedDeviceName(): string | null {
    return this.rememberedDeviceName;
  }

  /** Bumped on every successful save, so the sidebar can confirm a change was kept. */
  get settingsSaveCount(): number {
    return this.settingsSaveCountState;
  }

  /** Whether the latest save failed (storage blocked or full); changes then last only this visit. */
  get settingsSaveFailed(): boolean {
    return this.settingsSaveFailedState;
  }

  /** Whether every Crystals setting still has its default value. */
  get crystalsAtDefaults(): boolean {
    return (
      this.crystalsVisibleState === DEFAULT_CRYSTALS_VISIBLE &&
      this.crystalsOpacityState === DEFAULT_CRYSTALS_OPACITY &&
      this.crystalsLeftColorState === DEFAULT_CRYSTAL_LEFT_COLOR &&
      this.crystalsRightColorState === DEFAULT_CRYSTAL_RIGHT_COLOR
    );
  }

  /** Which Overlay fills the shared keyboard band: `'none'`, `'piano'`, or `'chroma'`. */
  get keyboardBand(): KeyboardBand {
    return this.keyboardBandState;
  }

  /** Whether the Chroma Key green fills the keyboard band. Derived from `keyboardBand`. */
  get chromaKeyVisible(): boolean {
    return this.keyboardBandState === 'chroma';
  }

  /** Whether the Crystal Overlay renders, on every Scene and on No Scene alike. */
  get crystalsVisible(): boolean {
    return this.crystalsVisibleState;
  }

  /** Global opacity (0-1) applied to Crystals wherever they render. */
  get crystalsOpacity(): number {
    return this.crystalsOpacityState;
  }

  /** `#RRGGBB` — Crystal color for notes on the left half of the keyboard. */
  get crystalsLeftColor(): string {
    return this.crystalsLeftColorState;
  }

  /** `#RRGGBB` — Crystal color for notes on the right half of the keyboard. */
  get crystalsRightColor(): string {
    return this.crystalsRightColorState;
  }

  /** Whether the Piano Preview fills the keyboard band. Derived from `keyboardBand`. */
  get pianoPreviewVisible(): boolean {
    return this.keyboardBandState === 'piano';
  }

  /** Whether the Virtual Input's surfaces (computer keyboard + Piano Preview clicks) are live. Default off. */
  get virtualInputEnabled(): boolean {
    return this.virtualInputEnabledState;
  }

  /** The mapped computer-keyboard octave, e.g. "C4 – C5", for the sidebar indicator. */
  get virtualInputOctaveLabel(): string {
    return octaveLabel(this.virtualOctaveShift);
  }

  /** Whether the Preview Synth sounds Virtual Input notes. Audio also requires the Virtual Input on. Default on. */
  get soundEnabled(): boolean {
    return this.soundEnabledState;
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

  /**
   * Switches the Active Scene: tears down the outgoing Scene, sets up the incoming
   * one. Selecting `NO_SCENE_ID` tears the Active Scene down and runs none — leaving
   * only the background and the Overlays.
   */
  selectScene(id: string): void {
    if (id === NO_SCENE_ID) {
      if (!this.activeScene) return;
      this.deactivateScene();
      this.persist();
      this.notify();
      return;
    }
    if (id === this.activeScene?.id) return;
    const scene = this.registry.get(id);
    if (!scene) return;
    this.activateScene(scene);
    this.persist();
    this.notify();
  }

  /** Restores one Scene's params to their defaults. */
  resetSceneParams(sceneId: string): void {
    const scene = this.registry.get(sceneId);
    if (!scene) return;
    this.paramValues.set(sceneId, defaultParamValues(scene.params));
    if (scene === this.activeScene) this.cachedParams = this.computeActiveParams();
    this.persist();
    this.notify();
  }

  /** Restores the Crystals' visibility, opacity and colors to their defaults. */
  resetCrystals(): void {
    this.applyDefaultCrystals();
    this.persist();
    this.notify();
  }

  /**
   * Restores every setting to its first-load default, including the Active
   * Scene. The saved Device stays: it describes the user's hardware, and the
   * next plug-in would only have to reselect it.
   */
  resetAllSettings(): void {
    for (const scene of this.registry.list()) {
      this.paramValues.set(scene.id, defaultParamValues(scene.params));
    }
    this.applyDefaultCrystals();
    if (this.keyboardBandState === 'piano') this.setMouseNote(null);
    this.keyboardBandState = DEFAULT_KEYBOARD_BAND;
    this.applyResolutionPreset(DEFAULT_PRESET);
    if (this.virtualInputEnabledState) this.releaseVirtualNotes();
    this.virtualInputEnabledState = DEFAULT_VIRTUAL_INPUT_ENABLED;
    this.soundEnabledState = DEFAULT_SOUND_ENABLED;
    this.syncSynthEnabled();
    if (this.registry.list().length > 0) this.activateFirstScene();
    else this.deactivateScene();
    this.cachedParams = this.computeActiveParams();
    this.persist();
    this.notify();
  }

  private applyDefaultCrystals(): void {
    this.crystalsVisibleState = DEFAULT_CRYSTALS_VISIBLE;
    this.crystalsOpacityState = DEFAULT_CRYSTALS_OPACITY;
    this.crystalsLeftColorState = DEFAULT_CRYSTAL_LEFT_COLOR;
    this.crystalsRightColorState = DEFAULT_CRYSTAL_RIGHT_COLOR;
    this.applyCrystalColors();
  }

  /**
   * Selects the single Overlay filling the shared keyboard band. Because Piano
   * Preview and the Chroma Key green share that band, choosing one clears the
   * other; `'none'` clears both. Leaving `'piano'` removes the click surface, so
   * any note a Piano Preview click is holding is released.
   */
  setKeyboardBand(band: KeyboardBand): void {
    if (band === this.keyboardBandState) return;
    if (this.keyboardBandState === 'piano') this.setMouseNote(null);
    this.keyboardBandState = band;
    this.persist();
    this.notify();
  }

  /** Shows or hides the Crystal Overlay on every Scene and No Scene alike. */
  setCrystalsVisible(visible: boolean): void {
    if (visible === this.crystalsVisibleState) return;
    this.crystalsVisibleState = visible;
    this.persist();
    this.notify();
  }

  /** Sets the global Crystals opacity, clamped to [0, 1]. */
  setCrystalsOpacity(opacity: number): void {
    const clamped = Math.min(1, Math.max(0, opacity));
    if (clamped === this.crystalsOpacityState) return;
    this.crystalsOpacityState = clamped;
    this.persist();
    this.notify();
  }

  /** Sets the Crystal color for notes on the left half of the keyboard, as `#RRGGBB`. */
  setCrystalsLeftColor(hex: string): void {
    if (hex === this.crystalsLeftColorState) return;
    this.crystalsLeftColorState = hex;
    this.applyCrystalColors();
    this.persist();
    this.notify();
  }

  /** Sets the Crystal color for notes on the right half of the keyboard, as `#RRGGBB`. */
  setCrystalsRightColor(hex: string): void {
    if (hex === this.crystalsRightColorState) return;
    this.crystalsRightColorState = hex;
    this.applyCrystalColors();
    this.persist();
    this.notify();
  }

  /** Pushes the current left/right hex colors into the CrystalField as parsed RGB. */
  private applyCrystalColors(): void {
    this.crystals.setColors(
      hexToRgb(this.crystalsLeftColorState, CRYSTAL_COLORS.left),
      hexToRgb(this.crystalsRightColorState, CRYSTAL_COLORS.right),
    );
  }

  /**
   * Enables or disables the Virtual Input. Disabling releases every note its
   * surfaces are holding, so no synthetic note is left stuck. The mapped octave
   * is deliberately not persisted — it resets on reload.
   */
  setVirtualInputEnabled(enabled: boolean): void {
    if (enabled === this.virtualInputEnabledState) return;
    this.virtualInputEnabledState = enabled;
    if (!enabled) this.releaseVirtualNotes();
    this.syncSynthEnabled();
    this.persist();
    this.notify();
  }

  /**
   * Toggles the Preview Synth's Sound setting. Audio still only sounds when the
   * Virtual Input is also enabled. Turning Sound off immediately silences any held
   * voices; turning it on affects only subsequent notes.
   */
  setSoundEnabled(enabled: boolean): void {
    if (enabled === this.soundEnabledState) return;
    this.soundEnabledState = enabled;
    this.syncSynthEnabled();
    this.persist();
    this.notify();
  }

  /** Drives the synth's enable flag from both gates: it sounds only when Sound *and* the Virtual Input are on. */
  private syncSynthEnabled(): void {
    this.synth.setEnabled(this.soundEnabledState && this.virtualInputEnabledState);
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
      keyboardBand: this.keyboardBandState,
      crystalsVisible: this.crystalsVisibleState,
      crystalsOpacity: this.crystalsOpacityState,
      crystalsLeftColor: this.crystalsLeftColorState,
      crystalsRightColor: this.crystalsRightColorState,
      virtualInputEnabled: this.virtualInputEnabledState,
      soundEnabled: this.soundEnabledState,
    };
  }

  /**
   * Applies a persisted snapshot: params clamp to current Scene schemas, unknown
   * param keys/Device names are dropped. A null `activeSceneId` restores No Scene;
   * an unknown Scene id falls back to the first registered Scene. Returns whether a
   * valid v1 snapshot was applied, so first-ever-load defaulting can be skipped.
   */
  restore(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;
    const state = data as Partial<PersistedStateV1>;
    if (state.version !== 1) return false;

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

    this.keyboardBandState = resolveKeyboardBand(state);

    if (typeof state.crystalsVisible === 'boolean') {
      this.crystalsVisibleState = state.crystalsVisible;
    }

    if (typeof state.crystalsOpacity === 'number' && !Number.isNaN(state.crystalsOpacity)) {
      this.crystalsOpacityState = Math.min(1, Math.max(0, state.crystalsOpacity));
    }

    if (typeof state.crystalsLeftColor === 'string') {
      this.crystalsLeftColorState = state.crystalsLeftColor;
    }

    if (typeof state.crystalsRightColor === 'string') {
      this.crystalsRightColorState = state.crystalsRightColor;
    }

    this.applyCrystalColors();

    if (typeof state.virtualInputEnabled === 'boolean') {
      this.virtualInputEnabledState = state.virtualInputEnabled;
    }

    // Absent in pre-Preview-Synth snapshots: default to on (no version bump).
    if (typeof state.soundEnabled === 'boolean') {
      this.soundEnabledState = state.soundEnabled;
    }
    this.syncSynthEnabled();

    if (
      typeof state.resolutionPreset === 'string' &&
      state.resolutionPreset in RESOLUTION_PRESETS
    ) {
      this.applyResolutionPreset(state.resolutionPreset as ResolutionPresetId);
    }

    if (typeof state.activeSceneId === 'string') {
      const scene = this.registry.get(state.activeSceneId);
      if (scene) {
        if (scene !== this.activeScene) this.activateScene(scene);
      } else {
        // Unknown Scene id: fall back to the first registered Scene.
        this.activateFirstScene();
      }
    } else if (state.activeSceneId === null) {
      // Explicit No Scene: leave no Active Scene rather than defaulting to one.
      this.deactivateScene();
    }

    this.applyPreferredDeviceName(typeof state.deviceName === 'string' ? state.deviceName : null);

    this.cachedParams = this.computeActiveParams();
    this.notify();
    return true;
  }

  /** Registers a listener notified whenever engine state (e.g. Active Scene) changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stops the draw loop and removes the p5 canvas. Call on unmount. */
  destroy(): void {
    this.destroyed = true;
    this.activeScene?.teardown();
    this.synth.dispose();
    this.unwireActiveDevice();
    this.unsubscribeDeviceChange?.();
    if (typeof window !== 'undefined') {
      for (const [type, listener] of this.windowListeners) {
        window.removeEventListener(type, listener);
      }
    }
    this.windowListeners.length = 0;
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
    // Crystal columns are relative to the old width; drop them so none linger off-column.
    this.crystals.reset();
    // A note still held keeps its lit key and owes a release, so it restarts at its new column.
    for (const note of this.notes.held) this.crystals.noteOn(note, preset.width);
    return true;
  }

  private activateScene(scene: Scene): void {
    this.activeScene?.teardown();
    this.activeScene = scene;
    this.sceneStartMillis = this.p.millis();
    this.lastFrameMillis = this.sceneStartMillis;
    scene.setup(this.buildContext(0, 0));
    this.cachedParams = this.computeActiveParams();
  }

  /** Activates the first registered Scene, if any. A no-op if it is already active. */
  private activateFirstScene(): void {
    const [firstScene] = this.registry.list();
    if (firstScene && firstScene !== this.activeScene) this.activateScene(firstScene);
  }

  /** Tears the Active Scene down and runs none (No Scene). A no-op if already empty. */
  private deactivateScene(): void {
    if (!this.activeScene) return;
    this.activeScene.teardown();
    this.activeScene = null;
    this.cachedParams = [];
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
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
      this.settingsSaveFailedState = false;
      this.settingsSaveCountState += 1;
    } catch {
      // Storage blocked or full: the change still applies, for this visit only.
      this.settingsSaveFailedState = true;
    }
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
      const access = await createMidi();
      if (this.destroyed) return;
      this.midiAccess = access;
    } catch {
      if (this.destroyed) return;
      this.midiAccess = null;
      this.midiStatusState = 'unavailable';
      this.notify();
      return;
    }
    this.midiStatusState = 'ready';
    this.unsubscribeDeviceChange = this.midiAccess.onDeviceChange(() => this.syncDevices());
    this.syncDevices();
  }

  /** Reconciles the active Device against the current Device list (startup + hot-plug). */
  private syncDevices(): void {
    const inputs = this.midiAccess?.inputs ?? [];
    this.cachedDevices = inputs.map(({ id, name }) => ({ id, label: name }));
    const stillPresent = inputs.some((input) => input.id === this.selectedDeviceId);
    if (this.selectedDeviceId && !stillPresent) {
      this.releaseDeviceNotes();
      this.unwireActiveDevice();
    }

    // The saved Device wins whenever it is present, so one that reconnects takes
    // over again from a fallback chosen while it was away.
    const preferred = this.rememberedDeviceName
      ? inputs.find((input) => input.name === this.rememberedDeviceName)
      : undefined;
    if (preferred) {
      if (preferred.id !== this.selectedDeviceId) this.wireDevice(preferred.id);
    } else if (!this.selectedDeviceId && inputs[0]) {
      this.wireDevice(inputs[0].id);
    }

    this.notify();
  }

  // Only called once midiAccess has resolved (initMidi/syncDevices/selectDevice all guard it).
  private wireDevice(id: string): void {
    if (!this.midiAccess) return;
    this.releaseDeviceNotes();
    this.unwireActiveDevice();
    this.selectedDeviceId = id;
    this.unsubscribeMessage = this.midiAccess.onMessage(id, (data) => this.handleRawMessage(data));
  }

  /** Ends every note the outgoing Device still holds, as its note-offs will never arrive. */
  private releaseDeviceNotes(): void {
    this.releaseSource('device');
  }

  // Leaves rememberedDeviceName untouched: an unplug is transient, and the
  // user's preference should survive it (see the field's doc comment).
  private unwireActiveDevice(): void {
    this.unsubscribeMessage?.();
    this.unsubscribeMessage = null;
    this.selectedDeviceId = null;
  }

  private handleRawMessage(data: number[]): void {
    const parsed = parseNoteMessage(data);
    if (!parsed) return;
    // A note-off for a key pressed before this Device was wired comes back from
    // the ledger as unmatched, so it takes no other source's Hold.
    if (parsed.type === 'noteon') this.dispatchNoteOn('device', parsed.event);
    else this.dispatchNoteOff('device', parsed.event);
  }

  // The single note-dispatch core: real Device messages and the Virtual Input's
  // synthetic notes both flow through here, so every downstream reaction
  // (Crystals, held-key lighting, Scene callbacks, activity tick) is identical
  // no matter which source a note came from. The source only says whose Hold it
  // is; NoteEvent carries no source tag (ADR-0005, ADR-0009).
  private dispatchNoteOn(source: NoteSource, event: NoteEvent): void {
    const ctx = this.buildContext(this.p.millis() - this.sceneStartMillis, 0);
    // Only a note's first Hold spawns its Crystal; a second source pressing the
    // same note (e.g. Virtual Input over a held Device note) never respawns it.
    // Scene callbacks and the activity tick stay per-event.
    if (this.notes.press(source, event.note) === 'first') {
      this.crystals.noteOn(event.note, this.width);
    }
    this.activeScene?.onNoteOn(event, ctx);
    this.noteActivityTick += 1;
    this.notify();
  }

  private dispatchNoteOff(source: NoteSource, event: NoteEvent): void {
    this.reactToRelease(event, this.notes.release(source, event.note));
  }

  /** Ends every Hold `source` has, reacting to each as if its note-off had arrived. */
  private releaseSource(source: NoteSource): void {
    for (const { note, result } of this.notes.releaseAll(source)) {
      this.reactToRelease(this.makeNoteEvent(note, 0), result);
    }
  }

  /**
   * Only a note's last release cuts its Crystal, so one source letting go never
   * darkens a note another still holds. Every release, unmatched included, still
   * reaches the Scene and the activity tick.
   */
  private reactToRelease(event: NoteEvent, result: ReleaseResult): void {
    if (result === 'last') this.crystals.noteOff(event.note);
    this.announceNoteOff(event);
  }

  /** The per-event half of a note-off: the Scene and activity tick. */
  private announceNoteOff(event: NoteEvent): void {
    const ctx = this.buildContext(this.p.millis() - this.sceneStartMillis, 0);
    this.activeScene?.onNoteOff(event, ctx);
    this.noteActivityTick += 1;
    this.notify();
  }

  /** Builds a synthetic NoteEvent for the Virtual Input, matching a parsed Device event's shape. */
  private makeNoteEvent(note: number, raw: number): NoteEvent {
    return { note, name: noteNumberToName(note), velocity: raw / 127, raw, channel: 1 };
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.virtualInputEnabledState) return;
    // OS key-repeat re-fires keydown; ignore it, and never fire while typing.
    if (event.repeat || isEditableTarget(event.target)) return;

    const shift = octaveShiftForKey(event.code);
    if (shift !== null) {
      const next = clampOctaveShift(this.virtualOctaveShift + shift);
      if (next !== this.virtualOctaveShift) {
        this.virtualOctaveShift = next;
        this.notify();
      }
      event.preventDefault();
      return;
    }

    if (this.virtualHeldKeys.has(event.code)) return;
    const note = noteForKey(event.code, this.virtualOctaveShift);
    if (note === null) return;
    this.virtualHeldKeys.set(event.code, note);
    this.dispatchNoteOn('keyboard', this.makeNoteEvent(note, VIRTUAL_INPUT_RAW_VELOCITY));
    // Preview Synth hooked at the surface, alongside dispatch — not in the core (ADR-0007).
    this.soundNoteOn('keyboard', note);
    event.preventDefault();
  }

  // Runs regardless of the enable flag so a key released after toggling off (or
  // after any earlier press) still clears its tracked note.
  private handleKeyUp(event: KeyboardEvent): void {
    const note = this.virtualHeldKeys.get(event.code);
    if (note === undefined) return;
    this.virtualHeldKeys.delete(event.code);
    this.dispatchNoteOff('keyboard', this.makeNoteEvent(note, 0));
    this.soundNoteOff('keyboard', note);
  }

  /** Sounds `note` for a Virtual Input surface. Every press retriggers the note's one voice. */
  private soundNoteOn(source: NoteSource, note: number): void {
    this.soundingNotes.press(source, note);
    this.synth.noteOn(note);
  }

  /** Silences `note` only on its last sounding Hold, so the other surface's Hold keeps it sounding. */
  private soundNoteOff(source: NoteSource, note: number): void {
    if (this.soundingNotes.release(source, note) === 'last') this.synth.noteOff(note);
  }

  /** Ends every sounding Hold `source` has, silencing each note no other source still sounds. */
  private silenceSource(source: NoteSource): void {
    for (const { note, result } of this.soundingNotes.releaseAll(source)) {
      if (result === 'last') this.synth.noteOff(note);
    }
  }

  /** Resolves the note under the cursor on the Piano Preview, gated by the enable flag + preview visibility. */
  private handleCanvasPointer(): void {
    if (!this.virtualInputEnabledState || this.keyboardBandState !== 'piano') {
      this.setMouseNote(null);
      return;
    }
    this.setMouseNote(noteAtCanvasPoint(this.p.mouseX, this.p.mouseY, this.pianoBand));
  }

  /** The Piano Preview's band rectangle, from the current canvas dimensions. */
  private get pianoBand(): PianoBand {
    return { width: this.width, top: this.visualizationHeight, height: this.chromaKeyHeight };
  }

  /** Moves the mouse-held note to `note` (or none), releasing the old note and pressing the new — the glissando seam. */
  private setMouseNote(note: number | null): void {
    if (note === this.virtualMouseNote) return;
    const previous = this.virtualMouseNote;
    this.virtualMouseNote = note;
    if (previous !== null) {
      this.dispatchNoteOff('pointer', this.makeNoteEvent(previous, 0));
      this.soundNoteOff('pointer', previous);
    }
    if (note !== null) {
      this.dispatchNoteOn('pointer', this.makeNoteEvent(note, VIRTUAL_INPUT_RAW_VELOCITY));
      this.soundNoteOn('pointer', note);
    }
  }

  /** Releases every Virtual-Input-originated note (keyboard + mouse), leaving Device notes untouched. */
  private releaseVirtualNotes(): void {
    this.virtualHeldKeys.clear();
    this.releaseSource('keyboard');
    // Window blur reaches only this path, never handleKeyUp, so the keyboard's
    // sounding Holds end here too. Releasing by source, rather than silencing the
    // whole synth, leaves any other source's voices sounding.
    this.silenceSource('keyboard');
    this.setMouseNote(null);
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
      crystals: this.crystals.all,
      drawCrystals: () => this.drawCrystals(),
    };
  }

  /** The Crystal-placement seam: a Scene calls this to draw Crystals in its own draw order. */
  private drawCrystals(): void {
    this.crystalsDrawnThisFrame = true;
    this.renderCrystals();
  }

  /** Draws the Crystal pool at the current global opacity, unless Crystals are toggled off. */
  private renderCrystals(): void {
    if (!this.crystalsVisibleState) return;
    this.crystals.draw(this.p, this.visualizationHeight, this.crystalsOpacityState);
  }

  private renderFrame(p: P5Like): void {
    p.background(BACKGROUND_GRAY);

    // Crystals advance every frame, independent of whether a Scene is active,
    // so the Overlay keeps living on No Scene. Visibility goes in because the
    // Overlay's own Dust must not fly on unseen while it is toggled off.
    this.crystals.update(this.visualizationHeight, this.crystalsVisibleState);
    this.crystalsDrawnThisFrame = false;

    if (this.activeScene) {
      const now = p.millis();
      const deltaTime = now - this.lastFrameMillis;
      const elapsed = now - this.sceneStartMillis;
      this.lastFrameMillis = now;

      const ctx = this.buildContext(elapsed, deltaTime);
      this.activeScene.update(ctx);
      this.activeScene.draw(ctx);
    }

    // The Scene may have drawn Crystals itself (via ctx.drawCrystals()) somewhere
    // in its own order; if it did not — and on No Scene — the engine draws them on top.
    if (!this.crystalsDrawnThisFrame) {
      this.renderCrystals();
    }

    // Drawn last: covers the Active Scene, any Scene bleed into the band, and Crystals.
    this.renderChromaKey();
    this.renderPianoPreview();
  }

  /** Fills the keyboard band with the Chroma Key green, unless another band is selected. */
  private renderChromaKey(): void {
    if (this.keyboardBandState !== 'chroma') return;
    this.p.noStroke();
    this.p.fill(...CHROMA_KEY_GREEN);
    this.p.rect(0, this.visualizationHeight, this.width, this.chromaKeyHeight);
  }

  /** Draws the Piano Preview Overlay filling the keyboard band, unless another band is selected. */
  private renderPianoPreview(): void {
    if (this.keyboardBandState !== 'piano') return;
    drawPianoPreview(this.p, this.pianoBand, this.notes.held, {
      left: hexToRgb(this.crystalsLeftColorState, CRYSTAL_COLORS.left),
      right: hexToRgb(this.crystalsRightColorState, CRYSTAL_COLORS.right),
    });
  }
}
