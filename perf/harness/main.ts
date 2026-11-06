/**
 * The page the workbench drives in headless Chromium. It builds the real
 * VisualizerEngine with the real p5 and every registered Scene, then plays a
 * Workload into it through a fake MIDI Device, one frame at a time:
 *
 * - The p5 loop is stopped and each frame is drawn with `redraw()`, then the
 *   canvas is read back, so a frame's cost includes the rasterising the canvas
 *   would otherwise defer — and never depends on the display's refresh rate.
 * - `millis()` is a virtual clock that advances exactly 1/60 s per frame and
 *   `Math.random` is seeded, so every run animates identically and draw-call
 *   counts are exactly repeatable.
 *
 * `@/…` resolves to whichever `src/` the runner built this page against, so the
 * same harness measures both the PR and its base.
 */
import p5 from 'p5';
import { VisualizerEngine } from '@/engine/VisualizerEngine';
import { createDefaultScenes } from '@/scenes';
import type { MidiAccessLike, MidiMessageHandler } from '@/engine/midiTypes';
import type { P5Factory, P5Like } from '@/engine/types';
import { WORKLOADS } from '../workloads';

const FRAME_MS = 1000 / 60;
const DEVICE_ID = 'perf-device';

/** The drawing calls counted per frame: every shape, vertex and text a Scene or Overlay emits. */
const COUNTED_CALLS = [
  'background',
  'rect',
  'ellipse',
  'circle',
  'line',
  'triangle',
  'quad',
  'arc',
  'point',
  'vertex',
  'curveVertex',
  'bezierVertex',
  'endShape',
  'text',
  'image',
] as const;

export interface RunOptions {
  sceneId: string;
  workloadId: string;
  warmupFrames: number;
  frames: number;
  seed: number;
}

export interface RunResult {
  /** Wall-clock cost of each measured frame (update + draw + raster), in ms. */
  frameMs: number[];
  /** Drawing calls made in each measured frame. */
  drawCalls: number[];
  /** Approximate JS heap in use after the run, in bytes (Chromium only), or null. */
  heapBytes: number | null;
}

export interface PerfApi {
  ready: true;
  sceneIds(): string[];
  workloadIds(): string[];
  run(options: RunOptions): Promise<RunResult>;
}

declare global {
  interface Window {
    perf?: PerfApi;
  }
}

/** mulberry32: a small, fast, seedable PRNG standing in for Math.random. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MemoryStorage implements Storage {
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

class PerfMidi implements MidiAccessLike {
  readonly inputs = [{ id: DEVICE_ID, name: 'Perf Device' }];
  private readonly handlers = new Set<MidiMessageHandler>();
  onMessage(inputId: string, handler: MidiMessageHandler): () => void {
    if (inputId !== DEVICE_ID) return () => {};
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  onDeviceChange(): () => void {
    return () => {};
  }
  get connected(): boolean {
    return this.handlers.size > 0;
  }
  send(data: number[]): void {
    for (const handler of this.handlers) handler(data);
  }
}

/** The real p5 instance, with the extra members the harness drives. */
type HarnessP5 = P5Like & {
  noLoop(): void;
  redraw(): void;
  drawingContext: CanvasRenderingContext2D;
  [name: string]: unknown;
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function run(options: RunOptions): Promise<RunResult> {
  const workload = WORKLOADS.find((w) => w.id === options.workloadId);
  if (!workload) throw new Error(`Unknown workload "${options.workloadId}"`);

  const nativeRandom = Math.random;
  Math.random = seededRandom(options.seed);

  let clock = 0;
  let calls = 0;
  let instance: HarnessP5 | undefined;
  let setupDone = false;

  const createP5: P5Factory = (sketch, node) =>
    new p5((raw: unknown) => {
      const pp = raw as HarnessP5;
      sketch(pp);
      pp.millis = () => clock;
      for (const name of COUNTED_CALLS) {
        const original = pp[name];
        if (typeof original !== 'function') continue;
        pp[name] = function (this: unknown, ...args: unknown[]) {
          calls++;
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        };
      }
      const setup = pp.setup;
      pp.setup = () => {
        setup?.();
        pp.noLoop();
        setupDone = true;
      };
      instance = pp;
    }, node) as unknown as P5Like;

  const stage = document.getElementById('stage')!;
  const container = document.createElement('div');
  stage.replaceChildren(container);
  const midi = new PerfMidi();
  const engine = new VisualizerEngine(container, {
    createP5,
    scenes: createDefaultScenes(),
    createMidi: () => Promise.resolve(midi),
    storage: new MemoryStorage(),
  });

  try {
    for (let i = 0; i < 200 && !(setupDone && midi.connected); i++) await nextTask();
    if (!setupDone) throw new Error('p5 setup never ran');
    if (!midi.connected) throw new Error('The engine never listened to the perf Device');
    const p = instance!;

    engine.selectScene(options.sceneId);
    if (engine.activeSceneId !== options.sceneId) {
      throw new Error(`Scene "${options.sceneId}" could not be selected`);
    }

    const frameMs: number[] = [];
    const drawCalls: number[] = [];
    const total = options.warmupFrames + options.frames;
    for (let frame = 0; frame < total; frame++) {
      for (const command of workload.at(frame)) {
        midi.send(
          command.type === 'on' ? [0x90, command.note, command.velocity] : [0x80, command.note, 0],
        );
      }
      clock += FRAME_MS;
      calls = 0;
      const start = performance.now();
      p.redraw();
      p.drawingContext.getImageData(0, 0, 1, 1);
      const elapsed = performance.now() - start;
      if (frame >= options.warmupFrames) {
        frameMs.push(elapsed);
        drawCalls.push(calls);
      }
    }

    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return { frameMs, drawCalls, heapBytes: memory?.usedJSHeapSize ?? null };
  } finally {
    engine.destroy();
    Math.random = nativeRandom;
  }
}

/** The Scene ids to benchmark, No Scene included, read from a throwaway engine. */
function sceneIds(): string[] {
  // Constructing an engine needs a p5 instance; a stub suffices just to list Scenes.
  const stub = { remove() {} } as unknown as P5Like;
  const engine = new VisualizerEngine(document.createElement('div'), {
    createP5: (sketch) => {
      sketch(stub);
      return stub;
    },
    scenes: createDefaultScenes(),
    createMidi: () => new Promise(() => {}),
    storage: new MemoryStorage(),
  });
  const ids = engine.scenes.map((scene) => scene.id);
  engine.destroy();
  return ids;
}

window.perf = {
  ready: true,
  sceneIds,
  workloadIds: () => WORKLOADS.map((w) => w.id),
  run,
};
