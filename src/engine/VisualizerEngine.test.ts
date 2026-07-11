import { describe, expect, it, vi } from 'vitest';
import { VisualizerEngine } from '@/engine/VisualizerEngine';
import type { P5Factory, P5Like } from '@/engine/types';
import type { ParamSpec, Scene, SceneContext } from '@/engine/scene';

interface RecordedCall {
  name: string;
  args: unknown[];
}

class StubP5 implements P5Like {
  width = 0;
  height = 0;
  setup?: () => void;
  draw?: () => void;
  calls: RecordedCall[] = [];
  private clock = 0;

  createCanvas(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.calls.push({ name: 'createCanvas', args: [w, h] });
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
