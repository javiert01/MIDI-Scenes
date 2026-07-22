import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SCENE_ID, STORAGE_KEY, VisualizerEngine } from '@/engine/VisualizerEngine';
import { CRYSTAL_COLORS } from '@/engine/crystals';
import type { P5Factory, P5Like } from '@/engine/types';
import type { ParamSpec, Scene, SceneContext, NoteEvent } from '@/engine/scene';
import type { MidiAccessLike, MidiInputLike, MidiMessageHandler } from '@/engine/midiTypes';

interface RecordedCall {
  name: string;
  args: unknown[];
}

class StubP5 implements P5Like {
  width = 0;
  height = 0;
  setup?: () => void;
  draw?: () => void;
  mouseX = 0;
  mouseY = 0;
  mousePressed?: () => void;
  mouseDragged?: () => void;
  calls: RecordedCall[] = [];
  private clock = 0;

  createCanvas(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.calls.push({ name: 'createCanvas', args: [w, h] });
  }

  resizeCanvas(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.calls.push({ name: 'resizeCanvas', args: [w, h] });
  }

  noStroke() {
    this.calls.push({ name: 'noStroke', args: [] });
  }

  stroke(...args: number[]) {
    this.calls.push({ name: 'stroke', args });
  }

  strokeWeight(weight: number) {
    this.calls.push({ name: 'strokeWeight', args: [weight] });
  }

  background(...args: number[]) {
    this.calls.push({ name: 'background', args });
  }

  fill(...args: number[]) {
    this.calls.push({ name: 'fill', args });
  }

  rect(x: number, y: number, w: number, h: number) {
    this.calls.push({ name: 'rect', args: [x, y, w, h] });
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    this.calls.push({ name: 'line', args: [x1, y1, x2, y2] });
  }

  ellipse(x: number, y: number, w: number, h: number) {
    this.calls.push({ name: 'ellipse', args: [x, y, w, h] });
  }

  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    this.calls.push({ name: 'triangle', args: [x1, y1, x2, y2, x3, y3] });
  }

  text(str: string, x: number, y: number) {
    this.calls.push({ name: 'text', args: [str, x, y] });
  }

  textAlign(horizAlign: string, vertAlign?: string) {
    this.calls.push({ name: 'textAlign', args: [horizAlign, vertAlign] });
  }

  textSize(size: number) {
    this.calls.push({ name: 'textSize', args: [size] });
  }

  push() {
    this.calls.push({ name: 'push', args: [] });
  }

  pop() {
    this.calls.push({ name: 'pop', args: [] });
  }

  translate(x: number, y: number) {
    this.calls.push({ name: 'translate', args: [x, y] });
  }

  rotate(angle: number) {
    this.calls.push({ name: 'rotate', args: [angle] });
  }

  millis(): number {
    return this.clock;
  }

  advanceMillis(ms: number): void {
    this.clock += ms;
  }

  remove() {
    this.calls.push({ name: 'remove', args: [] });
  }
}

function stubP5Factory() {
  let instance: StubP5 | undefined;
  const factory: P5Factory = (sketch, node) => {
    expect(node).toBeInstanceOf(HTMLElement);
    instance = new StubP5();
    sketch(instance);
    instance.setup?.();
    return instance;
  };
  return { factory, getInstance: () => instance! };
}

class FakeScene implements Scene {
  readonly params: ParamSpec[] = [];
  readonly setup = vi.fn();
  readonly update = vi.fn();
  readonly draw = vi.fn();
  readonly onNoteOn = vi.fn();
  readonly onNoteOff = vi.fn();
  readonly teardown = vi.fn();

  constructor(
    readonly id: string,
    readonly label: string,
  ) {}
}

class FakeMidiAccess implements MidiAccessLike {
  inputs: MidiInputLike[];
  private readonly messageHandlers = new Map<string, Set<MidiMessageHandler>>();
  private readonly deviceChangeHandlers = new Set<() => void>();

  constructor(inputs: MidiInputLike[] = []) {
    this.inputs = inputs;
  }

  onMessage(inputId: string, handler: MidiMessageHandler): () => void {
    if (!this.messageHandlers.has(inputId)) this.messageHandlers.set(inputId, new Set());
    this.messageHandlers.get(inputId)!.add(handler);
    return () => this.messageHandlers.get(inputId)?.delete(handler);
  }

  onDeviceChange(handler: () => void): () => void {
    this.deviceChangeHandlers.add(handler);
    return () => this.deviceChangeHandlers.delete(handler);
  }

  emit(inputId: string, data: number[]): void {
    this.messageHandlers.get(inputId)?.forEach((handler) => handler(data));
  }

  setInputs(inputs: MidiInputLike[]): void {
    this.inputs = inputs;
    this.deviceChangeHandlers.forEach((handler) => handler());
  }
}

class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function fakeMidiFactory(access: FakeMidiAccess) {
  return () => Promise.resolve(access);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Tests that omit `storage` fall back to the real jsdom localStorage; clear
// it before every test so persisted state can't leak across tests.
beforeEach(() => {
  localStorage.clear();
});

describe('VisualizerEngine', () => {
  it('creates exactly one p5 instance at startup, sized to the default resolution', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');

    const engine = new VisualizerEngine(container, { createP5: factory });

    const stub = getInstance();
    expect(stub.calls.filter((c) => c.name === 'createCanvas')).toHaveLength(1);
    expect(stub.calls).toContainEqual({ name: 'createCanvas', args: [1600, 800] });
    expect(engine.width).toBe(1600);
    expect(engine.height).toBe(800);
  });

  it('splits the canvas into a top 2/3 visualization area and bottom 1/3 chroma key area', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');

    const engine = new VisualizerEngine(container, { createP5: factory });

    expect(engine.chromaKeyHeight).toBeCloseTo(800 / 3);
    expect(engine.visualizationHeight).toBeCloseTo((800 * 2) / 3);
    expect(engine.visualizationHeight + engine.chromaKeyHeight).toBe(engine.height);
  });

  it('paints the chroma key area green on every draw call, without recreating the canvas', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');

    const engine = new VisualizerEngine(container, { createP5: factory });
    const stub = getInstance();
    engine.setKeyboardBand('chroma'); // green fills the band only when the Chroma Key band is selected
    stub.calls = [];

    stub.draw?.();

    expect(stub.calls).toContainEqual({
      name: 'rect',
      args: [0, engine.visualizationHeight, engine.width, engine.chromaKeyHeight],
    });
    expect(stub.calls.some((c) => c.name === 'createCanvas')).toBe(false);
  });

  it('accepts a custom resolution', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      width: 1920,
      height: 1080,
    });

    expect(engine.width).toBe(1920);
    expect(engine.height).toBe(1080);
    expect(engine.chromaKeyHeight).toBeCloseTo(1080 / 3);
  });

  it('removes the p5 instance on destroy', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });

    engine.destroy();

    expect(getInstance().calls).toContainEqual({ name: 'remove', args: [] });
  });
});

describe('VisualizerEngine keyboard band selector', () => {
  // A minimal legacy snapshot (pre keyboard-band), overlaid with band-relevant
  // fields, for exercising the load-path migration from the old two booleans.
  function legacySnapshot(fields: Record<string, unknown>) {
    return JSON.stringify({
      version: 1,
      activeSceneId: null,
      paramValues: {},
      deviceName: null,
      resolutionPreset: '1600x800',
      ...fields,
    });
  }

  it('defaults a fresh load to the Piano Preview band', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');

    const engine = new VisualizerEngine(container, { createP5: factory });

    expect(engine.keyboardBand).toBe('piano');
    expect(engine.pianoPreviewVisible).toBe(true);
    expect(engine.chromaKeyVisible).toBe(false);
  });

  it('selecting Chroma Key deselects Piano Preview (mutual exclusivity)', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });

    engine.setKeyboardBand('chroma');

    expect(engine.chromaKeyVisible).toBe(true);
    expect(engine.pianoPreviewVisible).toBe(false);
  });

  it('selecting Piano Preview deselects Chroma Key', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    engine.setKeyboardBand('chroma');

    engine.setKeyboardBand('piano');

    expect(engine.pianoPreviewVisible).toBe(true);
    expect(engine.chromaKeyVisible).toBe(false);
  });

  it('None clears both bands', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });

    engine.setKeyboardBand('none');

    expect(engine.keyboardBand).toBe('none');
    expect(engine.pianoPreviewVisible).toBe(false);
    expect(engine.chromaKeyVisible).toBe(false);
  });

  it('the None band paints neither the green rect nor the preview, without recreating the canvas', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const stub = getInstance();

    engine.setKeyboardBand('none');
    stub.calls = [];
    stub.draw?.();

    expect(stub.calls.some((c) => c.name === 'rect')).toBe(false);
    expect(stub.calls.some((c) => c.name === 'createCanvas')).toBe(false);
  });

  it('the Chroma Key band paints the green rect', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const stub = getInstance();

    engine.setKeyboardBand('chroma');
    stub.calls = [];
    stub.draw?.();

    expect(engine.chromaKeyVisible).toBe(true);
    expect(stub.calls).toContainEqual({
      name: 'rect',
      args: [0, engine.visualizationHeight, engine.width, engine.chromaKeyHeight],
    });
  });

  it('the visualization area still confines Scenes when the band is None', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });
    const stub = getInstance();

    engine.setKeyboardBand('none');
    stub.draw?.();

    const ctx = sceneA.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.chromaKeyHeight).toBe(engine.chromaKeyHeight);
    expect(ctx.height).toBe(engine.height);
  });

  it('notifies subscribers when the band changes', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setKeyboardBand('chroma');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setting the same band again is a no-op notification-wise', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setKeyboardBand('piano'); // already the default

    expect(listener).not.toHaveBeenCalled();
  });

  it('migrates legacy "both on" persisted state to Piano Preview', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      legacySnapshot({ chromaKeyVisible: true, pianoPreviewVisible: true }),
    );

    const engine = new VisualizerEngine(container, { createP5: factory, storage });

    expect(engine.keyboardBand).toBe('piano');
  });

  it('migrates legacy chroma-only persisted state to Chroma Key', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      legacySnapshot({ chromaKeyVisible: true, pianoPreviewVisible: false }),
    );

    const engine = new VisualizerEngine(container, { createP5: factory, storage });

    expect(engine.keyboardBand).toBe('chroma');
  });

  it('migrates legacy "both off" persisted state to None', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      legacySnapshot({ chromaKeyVisible: false, pianoPreviewVisible: false }),
    );

    const engine = new VisualizerEngine(container, { createP5: factory, storage });

    expect(engine.keyboardBand).toBe('none');
  });
});

describe('VisualizerEngine resolution preset switch', () => {
  it('defaults to the 1600x800 preset', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');

    const engine = new VisualizerEngine(container, { createP5: factory });

    expect(engine.resolutionPreset).toBe('1600x800');
    expect(engine.resolutionPresets).toEqual(['1600x800', '1920x1080']);
  });

  it('setResolutionPreset resizes the render buffer without recreating the canvas', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const stub = getInstance();
    stub.calls = [];

    engine.setResolutionPreset('1920x1080');

    expect(engine.resolutionPreset).toBe('1920x1080');
    expect(engine.width).toBe(1920);
    expect(engine.height).toBe(1080);
    expect(engine.chromaKeyHeight).toBeCloseTo(1080 / 3);
    expect(engine.visualizationHeight).toBeCloseTo((1080 * 2) / 3);
    expect(stub.calls).toContainEqual({ name: 'resizeCanvas', args: [1920, 1080] });
    expect(stub.calls.some((c) => c.name === 'createCanvas')).toBe(false);
  });

  it('Scenes see the updated ctx.width/height/chromaKeyHeight on the next frame, without special-casing', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });
    const stub = getInstance();

    engine.setResolutionPreset('1920x1080');
    stub.draw?.();

    const ctx = sceneA.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.width).toBe(1920);
    expect(ctx.height).toBe(1080);
    expect(ctx.chromaKeyHeight).toBeCloseTo(1080 / 3);
  });

  it('notifies subscribers when the resolution preset changes', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setResolutionPreset('1920x1080');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setting the same preset again is a no-op notification-wise', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setResolutionPreset('1600x800');

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores unknown presets', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, { createP5: factory });
    const listener = vi.fn();
    engine.subscribe(listener);

    // @ts-expect-error - intentionally invalid preset id
    engine.setResolutionPreset('4x4');

    expect(engine.resolutionPreset).toBe('1600x800');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('VisualizerEngine Scene Registry & switching', () => {
  it('activates the first registered Scene at startup', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      scenes: [sceneA, sceneB],
    });

    expect(engine.activeSceneId).toBe('a');
    expect(sceneA.setup).toHaveBeenCalledTimes(1);
    expect(sceneB.setup).not.toHaveBeenCalled();
    expect(engine.scenes).toEqual([
      { id: NO_SCENE_ID, label: 'No Scene' },
      { id: 'a', label: 'Scene A' },
      { id: 'b', label: 'Scene B' },
    ]);
  });

  it('selecting a Scene tears down the outgoing Scene and sets up the incoming one, without recreating p5', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      scenes: [sceneA, sceneB],
    });
    const stub = getInstance();
    const createCanvasCallsBefore = stub.calls.filter((c) => c.name === 'createCanvas').length;

    engine.selectScene('b');

    expect(engine.activeSceneId).toBe('b');
    expect(sceneA.teardown).toHaveBeenCalledTimes(1);
    expect(sceneB.setup).toHaveBeenCalledTimes(1);
    expect(sceneB.teardown).not.toHaveBeenCalled();
    expect(stub.calls.filter((c) => c.name === 'createCanvas')).toHaveLength(
      createCanvasCallsBefore,
    );
  });

  it('selecting the already-active Scene is a no-op', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');

    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });
    sceneA.setup.mockClear();

    engine.selectScene('a');

    expect(sceneA.setup).not.toHaveBeenCalled();
    expect(sceneA.teardown).not.toHaveBeenCalled();
  });

  it("calls the Active Scene's update then draw on every frame, in order", () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });
    const stub = getInstance();

    stub.draw?.();

    expect(sceneA.update).toHaveBeenCalledTimes(1);
    expect(sceneA.draw).toHaveBeenCalledTimes(1);
    const updateOrder = sceneA.update.mock.invocationCallOrder[0];
    const drawOrder = sceneA.draw.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(drawOrder);

    const ctx = sceneA.update.mock.calls[0][0] as SceneContext;
    expect(ctx.p).toBe(stub);
    expect(ctx.width).toBe(engine.width);
    expect(ctx.height).toBe(engine.height);
    expect(ctx.chromaKeyHeight).toBe(engine.chromaKeyHeight);
  });

  it('notifies subscribers when the Active Scene changes', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      scenes: [sceneA, sceneB],
    });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.selectScene('b');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      scenes: [sceneA, sceneB],
    });
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    unsubscribe();

    engine.selectScene('b');

    expect(listener).not.toHaveBeenCalled();
  });

  it('seeds ctx.params from the Active Scene ParamSpec defaults', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    class ParamScene extends FakeScene {
      readonly params: ParamSpec[] = [
        { key: 'speed', label: 'Speed', type: 'range', default: 8, min: 1, max: 20 },
      ];
    }
    const scene = new ParamScene('p', 'Param Scene');

    new VisualizerEngine(container, { createP5: factory, scenes: [scene] });

    const ctx = scene.setup.mock.calls[0][0] as SceneContext;
    expect(ctx.params).toEqual({ speed: 8 });
  });

  it('tears down the Active Scene on destroy', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });

    engine.destroy();

    expect(sceneA.teardown).toHaveBeenCalledTimes(1);
  });
});

describe('VisualizerEngine params: validation/clamping', () => {
  class ParamScene extends FakeScene {
    readonly params: ParamSpec[] = [
      { key: 'speed', label: 'Speed', type: 'range', default: 8, min: 1, max: 20 },
      { key: 'volume', label: 'Volume', type: 'range', default: 0, min: 0, max: 10, step: 2 },
      { key: 'glow', label: 'Glow', type: 'toggle', default: false },
      { key: 'color', label: 'Color', type: 'color', default: '#112233' },
      {
        key: 'pattern',
        label: 'Pattern',
        type: 'select',
        default: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    ];
  }

  function setUpParamEngine() {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const scene = new ParamScene('p', 'Param Scene');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [scene] });
    return { engine, scene, stub: getInstance() };
  }

  it('setParam updates a range value within bounds and surfaces it in ctx.params', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'speed', 12);
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params.speed).toBe(12);
  });

  it('setParam clamps a range value above max down to max', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'speed', 999);
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params.speed).toBe(20);
  });

  it('setParam clamps a range value below min up to min', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'speed', -50);
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params.speed).toBe(1);
  });

  it('setParam snaps a range value to the nearest step', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'volume', 5);
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params.volume).toBe(6);
  });

  it('setParam rejects a non-numeric value for a range param', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'speed', 'fast');
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params.speed).toBe(8);
  });

  it('setParam rejects an unknown param key', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'notAKey', 42);
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params).not.toHaveProperty('notAKey');
  });

  it('setParam rejects an unknown Scene id', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('nope', 'speed', 12);
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params.speed).toBe(8);
  });

  it('setParam accepts a valid select option and rejects an invalid one', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'pattern', 'b');
    stub.draw?.();
    expect((scene.update.mock.calls.at(-1)![0] as SceneContext).params.pattern).toBe('b');

    engine.setParam('p', 'pattern', 'z');
    stub.draw?.();
    expect((scene.update.mock.calls.at(-1)![0] as SceneContext).params.pattern).toBe('b');
  });

  it('setParam accepts a valid hex color and rejects a malformed one', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'color', '#ff00aa');
    stub.draw?.();
    expect((scene.update.mock.calls.at(-1)![0] as SceneContext).params.color).toBe('#ff00aa');

    engine.setParam('p', 'color', 'not-a-color');
    stub.draw?.();
    expect((scene.update.mock.calls.at(-1)![0] as SceneContext).params.color).toBe('#ff00aa');
  });

  it('setParam rejects a non-boolean value for a toggle param', () => {
    const { engine, scene, stub } = setUpParamEngine();

    engine.setParam('p', 'glow', 'yes');
    stub.draw?.();

    const ctx = scene.update.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.params.glow).toBe(false);
  });

  it('exposes the Active Scene ParamSpecs paired with current values via engine.params', () => {
    const { engine } = setUpParamEngine();

    engine.setParam('p', 'speed', 15);

    expect(engine.params.find((p) => p.spec.key === 'speed')).toEqual({
      spec: { key: 'speed', label: 'Speed', type: 'range', default: 8, min: 1, max: 20 },
      value: 15,
    });
  });

  it('notifies subscribers when a param changes', () => {
    const { engine } = setUpParamEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setParam('p', 'speed', 15);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('VisualizerEngine MIDI: Device enumeration, selection, dispatch', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };
  const deviceB: MidiInputLike = { id: 'dev-b', name: 'Keyboard B' };

  it('enumerates Devices from the MIDI provider', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
    });
    await flushMicrotasks();

    expect(engine.devices).toEqual([
      { id: 'dev-a', label: 'Keyboard A' },
      { id: 'dev-b', label: 'Keyboard B' },
    ]);
  });

  it('auto-selects the first available Device on startup with no remembered Device', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
    });
    await flushMicrotasks();

    expect(engine.activeDeviceId).toBe('dev-a');
  });

  it('selects the remembered Device (by name) on startup when it is still connected', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        paramValues: {},
        deviceName: 'Keyboard B',
        resolutionPreset: '1600x800',
        chromaKeyVisible: true,
      }),
    );

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage,
    });
    await flushMicrotasks();

    expect(engine.activeDeviceId).toBe('dev-b');
  });

  it('selectDevice switches the active Device and persists the choice by name', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const storage = new FakeStorage();

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage,
    });
    await flushMicrotasks();

    engine.selectDevice('dev-b');

    expect(engine.activeDeviceId).toBe('dev-b');
    expect(engine.serialize().deviceName).toBe('Keyboard B');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).deviceName).toBe('Keyboard B');
  });

  it("dispatches the selected Device's note-on messages to the Active Scene as a normalized NoteEvent", async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const sceneA = new FakeScene('a', 'Scene A');

    new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA],
    });
    await flushMicrotasks();

    midi.emit('dev-a', [0x90, 60, 100]);

    expect(sceneA.onNoteOn).toHaveBeenCalledTimes(1);
    const [event] = sceneA.onNoteOn.mock.calls[0] as [NoteEvent, SceneContext];
    expect(event).toEqual({ note: 60, name: 'C4', velocity: 100 / 127, raw: 100, channel: 1 });
  });

  it('treats a note-on with velocity 0 as note-off', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const sceneA = new FakeScene('a', 'Scene A');

    new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA],
    });
    await flushMicrotasks();

    midi.emit('dev-a', [0x90, 60, 0]);

    expect(sceneA.onNoteOn).not.toHaveBeenCalled();
    expect(sceneA.onNoteOff).toHaveBeenCalledTimes(1);
    const [event] = sceneA.onNoteOff.mock.calls[0] as [NoteEvent, SceneContext];
    expect(event.velocity).toBe(0);
  });

  it("ignores messages from a Device that isn't the selected one", async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const sceneA = new FakeScene('a', 'Scene A');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA],
    });
    await flushMicrotasks();
    expect(engine.activeDeviceId).toBe('dev-a');

    midi.emit('dev-b', [0x90, 60, 100]);

    expect(sceneA.onNoteOn).not.toHaveBeenCalled();
  });

  it('falls back to the first remaining Device when the active Device is unplugged', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
    });
    await flushMicrotasks();
    expect(engine.activeDeviceId).toBe('dev-a');

    midi.setInputs([deviceB]);

    expect(engine.activeDeviceId).toBe('dev-b');
  });

  it('falls back to no active Device when every Device is unplugged', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
    });
    await flushMicrotasks();
    expect(engine.activeDeviceId).toBe('dev-a');

    midi.setInputs([]);

    expect(engine.activeDeviceId).toBeNull();
  });

  it('a Device connected after load can be selected', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
    });
    await flushMicrotasks();

    midi.setInputs([deviceA, deviceB]);
    expect(engine.devices).toContainEqual({ id: 'dev-b', label: 'Keyboard B' });

    engine.selectDevice('dev-b');

    expect(engine.activeDeviceId).toBe('dev-b');
  });
});

describe('VisualizerEngine session persistence (T11)', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };
  const deviceB: MidiInputLike = { id: 'dev-b', name: 'Keyboard B' };

  class ParamScene extends FakeScene {
    readonly params: ParamSpec[] = [
      { key: 'speed', label: 'Speed', type: 'range', default: 8, min: 1, max: 20 },
    ];
  }

  it('serialize() captures active Scene, per-Scene params, Device name, resolution, and keyboard band', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new ParamScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');
    const midi = new FakeMidiAccess([deviceA, deviceB]);

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA, sceneB],
    });
    await flushMicrotasks();

    engine.selectScene('b');
    engine.setParam('a', 'speed', 15);
    engine.setResolutionPreset('1920x1080');
    engine.setKeyboardBand('chroma');
    engine.selectDevice('dev-b');

    expect(engine.serialize()).toEqual({
      version: 1,
      activeSceneId: 'b',
      paramValues: { a: { speed: 15 }, b: {} },
      deviceName: 'Keyboard B',
      resolutionPreset: '1920x1080',
      keyboardBand: 'chroma',
      crystalsVisible: true,
      crystalsOpacity: 1,
      crystalsLeftColor: '#aa55ff',
      crystalsRightColor: '#ff5a14',
      virtualInputEnabled: false,
    });
  });

  it('restore() round-trips a serialize()d snapshot onto a fresh engine', async () => {
    const { factory: factoryA } = stubP5Factory();
    const containerA = document.createElement('div');
    const sceneA1 = new ParamScene('a', 'Scene A');
    const sceneB1 = new FakeScene('b', 'Scene B');
    const midiA = new FakeMidiAccess([deviceA, deviceB]);
    const source = new VisualizerEngine(containerA, {
      createP5: factoryA,
      createMidi: fakeMidiFactory(midiA),
      storage: new FakeStorage(),
      scenes: [sceneA1, sceneB1],
    });
    await flushMicrotasks();
    source.selectScene('b');
    source.setParam('a', 'speed', 15);
    source.setResolutionPreset('1920x1080');
    source.setKeyboardBand('chroma');
    source.selectDevice('dev-b');
    const snapshot = source.serialize();

    const { factory: factoryB } = stubP5Factory();
    const containerB = document.createElement('div');
    const sceneA2 = new ParamScene('a', 'Scene A');
    const sceneB2 = new FakeScene('b', 'Scene B');
    const midiB = new FakeMidiAccess([deviceA, deviceB]);
    const target = new VisualizerEngine(containerB, {
      createP5: factoryB,
      createMidi: fakeMidiFactory(midiB),
      storage: new FakeStorage(),
      scenes: [sceneA2, sceneB2],
    });
    await flushMicrotasks();

    target.restore(snapshot);
    await flushMicrotasks();

    expect(target.activeSceneId).toBe('b');
    expect(target.resolutionPreset).toBe('1920x1080');
    expect(target.keyboardBand).toBe('chroma');
    expect(target.activeDeviceId).toBe('dev-b');
    target.selectScene('a');
    expect(target.params.find((p) => p.spec.key === 'speed')?.value).toBe(15);
  });

  it('loads remembered state from storage on construction', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new ParamScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: 'b',
        paramValues: { a: { speed: 15 } },
        deviceName: null,
        resolutionPreset: '1920x1080',
        chromaKeyVisible: false,
      }),
    );

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage,
      scenes: [sceneA, sceneB],
    });

    expect(engine.activeSceneId).toBe('b');
    expect(engine.resolutionPreset).toBe('1920x1080');
    expect(engine.chromaKeyVisible).toBe(false);
    engine.selectScene('a');
    expect(engine.params.find((p) => p.spec.key === 'speed')?.value).toBe(15);
  });

  it('restore() clamps param values to the current ParamSpec and drops unknown keys', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const scene = new ParamScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage: new FakeStorage(),
      scenes: [scene],
    });

    engine.restore({
      version: 1,
      activeSceneId: 'a',
      paramValues: { a: { speed: 999, notAKey: 'x' } },
      deviceName: null,
      resolutionPreset: '1600x800',
      chromaKeyVisible: true,
    });

    expect(engine.params.find((p) => p.spec.key === 'speed')?.value).toBe(20);
    expect(engine.params.some((p) => p.spec.key === 'notAKey')).toBe(false);
  });

  it('falls back to the first available Device when the remembered Device name is absent, keeping other settings', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const scene = new ParamScene('a', 'Scene A');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: 'a',
        paramValues: { a: { speed: 15 } },
        deviceName: 'Unplugged Keyboard',
        resolutionPreset: '1920x1080',
        chromaKeyVisible: false,
      }),
    );

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage,
      scenes: [scene],
    });
    await flushMicrotasks();

    expect(engine.activeDeviceId).toBe('dev-a');
    expect(engine.resolutionPreset).toBe('1920x1080');
    expect(engine.chromaKeyVisible).toBe(false);
    expect(engine.params.find((p) => p.spec.key === 'speed')?.value).toBe(15);
  });

  it('unplugging the remembered Device does not erase its name from a later persist', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const scene = new ParamScene('a', 'Scene A');
    const storage = new FakeStorage();

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage,
      scenes: [scene],
    });
    await flushMicrotasks();
    engine.selectDevice('dev-b');
    expect(engine.serialize().deviceName).toBe('Keyboard B');

    midi.setInputs([deviceA]); // dev-b unplugged; engine falls back to dev-a
    engine.setParam('a', 'speed', 12); // unrelated mutation triggers a persist

    expect(engine.serialize().deviceName).toBe('Keyboard B');
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).deviceName).toBe('Keyboard B');
  });

  it('an unrecognized Scene id in persisted state is ignored, falling back to the first registered Scene', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: 'ghost',
        paramValues: {},
        deviceName: null,
        resolutionPreset: '1600x800',
        chromaKeyVisible: true,
      }),
    );

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage,
      scenes: [sceneA, sceneB],
    });

    expect(engine.activeSceneId).toBe('a');
  });

  it('ignores corrupt persisted JSON and falls back to defaults', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, 'not json{{');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage,
      scenes: [sceneA],
    });

    expect(engine.activeSceneId).toBe('a');
    expect(engine.resolutionPreset).toBe('1600x800');
  });
});

describe('VisualizerEngine MIDI: activity tick', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

  it('bumps activityTick and notifies subscribers when a note-on dispatches', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const sceneA = new FakeScene('a', 'Scene A');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA],
    });
    await flushMicrotasks();
    const tickBefore = engine.activityTick;
    const listener = vi.fn();
    engine.subscribe(listener);

    midi.emit('dev-a', [0x90, 60, 100]);

    expect(engine.activityTick).toBe(tickBefore + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('bumps activityTick on note-off dispatch too', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const sceneA = new FakeScene('a', 'Scene A');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA],
    });
    await flushMicrotasks();
    const tickBefore = engine.activityTick;

    midi.emit('dev-a', [0x80, 60, 0]);

    expect(engine.activityTick).toBe(tickBefore + 1);
  });

  it("does not bump activityTick for messages from a Device that isn't selected", async () => {
    const deviceB: MidiInputLike = { id: 'dev-b', name: 'Keyboard B' };
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const sceneA = new FakeScene('a', 'Scene A');

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA],
    });
    await flushMicrotasks();
    const tickBefore = engine.activityTick;

    midi.emit('dev-b', [0x90, 60, 100]);

    expect(engine.activityTick).toBe(tickBefore);
  });
});

describe('VisualizerEngine Crystal Overlay (T15)', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

  // Crystal shafts are narrow (a fraction of a key column); the only other rect
  // drawn is the full-width Chroma Key band, so a small width isolates crystals.
  function crystalRects(stub: StubP5): RecordedCall[] {
    return stub.calls.filter((c) => c.name === 'rect' && (c.args as number[])[2] < 100);
  }

  async function setUpEngine(scenes: Scene[]) {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes,
    });
    // Isolate crystals: the Piano Preview (the default band) draws its own narrow
    // key rects that crystalRects() would otherwise count, so clear the band.
    engine.setKeyboardBand('none');
    await flushMicrotasks();
    return { engine, midi, stub: getInstance() };
  }

  it('spawns and draws a crystal on note-on even with no Active Scene', async () => {
    const { midi, stub } = await setUpEngine([]);

    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    expect(crystalRects(stub).length).toBe(1);
  });

  it('spawns crystals independently of a Scene that ignores notes, drawing them on top', async () => {
    const scene = new FakeScene('a', 'Scene A'); // onNoteOn/draw are inert vi.fns
    const { midi, stub } = await setUpEngine([scene]);

    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    // The Scene never called ctx.drawCrystals(), so the engine draws the crystal itself.
    expect(crystalRects(stub).length).toBe(1);
  });

  it('lets the Active Scene place crystals via ctx.drawCrystals() without the engine drawing them again', async () => {
    const scene = new FakeScene('a', 'Scene A');
    scene.draw.mockImplementation((ctx: SceneContext) => ctx.drawCrystals());
    const { midi, stub } = await setUpEngine([scene]);

    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    // Drawn exactly once — by the Scene — not a second time by the engine default.
    expect(crystalRects(stub).length).toBe(1);
  });

  it('exposes the live crystals and a drawCrystals seam on SceneContext', async () => {
    const scene = new FakeScene('a', 'Scene A');
    const { midi, stub } = await setUpEngine([scene]);

    midi.emit('dev-a', [0x90, 60, 100]);
    stub.draw?.();

    const ctx = scene.draw.mock.calls.at(-1)![0] as SceneContext;
    expect(ctx.crystals.some((c) => c.active)).toBe(true);
    expect(typeof ctx.drawCrystals).toBe('function');
  });

  it('keeps crystals alive across a Scene switch', async () => {
    const sceneA = new FakeScene('a', 'Scene A');
    const sceneB = new FakeScene('b', 'Scene B');
    const { engine, midi, stub } = await setUpEngine([sceneA, sceneB]);

    midi.emit('dev-a', [0x90, 60, 100]);
    engine.selectScene('b');
    stub.calls = [];
    stub.draw?.();

    expect(crystalRects(stub).length).toBe(1);
  });

  it('clears crystals when the resolution preset changes, since columns are width-relative', async () => {
    const { engine, midi, stub } = await setUpEngine([]);

    midi.emit('dev-a', [0x90, 60, 100]);
    engine.setResolutionPreset('1920x1080');
    stub.calls = [];
    stub.draw?.();

    expect(crystalRects(stub).length).toBe(0);
  });
});

describe('VisualizerEngine Crystals sidebar controls (T17)', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

  // Crystal shafts are narrow (a fraction of a key column); the only other rect
  // drawn is the full-width Chroma Key band, so a small width isolates crystals.
  function crystalRects(stub: StubP5): RecordedCall[] {
    return stub.calls.filter((c) => c.name === 'rect' && (c.args as number[])[2] < 100);
  }

  async function setUpEngine(scenes: Scene[] = []) {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes,
    });
    // Isolate crystals: the Piano Preview (the default band) draws its own narrow
    // key rects that crystalRects() would otherwise count, so clear the band.
    engine.setKeyboardBand('none');
    await flushMicrotasks();
    return { engine, midi, stub: getInstance() };
  }

  it('defaults to visible with full opacity', async () => {
    const { engine } = await setUpEngine();

    expect(engine.crystalsVisible).toBe(true);
    expect(engine.crystalsOpacity).toBe(1);
  });

  it('setCrystalsVisible(false) stops crystals rendering on No Scene', async () => {
    const { engine, midi, stub } = await setUpEngine();

    engine.setCrystalsVisible(false);
    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    expect(crystalRects(stub).length).toBe(0);
  });

  it('setCrystalsVisible(true) restores crystal rendering', async () => {
    const { engine, midi, stub } = await setUpEngine();
    engine.setCrystalsVisible(false);
    midi.emit('dev-a', [0x90, 60, 100]);

    engine.setCrystalsVisible(true);
    stub.calls = [];
    stub.draw?.();

    expect(crystalRects(stub).length).toBe(1);
  });

  it('setCrystalsVisible(false) also suppresses a Scene that draws crystals itself via ctx.drawCrystals()', async () => {
    const scene = new FakeScene('a', 'Scene A');
    scene.draw.mockImplementation((ctx: SceneContext) => ctx.drawCrystals());
    const { engine, midi, stub } = await setUpEngine([scene]);

    engine.setCrystalsVisible(false);
    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    expect(crystalRects(stub).length).toBe(0);
  });

  it('setCrystalsOpacity scales the drawn alpha', async () => {
    const { engine, midi, stub } = await setUpEngine();

    engine.setCrystalsOpacity(0.5);
    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    const fillCall = stub.calls.find((c) => c.name === 'fill' && (c.args as number[]).length === 4);
    expect((fillCall!.args as number[])[3]).toBeCloseTo(150 * 0.5);
  });

  it('setCrystalsOpacity clamps to [0, 1]', async () => {
    const { engine } = await setUpEngine();

    engine.setCrystalsOpacity(5);
    expect(engine.crystalsOpacity).toBe(1);

    engine.setCrystalsOpacity(-2);
    expect(engine.crystalsOpacity).toBe(0);
  });

  it('persists crystalsVisible/crystalsOpacity across serialize()/restore()', async () => {
    const { engine: source } = await setUpEngine();
    source.setCrystalsVisible(false);
    source.setCrystalsOpacity(0.3);
    const snapshot = source.serialize();
    expect(snapshot.crystalsVisible).toBe(false);
    expect(snapshot.crystalsOpacity).toBeCloseTo(0.3);

    const { engine: target } = await setUpEngine();
    target.restore(snapshot);

    expect(target.crystalsVisible).toBe(false);
    expect(target.crystalsOpacity).toBeCloseTo(0.3);
  });

  it('falls back to defaults when older persisted state lacks the new fields', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        paramValues: {},
        deviceName: null,
        resolutionPreset: '1600x800',
        chromaKeyVisible: true,
      }),
    );

    const engine = new VisualizerEngine(container, { createP5: factory, storage });

    expect(engine.crystalsVisible).toBe(true);
    expect(engine.crystalsOpacity).toBe(1);
  });
});

describe('VisualizerEngine Piano Preview Overlay (T18)', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

  // The Piano Preview labels every white key; nothing else calls text(), so
  // its presence/count is a reliable signal the keyboard was drawn.
  function labelTexts(stub: StubP5): string[] {
    return stub.calls
      .filter((c) => c.name === 'text')
      .map((c) => (c.args as unknown[])[0] as string);
  }

  // Crystal-colour fills are exactly 3 args (r, g, b); Crystal's own fill call
  // always carries a 4th alpha arg, so this isolates a held Piano Preview key.
  function heldKeyFills(stub: StubP5): number[][] {
    return stub.calls
      .filter((c) => c.name === 'fill' && (c.args as number[]).length === 3)
      .map((c) => c.args as number[])
      .filter(
        (args) =>
          args.join(',') === CRYSTAL_COLORS.left.join(',') ||
          args.join(',') === CRYSTAL_COLORS.right.join(','),
      );
  }

  async function setUpEngine(scenes: Scene[] = []) {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes,
    });
    await flushMicrotasks();
    return { engine, midi, stub: getInstance() };
  }

  it('defaults to visible', async () => {
    const { engine, stub } = await setUpEngine();

    stub.calls = [];
    stub.draw?.();

    expect(engine.pianoPreviewVisible).toBe(true);
    expect(labelTexts(stub)).toHaveLength(35);
  });

  it('the piano band draws a full keyboard, one label per white key', async () => {
    const { engine, stub } = await setUpEngine();

    engine.setKeyboardBand('piano');
    stub.calls = [];
    stub.draw?.();

    expect(labelTexts(stub)).toHaveLength(35);
    expect(labelTexts(stub)).toContain('C2');
  });

  it('leaving the piano band stops drawing the keyboard again', async () => {
    const { engine, stub } = await setUpEngine();
    engine.setKeyboardBand('piano');

    engine.setKeyboardBand('none');
    stub.calls = [];
    stub.draw?.();

    expect(labelTexts(stub)).toHaveLength(0);
  });

  it('lights a held key in its Crystal half-colour and clears it on release', async () => {
    const { engine, midi, stub } = await setUpEngine();
    engine.setKeyboardBand('piano');

    midi.emit('dev-a', [0x90, 36, 100]); // C2, left half
    stub.calls = [];
    stub.draw?.();
    expect(heldKeyFills(stub)).toContainEqual([...CRYSTAL_COLORS.left]);

    midi.emit('dev-a', [0x80, 36, 0]);
    stub.calls = [];
    stub.draw?.();
    expect(heldKeyFills(stub)).toHaveLength(0);
  });

  it('draws on top of the Active Scene and any Scene bleed into the band', async () => {
    const scene = new FakeScene('a', 'Scene A');
    scene.draw.mockImplementation((ctx: SceneContext) => {
      ctx.p.rect(1, 2, 3, 4); // stand-in for Scene bleed into the Chroma Key band
    });
    const { engine, stub } = await setUpEngine([scene]);
    engine.setKeyboardBand('piano');

    stub.calls = [];
    stub.draw?.();

    const sceneRectIndex = stub.calls.findIndex(
      (c) => c.name === 'rect' && (c.args as number[])[0] === 1 && (c.args as number[])[1] === 2,
    );
    const firstLabelIndex = stub.calls.findIndex((c) => c.name === 'text');
    expect(sceneRectIndex).toBeGreaterThanOrEqual(0);
    expect(firstLabelIndex).toBeGreaterThan(sceneRectIndex);
  });

  it('persists the keyboard band across serialize()/restore()', async () => {
    const { engine: source } = await setUpEngine();
    source.setKeyboardBand('none');
    const snapshot = source.serialize();
    expect(snapshot.keyboardBand).toBe('none');

    const { engine: target } = await setUpEngine();
    target.restore(snapshot);

    expect(target.keyboardBand).toBe('none');
    expect(target.pianoPreviewVisible).toBe(false);
  });

  it('falls back to the default (Piano Preview) when older persisted state lacks the field', async () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        paramValues: {},
        deviceName: null,
        resolutionPreset: '1600x800',
        chromaKeyVisible: true,
      }),
    );

    const engine = new VisualizerEngine(container, { createP5: factory, storage });

    expect(engine.pianoPreviewVisible).toBe(true);
  });
});

describe('VisualizerEngine No Scene (T16)', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

  function crystalRects(stub: StubP5): RecordedCall[] {
    return stub.calls.filter((c) => c.name === 'rect' && (c.args as number[])[2] < 100);
  }

  it('lists a "No Scene" entry ahead of the registered Scenes', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });

    expect(engine.scenes[0]).toEqual({ id: NO_SCENE_ID, label: 'No Scene' });
  });

  it('selecting No Scene tears down the Active Scene and stops drawing it', () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });
    const stub = getInstance();

    engine.selectScene(NO_SCENE_ID);

    expect(engine.activeSceneId).toBe(NO_SCENE_ID);
    expect(sceneA.teardown).toHaveBeenCalledTimes(1);

    sceneA.draw.mockClear();
    stub.draw?.();
    expect(sceneA.draw).not.toHaveBeenCalled();
  });

  it('notifies subscribers and reports empty params when No Scene is selected', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    class ParamScene extends FakeScene {
      readonly params: ParamSpec[] = [
        { key: 'speed', label: 'Speed', type: 'range', default: 8, min: 1, max: 20 },
      ];
    }
    const scene = new ParamScene('p', 'Param Scene');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [scene] });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.selectScene(NO_SCENE_ID);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(engine.params).toEqual([]);
  });

  it('selecting No Scene again is a no-op notification-wise', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });
    engine.selectScene(NO_SCENE_ID);
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.selectScene(NO_SCENE_ID);

    expect(listener).not.toHaveBeenCalled();
  });

  it('still renders background + Crystals with No Scene active, driven by notes', async () => {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([deviceA]);
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [sceneA],
    });
    await flushMicrotasks();
    const stub = getInstance();

    engine.selectScene(NO_SCENE_ID);
    engine.setKeyboardBand('none'); // isolate crystals from the Piano Preview's key rects
    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    expect(stub.calls.some((c) => c.name === 'background')).toBe(true);
    expect(crystalRects(stub).length).toBe(1);
  });

  it('persists No Scene as a null activeSceneId', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const storage = new FakeStorage();
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage,
      scenes: [sceneA],
    });

    engine.selectScene(NO_SCENE_ID);

    expect(engine.serialize().activeSceneId).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).activeSceneId).toBeNull();
  });

  it('restores No Scene from a persisted null activeSceneId instead of snapping to a Scene', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        paramValues: {},
        deviceName: null,
        resolutionPreset: '1600x800',
        chromaKeyVisible: true,
      }),
    );

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage,
      scenes: [sceneA],
    });

    expect(engine.activeSceneId).toBe(NO_SCENE_ID);
    expect(sceneA.setup).not.toHaveBeenCalled();
  });

  it('a first-ever load with nothing persisted still activates the first Scene, not No Scene', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage: new FakeStorage(),
      scenes: [sceneA],
    });

    expect(engine.activeSceneId).toBe('a');
    expect(sceneA.setup).toHaveBeenCalledTimes(1);
  });

  it('can return to a real Scene after selecting No Scene', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const sceneA = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(container, { createP5: factory, scenes: [sceneA] });
    engine.selectScene(NO_SCENE_ID);
    sceneA.setup.mockClear();

    engine.selectScene('a');

    expect(engine.activeSceneId).toBe('a');
    expect(sceneA.setup).toHaveBeenCalledTimes(1);
  });
});

describe('VisualizerEngine Virtual Input (T19)', () => {
  const MIDDLE_C = 60; // A key at the default octave = Middle C.

  // Each engine binds window keyboard/cleanup listeners; destroy() removes them so
  // a dispatched key in one test never reaches an enabled engine from another.
  let engines: VisualizerEngine[] = [];

  function setUpEngine(scenes: Scene[] = []) {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage: new FakeStorage(),
      scenes,
    });
    engines.push(engine);
    return { engine, stub: getInstance() };
  }

  function keydown(code: string, opts: { repeat?: boolean; target?: EventTarget } = {}) {
    const event = new KeyboardEvent('keydown', {
      code,
      bubbles: true,
      cancelable: true,
      repeat: opts.repeat ?? false,
    });
    (opts.target ?? window).dispatchEvent(event);
  }

  function keyup(code: string, target: EventTarget = window) {
    target.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }

  afterEach(() => {
    for (const engine of engines) engine.destroy();
    engines = [];
  });

  it('defaults to disabled', () => {
    const { engine } = setUpEngine();
    expect(engine.virtualInputEnabled).toBe(false);
  });

  it('a mapped computer key dispatches a note-on to the Active Scene when enabled', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);

    keydown('KeyA');

    expect(scene.onNoteOn).toHaveBeenCalledTimes(1);
    const [event] = scene.onNoteOn.mock.calls[0] as [NoteEvent, SceneContext];
    expect(event).toEqual({
      note: MIDDLE_C,
      name: 'C4',
      velocity: 100 / 127,
      raw: 100,
      channel: 1,
    });
  });

  it('does nothing while disabled', () => {
    const scene = new FakeScene('a', 'Scene A');
    setUpEngine([scene]);

    keydown('KeyA');

    expect(scene.onNoteOn).not.toHaveBeenCalled();
  });

  it('releases the same note on keyup, even after an octave shift between press and release', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);

    keydown('KeyA'); // Middle C
    keydown('KeyX'); // octave up — must not change which note releases
    keyup('KeyA');

    const [event] = scene.onNoteOff.mock.calls[0] as [NoteEvent, SceneContext];
    expect(event.note).toBe(MIDDLE_C);
  });

  it('shifts the mapped octave with Z/X and reports it via the octave label', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    expect(engine.virtualInputOctaveLabel).toBe('C4 – C5');

    keydown('KeyX'); // up one octave
    expect(engine.virtualInputOctaveLabel).toBe('C5 – C6');
    keydown('KeyA');

    const [event] = scene.onNoteOn.mock.calls[0] as [NoteEvent, SceneContext];
    expect(event.note).toBe(MIDDLE_C + 12);
  });

  it('ignores OS key-repeat, firing a note only once per physical press', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);

    keydown('KeyA');
    keydown('KeyA', { repeat: true });

    expect(scene.onNoteOn).toHaveBeenCalledTimes(1);
  });

  it('ignores keys while a text input is focused', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    const input = document.createElement('input');
    document.body.appendChild(input);

    keydown('KeyA', { target: input });

    expect(scene.onNoteOn).not.toHaveBeenCalled();
    input.remove();
  });

  it('releases held notes on window blur', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    keydown('KeyA');

    window.dispatchEvent(new Event('blur'));

    expect(scene.onNoteOff).toHaveBeenCalledTimes(1);
    expect((scene.onNoteOff.mock.calls[0][0] as NoteEvent).note).toBe(MIDDLE_C);
  });

  it('releases held notes when the Virtual Input is disabled mid-hold', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    keydown('KeyA');

    engine.setVirtualInputEnabled(false);

    expect(scene.onNoteOff).toHaveBeenCalledTimes(1);
  });

  it("does not cut a Device note's Crystal when the Virtual Input releases the same note", async () => {
    const device: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };
    const scene = new FakeScene('a', 'Scene A');
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([device]);
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [scene],
    });
    engines.push(engine);
    await flushMicrotasks();
    const stub = getInstance();
    engine.setVirtualInputEnabled(true);

    // A Device and the Virtual Input both hold Middle C at once.
    midi.emit('dev-a', [0x90, MIDDLE_C, 100]);
    keydown('KeyA'); // KeyA maps to Middle C at the default octave

    // The shared note spawns exactly one Crystal, keyed by note number.
    const activeCrystals = () => {
      stub.draw?.();
      const ctx = scene.draw.mock.calls.at(-1)![0] as SceneContext;
      return ctx.crystals.filter((c) => c.active);
    };
    expect(activeCrystals()).toHaveLength(1);

    keyup('KeyA'); // release only the Virtual Input's hold
    expect(activeCrystals()[0]?.held).toBe(true); // Device still holds it — not cut

    midi.emit('dev-a', [0x80, MIDDLE_C, 0]); // Device finally releases
    expect(activeCrystals()[0]?.held).toBe(false); // now it falls
  });

  it('plays a note when a Piano Preview key is clicked, and releases it on mouseup', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, stub } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');

    // A point in the band's lower area over the leftmost white key (C2, note 36).
    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();

    expect(scene.onNoteOn).toHaveBeenCalledTimes(1);
    expect((scene.onNoteOn.mock.calls[0][0] as NoteEvent).note).toBe(36);

    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(scene.onNoteOff).toHaveBeenCalledTimes(1);
    expect((scene.onNoteOff.mock.calls[0][0] as NoteEvent).note).toBe(36);
  });

  it('does not play a click when the band is not the Piano Preview', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, stub } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('chroma'); // leave the piano band, removing the click surface

    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();

    expect(scene.onNoteOn).not.toHaveBeenCalled();
  });

  it('releases a held Piano Preview click note when the band leaves Piano Preview', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, stub } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');

    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();
    expect(scene.onNoteOn).toHaveBeenCalledTimes(1);
    const heldNote = (scene.onNoteOn.mock.calls[0][0] as NoteEvent).note;

    engine.setKeyboardBand('chroma');

    expect(scene.onNoteOff).toHaveBeenCalledTimes(1);
    expect((scene.onNoteOff.mock.calls[0][0] as NoteEvent).note).toBe(heldNote);
  });

  it('glissandos across keys on drag, releasing the old note and pressing the new', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, stub } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');
    const bandY = engine.visualizationHeight + engine.chromaKeyHeight - 5;

    stub.mouseX = 5;
    stub.mouseY = bandY;
    stub.mousePressed?.();
    const firstNote = (scene.onNoteOn.mock.calls[0][0] as NoteEvent).note;

    // Drag two white keys to the right, onto a different note.
    stub.mouseX = 5 + Math.floor((2 * engine.width) / 35);
    stub.mouseDragged?.();

    const secondNote = (scene.onNoteOn.mock.calls.at(-1)![0] as NoteEvent).note;
    expect(secondNote).not.toBe(firstNote);
    expect((scene.onNoteOff.mock.calls[0][0] as NoteEvent).note).toBe(firstNote);
  });

  it('persists virtualInputEnabled across serialize()/restore()', () => {
    const { engine: source } = setUpEngine();
    source.setVirtualInputEnabled(true);
    const snapshot = source.serialize();
    expect(snapshot.virtualInputEnabled).toBe(true);

    const { engine: target } = setUpEngine();
    target.restore(snapshot);

    expect(target.virtualInputEnabled).toBe(true);
  });

  it('falls back to disabled when older persisted state lacks the field', () => {
    const { factory } = stubP5Factory();
    const container = document.createElement('div');
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        paramValues: {},
        deviceName: null,
        resolutionPreset: '1600x800',
        chromaKeyVisible: true,
      }),
    );

    const engine = new VisualizerEngine(container, { createP5: factory, storage });
    engines.push(engine);

    expect(engine.virtualInputEnabled).toBe(false);
  });
});
