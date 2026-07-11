import { describe, expect, it } from 'vitest';
import { VisualizerEngine } from '@/engine/VisualizerEngine';
import type { P5Factory, P5Like } from '@/engine/types';

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

  createCanvas(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.calls.push({ name: 'createCanvas', args: [w, h] });
  }

  noStroke() {
    this.calls.push({ name: 'noStroke', args: [] });
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
