import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SCENE_ID, STORAGE_KEY, VisualizerEngine } from '@/engine/VisualizerEngine';
import { CRYSTAL_COLORS } from '@/engine/crystals';
import { keyColumnX } from '@/engine/keyboardGeometry';
import type { P5Factory, P5Like } from '@/engine/types';
import type { ParamSpec, Scene, SceneContext, NoteEvent } from '@/engine/scene';
import type { MidiAccessLike, MidiInputLike, MidiMessageHandler } from '@/engine/midiTypes';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  StereoPannerNodeLike,
  WaveShaperNodeLike,
} from '@/engine/audio';
import type { DecodedTone } from '@/engine/sampledTone';
import type { ToneDefinition } from '@/tones/catalogue';
import type { ToneLoadOptions, ToneLoader } from '@/tones/toneLoader';

interface RecordedCall {
  name: string;
  args: unknown[];
}

/**
 * How many Crystals were drawn. A Crystal draws several layered rects but strokes
 * its rim exactly once, on its body, so rim strokes count crystals without pinning
 * how many layers a shaft wears. Crystals are the only thing stroking in these
 * tests: the Piano Preview band is cleared and the fake Scenes draw nothing.
 */
function drawnCrystals(stub: StubP5): number {
  return stub.calls.filter((c) => c.name === 'strokeWeight').length;
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

  noFill() {
    this.calls.push({ name: 'noFill', args: [] });
  }

  beginShape() {
    this.calls.push({ name: 'beginShape', args: [] });
  }

  vertex(x: number, y: number) {
    this.calls.push({ name: 'vertex', args: [x, y] });
  }

  endShape(mode?: string) {
    this.calls.push({ name: 'endShape', args: [mode] });
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

describe('VisualizerEngine destroyed while MIDI access is pending', () => {
  const device: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

  it('wires nothing once access is granted', async () => {
    const { factory } = stubP5Factory();
    const scene = new FakeScene('a', 'Scene A');
    const midi = new FakeMidiAccess([device]);
    let grantAccess!: (access: MidiAccessLike) => void;
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: () =>
        new Promise((resolve) => {
          grantAccess = resolve;
        }),
      storage: new FakeStorage(),
      scenes: [scene],
    });

    engine.destroy();
    grantAccess(midi);
    await flushMicrotasks();
    midi.emit('dev-a', [0x90, 60, 100]);
    midi.setInputs([device, { id: 'dev-b', name: 'Keyboard B' }]);

    expect(scene.onNoteOn).not.toHaveBeenCalled();
    expect(engine.activeDeviceId).toBeNull();
    expect(engine.devices).toEqual([]);
  });

  it('notifies nobody once access is refused', async () => {
    const { factory } = stubP5Factory();
    let refuseAccess!: (reason: Error) => void;
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: () =>
        new Promise((_, reject) => {
          refuseAccess = reject;
        }),
      storage: new FakeStorage(),
    });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.destroy();
    refuseAccess(new Error('refused'));
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
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
      soundEnabled: true,
      deviceSoundEnabled: false,
      toneId: 'warm-analog',
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

    expect(drawnCrystals(stub)).toBe(1);
  });

  it('spawns crystals independently of a Scene that ignores notes, drawing them on top', async () => {
    const scene = new FakeScene('a', 'Scene A'); // onNoteOn/draw are inert vi.fns
    const { midi, stub } = await setUpEngine([scene]);

    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    // The Scene never called ctx.drawCrystals(), so the engine draws the crystal itself.
    expect(drawnCrystals(stub)).toBe(1);
  });

  it('lets the Active Scene place crystals via ctx.drawCrystals() without the engine drawing them again', async () => {
    const scene = new FakeScene('a', 'Scene A');
    scene.draw.mockImplementation((ctx: SceneContext) => ctx.drawCrystals());
    const { midi, stub } = await setUpEngine([scene]);

    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    // Drawn exactly once — by the Scene — not a second time by the engine default.
    expect(drawnCrystals(stub)).toBe(1);
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

    expect(drawnCrystals(stub)).toBe(1);
  });

  it('clears released crystals when the resolution preset changes, since columns are width-relative', async () => {
    const { engine, midi, stub } = await setUpEngine([]);

    midi.emit('dev-a', [0x90, 60, 100]);
    midi.emit('dev-a', [0x80, 60, 0]);
    engine.setResolutionPreset('1920x1080');
    stub.calls = [];
    stub.draw?.();

    expect(drawnCrystals(stub)).toBe(0);
  });

  it('gives a held note a fresh crystal at its new column when the resolution preset changes', async () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, midi, stub } = await setUpEngine([scene]);
    const activeCrystals = () => {
      stub.draw?.();
      const ctx = scene.draw.mock.calls.at(-1)![0] as SceneContext;
      return ctx.crystals.filter((c) => c.active);
    };

    midi.emit('dev-a', [0x90, 60, 100]);
    engine.setResolutionPreset('1920x1080');

    const [crystal, ...others] = activeCrystals();
    expect(others).toHaveLength(0);
    expect(crystal.held).toBe(true);
    expect(crystal.x).toBe(keyColumnX(60, 1920));

    midi.emit('dev-a', [0x80, 60, 0]);
    expect(activeCrystals()[0]?.held).toBe(false); // the release still reaches it
  });
});

describe('VisualizerEngine Crystals sidebar controls (T17)', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

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

    expect(drawnCrystals(stub)).toBe(0);
  });

  it('setCrystalsVisible(true) restores crystal rendering', async () => {
    const { engine, midi, stub } = await setUpEngine();
    engine.setCrystalsVisible(false);
    midi.emit('dev-a', [0x90, 60, 100]);

    engine.setCrystalsVisible(true);
    stub.calls = [];
    stub.draw?.();

    expect(drawnCrystals(stub)).toBe(1);
  });

  it('setCrystalsVisible(false) also suppresses a Scene that draws crystals itself via ctx.drawCrystals()', async () => {
    const scene = new FakeScene('a', 'Scene A');
    scene.draw.mockImplementation((ctx: SceneContext) => ctx.drawCrystals());
    const { engine, midi, stub } = await setUpEngine([scene]);

    engine.setCrystalsVisible(false);
    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();

    expect(drawnCrystals(stub)).toBe(0);
  });

  it('setCrystalsOpacity scales the drawn alpha of every layer', async () => {
    const { engine, midi, stub } = await setUpEngine();
    // Every colour a Crystal sets: the fill of each layer plus the rim's stroke.
    const layerAlphas = () =>
      stub.calls
        .filter((c) => (c.name === 'fill' || c.name === 'stroke') && c.args.length === 4)
        .map((c) => (c.args as number[])[3]);

    midi.emit('dev-a', [0x90, 60, 100]);
    stub.calls = [];
    stub.draw?.();
    const fullAlphas = layerAlphas();

    engine.setCrystalsOpacity(0.5);
    stub.calls = [];
    stub.draw?.();
    const halfAlphas = layerAlphas();

    expect(fullAlphas.length).toBeGreaterThan(0);
    expect(halfAlphas).toHaveLength(fullAlphas.length);
    halfAlphas.forEach((alpha, i) => expect(alpha).toBeCloseTo(fullAlphas[i] * 0.5));
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

describe('VisualizerEngine Piano Preview Overlay (T18)', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };

  // The Piano Preview labels every white key; nothing else calls text(), so
  // its presence/count is a reliable signal the keyboard was drawn.
  function labelTexts(stub: StubP5): string[] {
    return stub.calls
      .filter((c) => c.name === 'text')
      .map((c) => (c.args as unknown[])[0] as string);
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

  it('paints the Chroma Key green over any Scene bleed, keeping the band keyable', async () => {
    const scene = new FakeScene('a', 'Scene A');
    scene.draw.mockImplementation((ctx: SceneContext) => {
      ctx.p.rect(1, 2, 3, 4); // stand-in for Scene bleed into the Chroma Key band
    });
    const { engine, stub } = await setUpEngine([scene]);
    engine.setKeyboardBand('chroma');

    stub.calls = [];
    stub.draw?.();

    const sceneRectIndex = stub.calls.findIndex(
      (c) => c.name === 'rect' && (c.args as number[])[0] === 1 && (c.args as number[])[1] === 2,
    );
    const greenRectIndex = stub.calls.findIndex(
      (c) => c.name === 'rect' && (c.args as number[])[1] === engine.visualizationHeight,
    );
    expect(sceneRectIndex).toBeGreaterThanOrEqual(0);
    expect(greenRectIndex).toBeGreaterThan(sceneRectIndex);
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
    expect(drawnCrystals(stub)).toBe(1);
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

  it("does not cut a Virtual Input note when a Device's unmatched note-off arrives", async () => {
    const device: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };
    const scene = new FakeScene('a', 'Scene A');
    const { factory, getInstance } = stubP5Factory();
    const midi = new FakeMidiAccess([device]);
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [scene],
    });
    engines.push(engine);
    await flushMicrotasks();
    const stub = getInstance();
    engine.setVirtualInputEnabled(true);
    const activeCrystals = () => {
      stub.draw?.();
      const ctx = scene.draw.mock.calls.at(-1)![0] as SceneContext;
      return ctx.crystals.filter((c) => c.active);
    };

    keydown('KeyA');
    // A Device key pressed before the Device was wired, released only now.
    midi.emit('dev-a', [0x80, MIDDLE_C, 0]);

    expect(activeCrystals()[0]?.held).toBe(true); // the Virtual Input still holds it
    expect(scene.onNoteOff).toHaveBeenCalledTimes(1); // the event still reaches the Scene

    keyup('KeyA');
    expect(activeCrystals()[0]?.held).toBe(false);
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

// The Tone Player (see ADR-0009) makes Virtual Input notes audible. These spy
// nodes let a test assert that a note created (or stopped) a voice, without any
// real Web Audio — mirroring the fakes in tonePlayer.test.ts.
class SpyAudioParam implements AudioParamLike {
  value = 0;
  /** Where the latest glide (a bend) is heading, if any. */
  target: number | undefined;
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(target: number): void {
    this.target = target;
  }
  cancelScheduledValues(): void {}
}

class SpyOscillator implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  frequency = new SpyAudioParam();
  detune = new SpyAudioParam();
  started = false;
  stopped = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class SpyGain implements GainNodeLike {
  gain = new SpyAudioParam();
  connect(): void {}
}

class SpyBiquadFilter implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  frequency = new SpyAudioParam();
  Q = new SpyAudioParam();
  gain = new SpyAudioParam();
  connect(): void {}
}

class SpyWaveShaper implements WaveShaperNodeLike {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
  connect(): void {}
}

class SpyBufferSource implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  playbackRate = new SpyAudioParam();
  detune = new SpyAudioParam();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started = false;
  stopped = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class SpyAudioContext implements AudioContextLike {
  currentTime = 0;
  state: AudioContextState = 'running';
  outputLatency?: number;
  resumeCalls = 0;
  destination: AudioNodeLike = { connect() {} };
  // A warm-analog voice stacks several oscillators; count `filters` (one low-pass
  // per voice) for a voice tally, and inspect `oscillators` for start/stop state.
  oscillators: SpyOscillator[] = [];
  filters: SpyBiquadFilter[] = [];
  // A sampled voice plays one buffer source per region.
  bufferSources: SpyBufferSource[] = [];
  decodeCalls = 0;
  closed = false;
  createOscillator(): OscillatorNodeLike {
    const osc = new SpyOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): GainNodeLike {
    return new SpyGain();
  }
  createBiquadFilter(): BiquadFilterNodeLike {
    const filter = new SpyBiquadFilter();
    this.filters.push(filter);
    return filter;
  }
  createWaveShaper(): WaveShaperNodeLike {
    return new SpyWaveShaper();
  }
  createBufferSource(): AudioBufferSourceNodeLike {
    const source = new SpyBufferSource();
    this.bufferSources.push(source);
    return source;
  }
  createStereoPanner(): StereoPannerNodeLike {
    return { pan: new SpyAudioParam(), connect() {} };
  }
  decodeAudioData(): Promise<AudioBufferLike> {
    this.decodeCalls += 1;
    return Promise.resolve({ duration: 1 });
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

describe('VisualizerEngine Tone Player wiring', () => {
  let engines: VisualizerEngine[] = [];

  // A single shared SpyAudioContext per engine, so a test can inspect the voices
  // its notes created. The factory returns the same instance on every call.
  function setUpEngine(scenes: Scene[] = []) {
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const audio = new SpyAudioContext();
    const audioOptions: AudioContextOptions[] = [];
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage: new FakeStorage(),
      createAudioContext: (options) => {
        audioOptions.push(options);
        return audio;
      },
      scenes,
    });
    engines.push(engine);
    return { engine, stub: getInstance(), audio, audioOptions };
  }

  function keydown(code: string) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  }

  function keyup(code: string) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }

  afterEach(() => {
    for (const engine of engines) engine.destroy();
    engines = [];
  });

  it('defaults Sound to on', () => {
    const { engine } = setUpEngine();
    expect(engine.soundEnabled).toBe(true);
  });

  it('creates no AudioContext until a gesture or a note asks for sound', () => {
    const { engine, audioOptions } = setUpEngine();
    engine.setVirtualInputEnabled(true);

    expect(audioOptions).toHaveLength(0);
  });

  it('creates the AudioContext at latencyHint 0 on the first Virtual Input note when no gesture turned sound on', () => {
    const { engine, audioOptions } = setUpEngine();
    engine.setVirtualInputEnabled(true);

    keydown('KeyA');

    expect(audioOptions).toEqual([{ latencyHint: 0 }]);
  });

  it('creates and resumes the AudioContext on the gesture that turns sound on, before any note', () => {
    const { engine, audio, audioOptions } = setUpEngine();
    engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });
    audio.state = 'suspended';

    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });

    expect(audioOptions).toEqual([{ latencyHint: 0 }]);
    expect(audio.resumeCalls).toBe(1);
    expect(audio.oscillators).toHaveLength(0);
  });

  it('sounds a computer key before dispatching it, so the voice exists when the Scene hears the note', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, audio } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    const voicesAtNoteOn: number[] = [];
    const soundingAtNoteOff: number[] = [];
    scene.onNoteOn.mockImplementation(() => voicesAtNoteOn.push(audio.filters.length));
    scene.onNoteOff.mockImplementation(() =>
      soundingAtNoteOff.push(audio.oscillators.filter((o) => !o.stopped).length),
    );

    keydown('KeyA');
    keyup('KeyA');

    expect(voicesAtNoteOn).toEqual([1]);
    expect(soundingAtNoteOff).toEqual([0]); // already released when the Scene hears the note-off
  });

  it('sounds a Piano Preview click before dispatching it', () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, stub, audio } = setUpEngine([scene]);
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');
    const voicesAtNoteOn: number[] = [];
    scene.onNoteOn.mockImplementation(() => voicesAtNoteOn.push(audio.filters.length));

    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();

    expect(voicesAtNoteOn).toEqual([1]);
  });

  it('sounds a voice for a computer key when both Virtual Input and Sound are on', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);

    keydown('KeyA');

    expect(audio.filters).toHaveLength(1); // one voice
    expect(audio.oscillators.every((o) => o.started)).toBe(true);
  });

  it('sounds a voice for a Piano Preview click', () => {
    const { engine, stub, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');

    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();

    expect(audio.filters).toHaveLength(1); // one voice
    expect(audio.oscillators.every((o) => o.started)).toBe(true);
  });

  it('glissandos the voice on drag: releases the old voice and sounds a new one', () => {
    const { engine, stub, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');
    const bandY = engine.visualizationHeight + engine.chromaKeyHeight - 5;

    stub.mouseX = 5;
    stub.mouseY = bandY;
    stub.mousePressed?.();

    // Drag two white keys right, onto a different note.
    stub.mouseX = 5 + Math.floor((2 * engine.width) / 35);
    stub.mouseDragged?.();

    expect(audio.filters).toHaveLength(2); // first voice + the dragged-to voice
    expect(audio.oscillators[0].stopped).toBe(true); // old voice released
    const newest = audio.oscillators.at(-1)!;
    expect(newest.started && !newest.stopped).toBe(true); // new voice sounding
  });

  it('stays silent for a real Device note', async () => {
    const device: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };
    const { factory, getInstance } = stubP5Factory();
    const container = document.createElement('div');
    const midi = new FakeMidiAccess([device]);
    const audio = new SpyAudioContext();
    const engine = new VisualizerEngine(container, {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      createAudioContext: () => audio,
    });
    engines.push(engine);
    await flushMicrotasks();
    getInstance();
    // Sound on and the Virtual Input enabled — yet a Device is not a Virtual surface.
    engine.setVirtualInputEnabled(true);

    midi.emit('dev-a', [0x90, 60, 100]);

    expect(audio.oscillators).toHaveLength(0);
  });

  it('stays silent when Sound is off, even with the Virtual Input on (gating: both required)', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });

    keydown('KeyA');

    expect(audio.oscillators).toHaveLength(0);
  });

  it('immediately silences held voices when Sound is turned off', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    keydown('KeyA');
    expect(audio.oscillators[0].stopped).toBe(false);

    engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });

    expect(audio.oscillators[0].stopped).toBe(true);
  });

  it('turning Sound on affects only subsequent notes, not a note held while it was off', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });
    keydown('KeyA'); // held while silent — no voice

    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });
    expect(audio.oscillators).toHaveLength(0); // the held key does not retroactively sound

    keydown('KeyS'); // a subsequent note does
    expect(audio.filters).toHaveLength(1);
  });

  it('releases sounding voices on keyup', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    keydown('KeyA');

    keyup('KeyA');

    expect(audio.oscillators[0].stopped).toBe(true);
  });

  it('releases sounding voices on window blur', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    keydown('KeyA');

    window.dispatchEvent(new Event('blur'));

    expect(audio.oscillators[0].stopped).toBe(true);
  });

  it('silences a note a key and a click both hold on window blur', () => {
    const { engine, stub, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');
    const sounding = () => audio.oscillators.filter((o) => !o.stopped);

    keydown('KeyZ');
    keydown('KeyZ'); // down two octaves, so KeyA is C2: the leftmost Piano Preview key
    keydown('KeyA');
    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();
    expect(sounding()).not.toHaveLength(0);

    window.dispatchEvent(new Event('blur'));

    expect(sounding()).toHaveLength(0);
  });

  it('releases a clicked voice on mouseup', () => {
    const { engine, stub, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');
    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();

    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(audio.oscillators[0].stopped).toBe(true);
  });

  it('keeps sounding while a second key still holds the same note', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    const sounding = () => audio.oscillators.filter((o) => !o.stopped);

    keydown('KeyK'); // C5 at the default octave
    keydown('KeyX'); // up an octave, so KeyA is C5 too
    keydown('KeyA');

    keyup('KeyA');
    expect(sounding()).not.toHaveLength(0);

    keyup('KeyK');
    expect(sounding()).toHaveLength(0);
  });

  it('keeps sounding while a key still holds the note a click let go of', () => {
    const { engine, stub, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    engine.setKeyboardBand('piano');
    const sounding = () => audio.oscillators.filter((o) => !o.stopped);

    keydown('KeyZ');
    keydown('KeyZ'); // down two octaves, so KeyA is C2: the leftmost Piano Preview key
    keydown('KeyA');
    stub.mouseX = 5;
    stub.mouseY = engine.visualizationHeight + engine.chromaKeyHeight - 5;
    stub.mousePressed?.();

    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(sounding()).not.toHaveLength(0);

    keyup('KeyA');
    expect(sounding()).toHaveLength(0);
  });

  it('releases sounding voices when the Virtual Input is disabled', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    keydown('KeyA');

    engine.setVirtualInputEnabled(false);

    expect(audio.oscillators[0].stopped).toBe(true);
  });

  it('releases voices and closes the AudioContext on destroy', () => {
    const { engine, audio } = setUpEngine();
    engine.setVirtualInputEnabled(true);
    keydown('KeyA');

    engine.destroy();

    expect(audio.oscillators[0].stopped).toBe(true);
    expect(audio.closed).toBe(true);
  });

  it('persists soundEnabled across serialize()/restore()', () => {
    const { engine: source } = setUpEngine();
    source.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });
    const snapshot = source.serialize();
    expect(snapshot.soundEnabled).toBe(false);

    const { engine: target } = setUpEngine();
    target.restore(snapshot);

    expect(target.soundEnabled).toBe(false);
  });

  it('defaults soundEnabled to on when an older snapshot lacks the field', () => {
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
        virtualInputEnabled: true,
      }),
    );

    const engine = new VisualizerEngine(container, {
      createP5: factory,
      storage,
      createAudioContext: () => new SpyAudioContext(),
    });
    engines.push(engine);

    expect(engine.soundEnabled).toBe(true);
  });
});

// Device sound (issue #56, ADR-0009): a Device's notes sound through the Tone
// Player only while the user opts in and audio is running, before dispatch.
describe('VisualizerEngine Device sound', () => {
  const device: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };
  const otherDevice: MidiInputLike = { id: 'dev-b', name: 'Keyboard B' };
  let engines: VisualizerEngine[] = [];

  async function setUpEngine(
    options: { storage?: FakeStorage; audio?: SpyAudioContext; scenes?: Scene[] } = {},
  ) {
    const { factory, getInstance } = stubP5Factory();
    const midi = new FakeMidiAccess([device, otherDevice]);
    const audio = options.audio ?? new SpyAudioContext();
    const audioOptions: AudioContextOptions[] = [];
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: options.storage ?? new FakeStorage(),
      createAudioContext: (contextOptions) => {
        audioOptions.push(contextOptions);
        return audio;
      },
      scenes: options.scenes ?? [],
    });
    engines.push(engine);
    await flushMicrotasks();
    return { engine, stub: getInstance(), midi, audio, audioOptions };
  }

  /** Storage holding a saved setup, as a reload finds it. */
  function savedStorage(fields: Record<string, unknown>): FakeStorage {
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        paramValues: {},
        deviceName: null,
        resolutionPreset: '1600x800',
        ...fields,
      }),
    );
    return storage;
  }

  const soundingVoices = (audio: SpyAudioContext) =>
    audio.oscillators.filter((o) => o.started && !o.stopped);

  function keydown(code: string) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  }

  function keyup(code: string) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  }

  afterEach(() => {
    for (const engine of engines) engine.destroy();
    engines = [];
  });

  it('defaults Device sound to off, so a Device note is seen but not heard', async () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, midi, audio } = await setUpEngine({ scenes: [scene] });

    midi.emit('dev-a', [0x90, 60, 100]);

    expect(engine.deviceSoundEnabled).toBe(false);
    expect(audio.oscillators).toHaveLength(0);
    expect(scene.onNoteOn).toHaveBeenCalledTimes(1);
  });

  it('sounds a Device note before dispatching it while Device sound is on', async () => {
    const scene = new FakeScene('a', 'Scene A');
    const { engine, midi, audio } = await setUpEngine({ scenes: [scene] });
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    const voicesAtNoteOn: number[] = [];
    const soundingAtNoteOff: number[] = [];
    scene.onNoteOn.mockImplementation(() => voicesAtNoteOn.push(audio.filters.length));
    scene.onNoteOff.mockImplementation(() => soundingAtNoteOff.push(soundingVoices(audio).length));

    midi.emit('dev-a', [0x90, 60, 100]);
    midi.emit('dev-a', [0x80, 60, 0]);

    expect(voicesAtNoteOn).toEqual([1]);
    expect(soundingAtNoteOff).toEqual([0]);
  });

  it('turning Device sound on is the gesture that creates and resumes audio', async () => {
    const audio = new SpyAudioContext();
    audio.state = 'suspended';
    const { engine, audioOptions } = await setUpEngine({ audio });

    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });

    expect(audioOptions).toEqual([{ latencyHint: 0 }]);
    expect(audio.resumeCalls).toBe(1);
  });

  it('sounds a note held by both a Device and the Virtual Input once, until both let go', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    engine.setVirtualInputEnabled(true);

    midi.emit('dev-a', [0x90, 60, 100]); // C4
    keydown('KeyA'); // C4 at the default octave
    expect(audio.filters).toHaveLength(1); // one voice

    keyup('KeyA');
    expect(soundingVoices(audio)).not.toHaveLength(0);

    midi.emit('dev-a', [0x80, 60, 0]);
    expect(soundingVoices(audio)).toHaveLength(0);
  });

  it('going from All notes to Computer releases the Device voices and keeps the Virtual Input sounding', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    engine.setVirtualInputEnabled(true);
    midi.emit('dev-a', [0x90, 50, 100]);
    keydown('KeyA');

    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });

    expect(audio.filters).toHaveLength(2);
    expect(soundingVoices(audio).length).toBeGreaterThan(0);
    keyup('KeyA');
    expect(soundingVoices(audio)).toHaveLength(0);

    midi.emit('dev-a', [0x90, 52, 100]);
    expect(audio.filters).toHaveLength(2); // no new Device voice
  });

  it('going to Off silences every voice', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    engine.setVirtualInputEnabled(true);
    midi.emit('dev-a', [0x90, 50, 100]);
    keydown('KeyA');

    engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });

    expect(soundingVoices(audio)).toHaveLength(0);
  });

  it('releases Device voices when the Device is unplugged', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    midi.emit('dev-a', [0x90, 60, 100]);

    midi.setInputs([otherDevice]);

    expect(soundingVoices(audio)).toHaveLength(0);
  });

  it('releases Device voices when switching to another Device', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    midi.emit('dev-a', [0x90, 60, 100]);

    engine.selectDevice('dev-b');

    expect(soundingVoices(audio)).toHaveLength(0);
  });

  it('leaves Device voices sounding on focus loss, which releases only the Virtual Input', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    engine.setVirtualInputEnabled(true);
    midi.emit('dev-a', [0x90, 50, 100]);
    keydown('KeyA');

    window.dispatchEvent(new Event('blur'));

    expect(audio.filters).toHaveLength(2);
    expect(soundingVoices(audio).length).toBeGreaterThan(0);
    midi.emit('dev-a', [0x80, 50, 0]);
    expect(soundingVoices(audio)).toHaveLength(0);
  });

  describe('the sustain pedal and pitch bend', () => {
    const PEDAL_DOWN = [0xb0, 64, 127];
    const PEDAL_UP = [0xb0, 64, 0];
    const BEND_UP = [0xe0, 0x7f, 0x7f]; // the wheel fully up: +2 semitones
    /** Where each oscillator's latest bend glide is heading, in cents. */
    const bendTargets = (audio: SpyAudioContext) => audio.oscillators.map((o) => o.detune.target);

    it('the pedal holds a Device note past its key-up, until the pedal lifts', async () => {
      const { engine, midi, audio } = await setUpEngine();
      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });

      midi.emit('dev-a', PEDAL_DOWN);
      midi.emit('dev-a', [0x90, 60, 100]);
      midi.emit('dev-a', [0x80, 60, 0]);
      expect(soundingVoices(audio).length).toBeGreaterThan(0);

      midi.emit('dev-a', PEDAL_UP);
      expect(soundingVoices(audio)).toHaveLength(0);
    });

    it('the pedal holds Virtual Input notes too', async () => {
      const { engine, midi, audio } = await setUpEngine();
      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
      engine.setVirtualInputEnabled(true);

      midi.emit('dev-a', PEDAL_DOWN);
      keydown('KeyA');
      keyup('KeyA');

      expect(soundingVoices(audio).length).toBeGreaterThan(0);
    });

    it('the wheel bends sounding voices, Virtual Input ones included', async () => {
      const { engine, midi, audio } = await setUpEngine();
      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
      engine.setVirtualInputEnabled(true);
      midi.emit('dev-a', [0x90, 50, 100]);
      keydown('KeyA');

      midi.emit('dev-a', BEND_UP);

      expect(audio.oscillators).not.toHaveLength(0);
      expect(new Set(bendTargets(audio))).toEqual(new Set([200]));
    });

    it('neither reaches the Tone Player while Device sound is off', async () => {
      const { engine, midi, audio } = await setUpEngine();
      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });
      engine.setVirtualInputEnabled(true);

      midi.emit('dev-a', PEDAL_DOWN);
      midi.emit('dev-a', BEND_UP);
      keydown('KeyA');
      keyup('KeyA');

      expect(soundingVoices(audio)).toHaveLength(0); // the pedal held nothing
      for (const osc of audio.oscillators) {
        expect(osc.detune.value).toBe(0); // started unbent
        expect(osc.detune.target).toBeUndefined();
      }
    });

    it('never reach the visuals: Scenes, Crystals, the Piano Preview and subscribers see only the keys', async () => {
      const scene = new FakeScene('a', 'Scene A');
      const { engine, midi, stub } = await setUpEngine({ scenes: [scene] });
      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
      midi.emit('dev-a', PEDAL_DOWN);
      midi.emit('dev-a', [0x90, 60, 100]);
      midi.emit('dev-a', [0x80, 60, 0]);
      const tick = engine.activityTick;
      const listener = vi.fn();
      engine.subscribe(listener);

      midi.emit('dev-a', BEND_UP);
      midi.emit('dev-a', PEDAL_UP);
      midi.emit('dev-a', PEDAL_DOWN);

      expect(scene.onNoteOn).toHaveBeenCalledTimes(1);
      expect(scene.onNoteOff).toHaveBeenCalledTimes(1); // at key-up, not pedal-up
      expect(engine.activityTick).toBe(tick);
      expect(listener).not.toHaveBeenCalled();
      stub.calls = [];
      stub.draw?.();
      const ctx = scene.draw.mock.calls.at(-1)![0] as SceneContext;
      expect(ctx.crystals.filter((c) => c.held)).toHaveLength(0); // the Crystal ended at key-up
      expect(heldKeyFills(stub)).toHaveLength(0); // no Piano Preview key held by the pedal
    });

    /** Holds a Virtual Input note on the pedal, with the wheel fully up. */
    async function setUpPedalAndBend() {
      const setup = await setUpEngine();
      setup.engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
      setup.engine.setVirtualInputEnabled(true);
      setup.midi.emit('dev-a', PEDAL_DOWN);
      setup.midi.emit('dev-a', BEND_UP);
      keydown('KeyA');
      keyup('KeyA');
      return setup;
    }

    it('lifts the pedal and centres the bend when the Device is unplugged', async () => {
      const { midi, audio } = await setUpPedalAndBend();

      midi.setInputs([otherDevice]);

      expect(soundingVoices(audio)).toHaveLength(0);
      expect(new Set(bendTargets(audio))).toEqual(new Set([0]));
    });

    it('lifts the pedal and centres the bend when switching to another Device', async () => {
      const { engine, audio } = await setUpPedalAndBend();

      engine.selectDevice('dev-b');

      expect(soundingVoices(audio)).toHaveLength(0);
      expect(new Set(bendTargets(audio))).toEqual(new Set([0]));
    });

    it('lifts the pedal and centres the bend when Device sound turns off', async () => {
      const { engine, audio } = await setUpPedalAndBend();

      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });

      expect(soundingVoices(audio)).toHaveLength(0);
      expect(new Set(bendTargets(audio))).toEqual(new Set([0]));
      keydown('KeyS');
      keyup('KeyS');
      expect(soundingVoices(audio)).toHaveLength(0); // the pedal stays up
    });

    it('lifts the pedal and centres the bend when sound goes Off', async () => {
      const { engine, audio } = await setUpPedalAndBend();

      engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });
      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });
      keydown('KeyS');

      const fresh = audio.oscillators.filter((o) => o.started && !o.stopped);
      expect(fresh).not.toHaveLength(0);
      for (const osc of fresh) expect(osc.detune.value).toBe(0); // starts unbent
      keyup('KeyS');
      expect(soundingVoices(audio)).toHaveLength(0); // and the pedal is up
    });

    it('keeps the pedal down and the bend on focus loss', async () => {
      const { audio } = await setUpPedalAndBend();
      keydown('KeyS');

      window.dispatchEvent(new Event('blur'));

      const heldByPedal = soundingVoices(audio);
      expect(heldByPedal.length).toBeGreaterThan(0); // the pedal holds both notes
      expect(bendTargets(audio).every((target) => target === undefined)).toBe(true); // no glide to centre
      keydown('KeyD');
      const fresh = soundingVoices(audio).filter((o) => !heldByPedal.includes(o));
      expect(fresh).not.toHaveLength(0);
      for (const osc of fresh) expect(osc.detune.value).toBe(200); // the wheel is still up
    });
  });

  it('persists deviceSoundEnabled across serialize()/restore()', async () => {
    const { engine: source } = await setUpEngine();
    source.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    const snapshot = source.serialize();
    expect(snapshot.deviceSoundEnabled).toBe(true);
    expect(snapshot.version).toBe(1);

    const { engine: target } = await setUpEngine();
    target.restore(snapshot);

    expect(target.deviceSoundEnabled).toBe(true);
    expect(target.soundEnabled).toBe(true);
  });

  it('defaults Device sound to off when a saved setup lacks the field', async () => {
    const { engine } = await setUpEngine({ storage: savedStorage({ soundEnabled: true }) });

    expect(engine.deviceSoundEnabled).toBe(false);
  });

  it('restoring Device sound off releases the Device voices', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    midi.emit('dev-a', [0x90, 60, 100]);

    engine.restore({ ...engine.serialize(), deviceSoundEnabled: false });

    expect(soundingVoices(audio)).toHaveLength(0);
  });

  it('resetAllSettings turns Device sound off and releases its voices', async () => {
    const { engine, midi, audio } = await setUpEngine();
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });
    midi.emit('dev-a', [0x90, 60, 100]);

    engine.resetAllSettings();

    expect(engine.deviceSoundEnabled).toBe(false);
    expect(soundingVoices(audio)).toHaveLength(0);
  });

  describe('after a reload with All notes saved', () => {
    async function reload() {
      const audio = new SpyAudioContext();
      audio.state = 'suspended'; // no gesture yet, so the browser holds it suspended
      const setup = await setUpEngine({
        audio,
        storage: savedStorage({ soundEnabled: true, deviceSoundEnabled: true }),
      });
      return setup;
    }

    it('creates the AudioContext at load, suspended, rather than cold on the first note', async () => {
      const { engine, audio, audioOptions } = await reload();

      expect(audioOptions).toEqual([{ latencyHint: 0 }]);
      expect(audio.resumeCalls).toBe(0);
      expect(engine.audioSuspended).toBe(true);
    });

    it('drops Device notes that arrive before the first gesture, rather than queuing them', async () => {
      const scene = new FakeScene('a', 'Scene A');
      const audio = new SpyAudioContext();
      audio.state = 'suspended';
      const { midi } = await setUpEngine({
        audio,
        scenes: [scene],
        storage: savedStorage({
          activeSceneId: 'a',
          soundEnabled: true,
          deviceSoundEnabled: true,
        }),
      });

      midi.emit('dev-a', [0x90, 60, 100]);
      window.dispatchEvent(new Event('pointerdown'));
      await flushMicrotasks();

      expect(audio.oscillators).toHaveLength(0);
      expect(scene.onNoteOn).toHaveBeenCalledTimes(1); // the visuals still react
    });

    it('resumes on the first click anywhere, then sounds Device notes', async () => {
      const { engine, midi, audio } = await reload();
      const listener = vi.fn();
      engine.subscribe(listener);

      window.dispatchEvent(new Event('pointerdown'));
      await flushMicrotasks();

      expect(audio.resumeCalls).toBe(1);
      expect(engine.audioSuspended).toBe(false);
      expect(listener).toHaveBeenCalled();
      midi.emit('dev-a', [0x90, 60, 100]);
      expect(audio.filters).toHaveLength(1);
    });

    it('resumes on the first tap, which activates only on pointerup', async () => {
      const { engine, audio } = await reload();

      window.dispatchEvent(new Event('pointerup'));
      await flushMicrotasks();

      expect(audio.resumeCalls).toBe(1);
      expect(engine.audioSuspended).toBe(false);
    });

    it('resumes on the first key press anywhere, too', async () => {
      const { engine, audio } = await reload();

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      await flushMicrotasks();

      expect(audio.resumeCalls).toBe(1);
      expect(engine.audioSuspended).toBe(false);
    });
  });

  it('creates no AudioContext at load when Off is saved, and a click then creates none', async () => {
    const { audioOptions } = await setUpEngine({
      storage: savedStorage({ soundEnabled: false, deviceSoundEnabled: false }),
    });

    window.dispatchEvent(new Event('pointerdown'));

    expect(audioOptions).toHaveLength(0);
  });

  it('reports the output latency in milliseconds once audio exists, and null before', async () => {
    const audio = new SpyAudioContext();
    const { engine } = await setUpEngine({ audio });
    expect(engine.audioOutputLatencyMs).toBeNull();

    audio.outputLatency = 0.085;
    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: true });

    expect(engine.audioOutputLatencyMs).toBeCloseTo(85, 5);
  });
});

describe('VisualizerEngine sidebar support: Device status', () => {
  const deviceA: MidiInputLike = { id: 'dev-a', name: 'Keyboard A' };
  const deviceB: MidiInputLike = { id: 'dev-b', name: 'Keyboard B' };
  const NOTE_ON = 0x90;
  const NOTE_OFF = 0x80;

  function setUp(midi: FakeMidiAccess, scene = new FakeScene('a', 'Scene A')) {
    const { factory } = stubP5Factory();
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [scene],
    });
    return { engine, scene };
  }

  it('reports connecting until MIDI access resolves, then ready', async () => {
    const { engine } = setUp(new FakeMidiAccess([deviceA]));
    expect(engine.midiStatus).toBe('connecting');

    await flushMicrotasks();

    expect(engine.midiStatus).toBe('ready');
  });

  it('reports unavailable and tells subscribers when MIDI access is refused', async () => {
    const { factory } = stubP5Factory();
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: () => Promise.reject(new Error('denied')),
      storage: new FakeStorage(),
    });
    const listener = vi.fn();
    engine.subscribe(listener);

    await flushMicrotasks();

    expect(engine.midiStatus).toBe('unavailable');
    expect(listener).toHaveBeenCalled();
  });

  it('exposes the saved Device name while that Device is unplugged', async () => {
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const { engine } = setUp(midi);
    await flushMicrotasks();
    engine.selectDevice('dev-b');

    midi.setInputs([deviceA]);

    expect(engine.savedDeviceName).toBe('Keyboard B');
    expect(engine.activeDeviceId).toBe('dev-a');
  });

  it('switches back to the saved Device when it reconnects after a fallback', async () => {
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const { engine } = setUp(midi);
    await flushMicrotasks();
    engine.selectDevice('dev-b');
    midi.setInputs([deviceA]);

    midi.setInputs([deviceA, deviceB]);

    expect(engine.activeDeviceId).toBe('dev-b');
  });

  it('stays on the active Device when another connects and none was explicitly saved', async () => {
    const midi = new FakeMidiAccess([deviceA]);
    const { engine } = setUp(midi);
    await flushMicrotasks();

    midi.setInputs([deviceB, deviceA]);

    expect(engine.activeDeviceId).toBe('dev-a');
  });

  it('releases notes the Device was holding when it is unplugged', async () => {
    const midi = new FakeMidiAccess([deviceA]);
    const { engine, scene } = setUp(midi);
    await flushMicrotasks();
    midi.emit('dev-a', [NOTE_ON, 60, 100]);

    midi.setInputs([]);

    expect(scene.onNoteOff).toHaveBeenCalledTimes(1);
    expect((scene.onNoteOff.mock.calls[0][0] as NoteEvent).note).toBe(60);
    expect(engine.activeDeviceId).toBeNull();
  });

  it('releases notes the old Device was holding when switching Device', async () => {
    const midi = new FakeMidiAccess([deviceA, deviceB]);
    const { engine, scene } = setUp(midi);
    await flushMicrotasks();
    midi.emit('dev-a', [NOTE_ON, 60, 100]);

    engine.selectDevice('dev-b');

    expect(scene.onNoteOff).toHaveBeenCalledTimes(1);
  });

  it('does not re-release a note the Device already let go of', async () => {
    const midi = new FakeMidiAccess([deviceA]);
    const { scene } = setUp(midi);
    await flushMicrotasks();
    midi.emit('dev-a', [NOTE_ON, 60, 100]);
    midi.emit('dev-a', [NOTE_OFF, 60, 0]);

    midi.setInputs([]);

    expect(scene.onNoteOff).toHaveBeenCalledTimes(1);
  });
});

describe('VisualizerEngine sidebar support: Virtual Input focus', () => {
  function setUp() {
    const { factory } = stubP5Factory();
    const scene = new FakeScene('a', 'Scene A');
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: fakeMidiFactory(new FakeMidiAccess()),
      storage: new FakeStorage(),
      scenes: [scene],
    });
    engine.setVirtualInputEnabled(true);
    return { engine, scene };
  }

  function pressWhileFocused(element: HTMLElement) {
    document.body.appendChild(element);
    element.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));
    element.remove();
  }

  it.each(['checkbox', 'radio', 'range', 'color'])(
    'plays notes while a %s control has focus, as it does right after being clicked',
    (type) => {
      const { engine, scene } = setUp();
      const input = document.createElement('input');
      input.type = type;

      pressWhileFocused(input);

      expect(scene.onNoteOn).toHaveBeenCalledTimes(1);
      engine.destroy();
    },
  );

  it('still ignores keys while a select has focus, since it uses them for type-ahead', () => {
    const { engine, scene } = setUp();

    pressWhileFocused(document.createElement('select'));

    expect(scene.onNoteOn).not.toHaveBeenCalled();
    engine.destroy();
  });
});

describe('VisualizerEngine sidebar support: keeping and resetting settings', () => {
  function rangeScene(id: string): FakeScene {
    const scene = new FakeScene(id, `Scene ${id}`);
    scene.params.push({
      key: 'count',
      label: 'Count',
      type: 'range',
      default: 5,
      min: 0,
      max: 10,
      step: 1,
    });
    return scene;
  }

  function setUp(storage: Storage = new FakeStorage()) {
    const { factory } = stubP5Factory();
    const scenes = [rangeScene('a'), rangeScene('b')];
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: fakeMidiFactory(new FakeMidiAccess()),
      storage,
      scenes,
    });
    return { engine, scenes, storage };
  }

  it('counts each successful save, including switching Scene', () => {
    const { engine } = setUp();
    const before = engine.settingsSaveCount;
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.selectScene('b');
    const afterScene = engine.settingsSaveCount;
    listener.mockClear();
    engine.setCrystalsOpacity(0.5);

    expect(afterScene).toBe(before + 1);
    expect(engine.settingsSaveCount).toBe(before + 2);
    expect(engine.settingsSaveFailed).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('tells subscribers about the save when switching Scene', () => {
    const { engine } = setUp();
    const seen: number[] = [];
    engine.subscribe(() => seen.push(engine.settingsSaveCount));
    const before = engine.settingsSaveCount;

    engine.selectScene('b');

    expect(seen.at(-1)).toBe(before + 1);
  });

  it('reports a failed save instead of throwing when storage is unavailable', () => {
    const storage = new FakeStorage();
    const { engine } = setUp(storage);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => engine.setCrystalsOpacity(0.5)).not.toThrow();

    expect(engine.settingsSaveFailed).toBe(true);
    expect(engine.crystalsOpacity).toBe(0.5);
  });

  it('resetSceneParams restores one Scene and leaves the others alone', () => {
    const { engine } = setUp();
    engine.setParam('a', 'count', 9);
    engine.setParam('b', 'count', 2);

    engine.resetSceneParams('a');

    expect(engine.params[0].value).toBe(5);
    expect(engine.serialize().paramValues.b.count).toBe(2);
  });

  it('resetCrystals restores visibility, opacity and colors, and reports being at defaults', () => {
    const { engine } = setUp();
    expect(engine.crystalsAtDefaults).toBe(true);
    engine.setCrystalsVisible(false);
    engine.setCrystalsOpacity(0.2);
    engine.setCrystalsLeftColor('#112233');
    engine.setCrystalsRightColor('#445566');
    expect(engine.crystalsAtDefaults).toBe(false);

    engine.resetCrystals();

    expect(engine.crystalsVisible).toBe(true);
    expect(engine.crystalsOpacity).toBe(1);
    expect(engine.crystalsAtDefaults).toBe(true);
  });

  it('resetAllSettings restores first-load defaults and persists them', () => {
    const { engine, storage } = setUp();
    engine.selectScene('b');
    engine.setParam('a', 'count', 9);
    engine.setParam('b', 'count', 2);
    engine.setKeyboardBand('chroma');
    engine.setCrystalsOpacity(0.2);
    engine.setResolutionPreset('1920x1080');
    engine.setVirtualInputEnabled(true);
    engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });

    engine.resetAllSettings();

    expect(engine.activeSceneId).toBe('a');
    expect(engine.params[0].value).toBe(5);
    expect(engine.serialize().paramValues.b.count).toBe(5);
    expect(engine.keyboardBand).toBe('piano');
    expect(engine.crystalsOpacity).toBe(1);
    expect(engine.resolutionPreset).toBe('1600x800');
    expect(engine.virtualInputEnabled).toBe(false);
    expect(engine.soundEnabled).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).keyboardBand).toBe('piano');
  });

  it('resetAllSettings keeps the saved Device, which is hardware rather than a preference to undo', async () => {
    const { factory } = stubP5Factory();
    const midi = new FakeMidiAccess([
      { id: 'dev-a', name: 'Keyboard A' },
      { id: 'dev-b', name: 'Keyboard B' },
    ]);
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      createMidi: fakeMidiFactory(midi),
      storage: new FakeStorage(),
      scenes: [rangeScene('a')],
    });
    await flushMicrotasks();
    engine.selectDevice('dev-b');

    engine.resetAllSettings();

    expect(engine.activeDeviceId).toBe('dev-b');
    expect(engine.savedDeviceName).toBe('Keyboard B');
  });
});

describe('VisualizerEngine Tones', () => {
  let engines: VisualizerEngine[] = [];

  /** A sampled Tone's decoded files: one region over every key and velocity. */
  const DECODED: DecodedTone = {
    regions: [
      {
        file: 'C4.mp3',
        keycentre: 60,
        keyLo: 0,
        keyHi: 127,
        velLo: 1,
        velHi: 127,
        tune: 0,
        gainDb: 0,
        pan: 0,
        loop: null,
        release: false,
      },
    ],
    buffers: new Map([['C4.mp3', { duration: 2 }]]),
  };

  interface LoadCall {
    tone: ToneDefinition;
    options: ToneLoadOptions;
    resolve: (decoded: DecodedTone) => void;
    reject: (error: Error) => void;
  }

  /** A loader that waits until the test settles each load. */
  function fakeToneLoader() {
    const calls: LoadCall[] = [];
    const loader: ToneLoader = (tone, options) =>
      new Promise((resolve, reject) => calls.push({ tone, options, resolve, reject }));
    return { loader, calls };
  }

  function setUpEngine(options: { storage?: FakeStorage; audio?: SpyAudioContext } = {}) {
    const { factory } = stubP5Factory();
    const audio = options.audio ?? new SpyAudioContext();
    const { loader, calls } = fakeToneLoader();
    const storage = options.storage ?? new FakeStorage();
    const engine = new VisualizerEngine(document.createElement('div'), {
      createP5: factory,
      storage,
      createAudioContext: () => audio,
      loadTone: loader,
    });
    engines.push(engine);
    engine.setVirtualInputEnabled(true);
    return { engine, audio, loads: calls, storage };
  }

  /** Storage holding a saved setup, as a reload finds it. */
  function savedStorage(fields: Record<string, unknown>): FakeStorage {
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSceneId: null,
        paramValues: {},
        deviceName: null,
        resolutionPreset: '1600x800',
        soundEnabled: true,
        ...fields,
      }),
    );
    return storage;
  }

  const keydown = (code: string) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  const keyup = (code: string) =>
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  /**
   * What a computer key sounds with: a sampled voice, a Villera Lead voice (its
   * square oscillator), a Warm Analog voice (a low-pass filter), or nothing.
   */
  function sounds(
    audio: SpyAudioContext,
    code: string,
  ): 'warm-analog' | 'villera-lead' | 'sampled' | 'nothing' {
    const [filters, sources, oscillators] = [
      audio.filters.length,
      audio.bufferSources.length,
      audio.oscillators.length,
    ];
    keydown(code);
    keyup(code);
    if (audio.bufferSources.length > sources) return 'sampled';
    if (audio.oscillators.slice(oscillators).some((o) => o.type === 'square'))
      return 'villera-lead';
    return audio.filters.length > filters ? 'warm-analog' : 'nothing';
  }

  afterEach(() => {
    for (const engine of engines) engine.destroy();
    engines = [];
  });

  it('starts on Warm Analog, ready, and loads nothing', () => {
    const { engine, audio, loads } = setUpEngine();

    expect(engine.toneId).toBe('warm-analog');
    expect(engine.toneStatus).toBe('ready');
    expect(loads).toHaveLength(0);
    expect(sounds(audio, 'KeyA')).toBe('warm-analog');
  });

  it('picking Villera Lead, synthesised, plays it from the next note: ready at once, loading nothing', () => {
    const { engine, audio, loads } = setUpEngine();

    engine.selectTone('villera-lead');

    expect(engine.toneId).toBe('villera-lead');
    expect(engine.toneStatus).toBe('ready');
    expect(loads).toHaveLength(0);
    expect(sounds(audio, 'KeyA')).toBe('villera-lead');
  });

  it("picking the Accordion starts its load, decoding through the Tone Player's context", async () => {
    const { engine, audio, loads } = setUpEngine();

    engine.selectTone('accordion');

    expect(engine.toneId).toBe('accordion');
    expect(engine.toneStatus).toBe('loading');
    expect(loads.map((l) => l.tone.id)).toEqual(['accordion']);
    await loads[0].options.decode(new ArrayBuffer(4));
    expect(audio.decodeCalls).toBe(1);
  });

  it('picking a Tone is a gesture: it creates and resumes audio', () => {
    const audio = new SpyAudioContext();
    audio.state = 'suspended';
    const { engine } = setUpEngine({ audio });

    engine.selectTone('accordion');

    expect(audio.resumeCalls).toBe(1);
  });

  it('keeps Warm Analog playing until the Accordion is ready, then sounds it from the next note', async () => {
    const { engine, audio, loads } = setUpEngine();
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.selectTone('accordion');
    expect(sounds(audio, 'KeyA')).toBe('warm-analog');
    listener.mockClear();

    loads[0].resolve(DECODED);
    await flushMicrotasks();

    expect(engine.toneStatus).toBe('ready');
    expect(listener).toHaveBeenCalled();
    expect(sounds(audio, 'KeyA')).toBe('sampled');
  });

  it('lets a note held across the switch finish on Warm Analog', async () => {
    const { engine, audio, loads } = setUpEngine();
    engine.selectTone('accordion');
    keydown('KeyA');
    const heldVoice = audio.oscillators.slice();

    loads[0].resolve(DECODED);
    await flushMicrotasks();

    expect(heldVoice.every((o) => !o.stopped)).toBe(true);
    keyup('KeyA');
    expect(heldVoice.every((o) => o.stopped)).toBe(true);
    expect(audio.bufferSources).toHaveLength(0);
  });

  it('keeps Warm Analog playing when the load fails, with the Accordion still picked', async () => {
    const { engine, audio, loads } = setUpEngine();
    engine.selectTone('accordion');

    loads[0].reject(new Error('404'));
    await flushMicrotasks();

    expect(engine.toneStatus).toBe('failed');
    expect(engine.toneId).toBe('accordion');
    expect(sounds(audio, 'KeyA')).toBe('warm-analog');
  });

  it('does not load the picked Tone again when it is picked again', async () => {
    const { engine, loads } = setUpEngine();
    engine.selectTone('accordion');
    engine.selectTone('accordion');
    loads[0].resolve(DECODED);
    await flushMicrotasks();

    engine.selectTone('accordion');

    expect(loads).toHaveLength(1);
    expect(engine.toneStatus).toBe('ready');
  });

  it('goes back to Warm Analog from the next note when it is picked, letting the Accordion go', async () => {
    const { engine, audio, loads } = setUpEngine();
    engine.selectTone('accordion');
    loads[0].resolve(DECODED);
    await flushMicrotasks();

    engine.selectTone('warm-analog');

    expect(engine.toneStatus).toBe('ready');
    expect(sounds(audio, 'KeyA')).toBe('warm-analog');
  });

  it('never lets a load a newer pick replaced take over, and aborts it', async () => {
    const { engine, audio, loads } = setUpEngine();
    engine.selectTone('accordion');
    engine.selectTone('warm-analog');

    loads[0].resolve(DECODED);
    await flushMicrotasks();

    expect(loads[0].options.signal?.aborted).toBe(true);
    expect(engine.toneStatus).toBe('ready');
    expect(sounds(audio, 'KeyA')).toBe('warm-analog');
  });

  it('downloads nothing while sound is Off: a load still running stops, and starts again with sound', () => {
    const { engine, loads } = setUpEngine();
    engine.selectTone('accordion');

    engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });

    expect(loads[0].options.signal?.aborted).toBe(true);
    expect(engine.toneStatus).toBe('idle');

    engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });

    expect(loads).toHaveLength(2);
    expect(engine.toneStatus).toBe('loading');
  });

  it('falls back to Warm Analog for a pick the catalogue does not hold', () => {
    const { engine, loads } = setUpEngine();
    engine.selectTone('accordion');

    engine.selectTone('theremin');

    expect(engine.toneId).toBe('warm-analog');
    expect(loads[0].options.signal?.aborted).toBe(true);
  });

  describe('download progress', () => {
    it('reports files done out of the total as they arrive, telling subscribers', () => {
      const { engine, loads } = setUpEngine();
      const listener = vi.fn();
      engine.subscribe(listener);
      engine.selectTone('accordion');
      expect(engine.toneLoadProgress).toBeNull();
      listener.mockClear();

      loads[0].options.onProgress?.(0, 34);
      loads[0].options.onProgress?.(12, 34);

      expect(engine.toneLoadProgress).toEqual({ filesDone: 12, filesTotal: 34 });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('clears once the Tone is ready, or has failed', async () => {
      const { engine, loads } = setUpEngine();
      engine.selectTone('accordion');
      loads[0].options.onProgress?.(34, 34);
      loads[0].resolve(DECODED);
      await flushMicrotasks();
      expect(engine.toneLoadProgress).toBeNull();

      engine.selectTone('warm-analog');
      engine.selectTone('accordion');
      loads[1].options.onProgress?.(3, 34);
      loads[1].reject(new Error('404'));
      await flushMicrotasks();
      expect(engine.toneLoadProgress).toBeNull();
    });
  });

  describe('a newer pick', () => {
    it('aborts a load still running, so the latest pick wins', async () => {
      const { engine, audio, loads } = setUpEngine();
      engine.selectTone('accordion');
      engine.selectTone('warm-analog');
      engine.selectTone('accordion');

      expect(loads).toHaveLength(2);
      expect(loads[0].options.signal?.aborted).toBe(true);
      expect(loads[1].options.signal?.aborted).toBe(false);

      // The replaced load reporting or failing late changes nothing.
      loads[0].options.onProgress?.(30, 34);
      loads[0].reject(new Error('aborted'));
      await flushMicrotasks();
      expect(engine.toneStatus).toBe('loading');
      expect(engine.toneLoadProgress).toBeNull();

      loads[1].resolve(DECODED);
      await flushMicrotasks();
      expect(engine.toneStatus).toBe('ready');
      expect(sounds(audio, 'KeyA')).toBe('sampled');
    });

    it('clears the progress of the load it replaced', () => {
      const { engine, loads } = setUpEngine();
      engine.selectTone('accordion');
      loads[0].options.onProgress?.(12, 34);

      engine.selectTone('warm-analog');

      expect(engine.toneLoadProgress).toBeNull();
    });
  });

  describe('Retry', () => {
    async function failedAccordion(audio?: SpyAudioContext) {
      const setup = setUpEngine({ audio });
      setup.engine.selectTone('accordion');
      setup.loads[0].reject(new Error('404'));
      await flushMicrotasks();
      return setup;
    }

    it('loads the failed Tone again, and it takes over once ready', async () => {
      const { engine, audio, loads } = await failedAccordion();
      const listener = vi.fn();
      engine.subscribe(listener);

      engine.retryTone();

      expect(loads.map((l) => l.tone.id)).toEqual(['accordion', 'accordion']);
      expect(engine.toneStatus).toBe('loading');
      expect(listener).toHaveBeenCalled();
      loads[1].resolve(DECODED);
      await flushMicrotasks();
      expect(engine.toneStatus).toBe('ready');
      expect(sounds(audio, 'KeyA')).toBe('sampled');
    });

    it('can fail again, offering Retry once more', async () => {
      const { engine, loads } = await failedAccordion();

      engine.retryTone();
      loads[1].reject(new Error('offline'));
      await flushMicrotasks();

      expect(engine.toneStatus).toBe('failed');
    });

    it('is a gesture: it resumes audio', async () => {
      const audio = new SpyAudioContext();
      const { engine } = await failedAccordion(audio);
      audio.state = 'suspended';
      const resumes = audio.resumeCalls;

      engine.retryTone();

      expect(audio.resumeCalls).toBe(resumes + 1);
    });

    it('stays offered across sound going Off and back on, and downloads nothing while Off', async () => {
      const { engine, loads } = await failedAccordion();

      engine.setSoundGates({ soundEnabled: false, deviceSoundEnabled: false });
      engine.retryTone();
      expect(loads).toHaveLength(1);

      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });
      expect(engine.toneStatus).toBe('failed');
      engine.retryTone();
      expect(loads).toHaveLength(2);
    });

    it('does nothing unless the selected Tone failed', async () => {
      const { engine, loads } = setUpEngine();
      engine.retryTone();
      engine.selectTone('accordion');
      engine.retryTone();
      expect(loads).toHaveLength(1);

      loads[0].resolve(DECODED);
      await flushMicrotasks();
      engine.retryTone();
      expect(loads).toHaveLength(1);
    });
  });

  describe('downloaded Tones', () => {
    it('lists each sampled Tone once it has loaded, and keeps it after switching away', async () => {
      const { engine, loads } = setUpEngine();
      expect(engine.downloadedToneIds).toEqual([]);

      engine.selectTone('accordion');
      expect(engine.downloadedToneIds).toEqual([]);
      loads[0].resolve(DECODED);
      await flushMicrotasks();
      expect(engine.downloadedToneIds).toEqual(['accordion']);

      engine.selectTone('warm-analog');
      expect(engine.downloadedToneIds).toEqual(['accordion']);
    });

    it('leaves out a Tone whose download failed', async () => {
      const { engine, loads } = setUpEngine();
      engine.selectTone('accordion');
      loads[0].reject(new Error('404'));
      await flushMicrotasks();

      expect(engine.downloadedToneIds).toEqual([]);
    });
  });

  describe('at startup', () => {
    function reload(fields: Record<string, unknown>) {
      const audio = new SpyAudioContext();
      audio.state = 'suspended'; // no gesture yet, so the browser holds it suspended
      const contexts: unknown[] = [];
      const { loader, calls } = fakeToneLoader();
      const { factory } = stubP5Factory();
      const engine = new VisualizerEngine(document.createElement('div'), {
        createP5: factory,
        storage: savedStorage(fields),
        createAudioContext: (options) => {
          contexts.push(options);
          return audio;
        },
        loadTone: loader,
      });
      engines.push(engine);
      return { engine, audio, loads: calls, contexts };
    }

    it('creates the AudioContext suspended and downloads and decodes a saved sampled Tone at once', async () => {
      const { engine, audio, loads, contexts } = reload({ toneId: 'accordion' });

      expect(contexts).toHaveLength(1);
      expect(engine.audioSuspended).toBe(true);
      expect(audio.resumeCalls).toBe(0);
      expect(loads.map((l) => l.tone.id)).toEqual(['accordion']);
      expect(engine.toneStatus).toBe('loading');

      // Decoding works on the suspended context: no gesture is needed for it.
      await loads[0].options.decode(new ArrayBuffer(4));
      expect(audio.decodeCalls).toBe(1);
      loads[0].resolve(DECODED);
      await flushMicrotasks();
      expect(engine.toneStatus).toBe('ready');
      expect(contexts).toHaveLength(1);
    });

    it('lets the first click or key press resume audio, and the saved Tone is then heard', async () => {
      const { engine, audio, loads } = reload({ toneId: 'accordion' });
      loads[0].resolve(DECODED);
      await flushMicrotasks();

      window.dispatchEvent(new Event('pointerdown'));
      await flushMicrotasks();

      expect(audio.resumeCalls).toBe(1);
      expect(engine.audioSuspended).toBe(false);
      engine.setVirtualInputEnabled(true);
      expect(sounds(audio, 'KeyA')).toBe('sampled');
    });

    it('downloads nothing and creates no AudioContext with sound Off saved', () => {
      const { engine, loads, contexts } = reload({
        toneId: 'accordion',
        soundEnabled: false,
        deviceSoundEnabled: false,
      });

      window.dispatchEvent(new Event('pointerdown'));

      expect(loads).toHaveLength(0);
      expect(contexts).toHaveLength(0);
      expect(engine.toneStatus).toBe('idle');
    });
  });

  describe('the saved Tone', () => {
    it('saves the pick as toneId', () => {
      const { engine, storage } = setUpEngine();

      engine.selectTone('accordion');

      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).toneId).toBe('accordion');
    });

    it('restores a saved sampled Tone and loads it, while sound is on', () => {
      const { engine, loads } = setUpEngine({ storage: savedStorage({ toneId: 'accordion' }) });

      expect(engine.toneId).toBe('accordion');
      expect(loads.map((l) => l.tone.id)).toEqual(['accordion']);
    });

    it("restores Villera Lead from its saved id, 'villera-lead', and plays it at once, loading nothing", () => {
      const { engine, audio, loads } = setUpEngine({
        storage: savedStorage({ toneId: 'villera-lead' }),
      });

      expect(engine.toneId).toBe('villera-lead');
      expect(engine.toneStatus).toBe('ready');
      expect(loads).toHaveLength(0);
      expect(sounds(audio, 'KeyA')).toBe('villera-lead');
    });

    it('falls back to Warm Analog for a saved id the catalogue no longer holds, or none at all', () => {
      for (const fields of [{ toneId: 'grand-piano-v0' }, { toneId: 7 }, {}]) {
        const { engine, loads } = setUpEngine({ storage: savedStorage(fields) });

        expect(engine.toneId).toBe('warm-analog');
        expect(loads).toHaveLength(0);
      }
    });

    it('waits for sound to turn on before loading a Tone saved with sound Off', () => {
      const { engine, loads } = setUpEngine({
        storage: savedStorage({ toneId: 'accordion', soundEnabled: false }),
      });
      expect(loads).toHaveLength(0);

      engine.setSoundGates({ soundEnabled: true, deviceSoundEnabled: false });

      expect(loads.map((l) => l.tone.id)).toEqual(['accordion']);
    });

    it('resetAllSettings goes back to Warm Analog', async () => {
      const { engine, audio, loads, storage } = setUpEngine();
      engine.selectTone('accordion');
      loads[0].resolve(DECODED);
      await flushMicrotasks();

      engine.resetAllSettings();
      engine.setVirtualInputEnabled(true);

      expect(engine.toneId).toBe('warm-analog');
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!).toneId).toBe('warm-analog');
      expect(sounds(audio, 'KeyA')).toBe('warm-analog');
    });
  });
});
