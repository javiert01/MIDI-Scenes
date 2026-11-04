import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnderwaterScene } from '@/scenes/UnderwaterScene';
import type { SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';

const NOOP_P5: Partial<P5Like> = {
  noStroke: () => {},
  stroke: () => {},
  strokeWeight: () => {},
  line: () => {},
  fill: () => {},
  rect: () => {},
  ellipse: () => {},
  triangle: () => {},
  noFill: () => {},
  beginShape: () => {},
  vertex: () => {},
  endShape: () => {},
  push: () => {},
  pop: () => {},
  translate: () => {},
  rotate: () => {},
};

function makeCtx(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    p: NOOP_P5 as P5Like,
    width: 900,
    height: 900,
    chromaKeyHeight: 300,
    params: { fishCount: 2, jellyfishCount: 2 },
    elapsed: 0,
    deltaTime: 16,
    crystals: [],
    drawCrystals: () => {},
    ...overrides,
  };
}

interface RecordedCall {
  name: string;
  args: unknown[];
}

class RecordingP5 implements Partial<P5Like> {
  calls: RecordedCall[] = [];
  noStroke = () => {};
  stroke = (...args: number[]) => this.calls.push({ name: 'stroke', args });
  strokeWeight = () => {};
  line = (...args: number[]) => this.calls.push({ name: 'line', args });
  fill = (...args: number[]) => this.calls.push({ name: 'fill', args });
  rect = (...args: number[]) => this.calls.push({ name: 'rect', args });
  ellipse = (...args: number[]) => this.calls.push({ name: 'ellipse', args });
  triangle = (...args: number[]) => this.calls.push({ name: 'triangle', args });
  noFill = () => {};
  beginShape = () => {};
  vertex = () => {};
  endShape = () => {};
  push = () => {};
  pop = () => {};
  translate = () => {};
  rotate = () => {};
}

/** Follows p5's transform stack and reports how far down the canvas drawing actually lands. */
class ExtentP5 implements Partial<P5Like> {
  maxY = -Infinity;
  longestLine = 0;
  private matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private stack: (typeof this.matrix)[] = [];
  private weight = 1;

  reset(): void {
    this.maxY = -Infinity;
    this.longestLine = 0;
  }

  private canvasY(x: number, y: number): number {
    return this.matrix.b * x + this.matrix.d * y + this.matrix.f;
  }

  private reach(x: number, y: number, radius: number): void {
    this.maxY = Math.max(this.maxY, this.canvasY(x, y) + radius);
  }

  noStroke = () => {};
  stroke = () => {};
  noFill = () => {};
  fill = () => {};
  strokeWeight = (weight: number) => {
    this.weight = weight;
  };
  line = (x1: number, y1: number, x2: number, y2: number) => {
    this.reach(x1, y1, this.weight / 2);
    this.reach(x2, y2, this.weight / 2);
    this.longestLine = Math.max(this.longestLine, Math.hypot(x2 - x1, y2 - y1));
  };
  ellipse = (x: number, y: number, w: number, h: number) => this.reach(x, y, Math.max(w, h) / 2);
  triangle = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    this.reach(x1, y1, 0);
    this.reach(x2, y2, 0);
    this.reach(x3, y3, 0);
  };
  beginShape = () => {};
  vertex = (x: number, y: number) => this.reach(x, y, 0);
  endShape = () => {};
  push = () => {
    this.stack.push({ ...this.matrix });
  };
  pop = () => {
    this.matrix = this.stack.pop() ?? this.matrix;
  };
  translate = (x: number, y: number) => {
    const m = this.matrix;
    m.e += m.a * x + m.c * y;
    m.f += m.b * x + m.d * y;
  };
  rotate = (angle: number) => {
    const { a, b, c, d } = this.matrix;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.matrix.a = a * cos + c * sin;
    this.matrix.b = b * cos + d * sin;
    this.matrix.c = c * cos - a * sin;
    this.matrix.d = d * cos - b * sin;
  };
}

type FishInternal = {
  x: number;
  y: number;
  size: number;
  direction: number;
  centerY: number;
  radiusY: number;
  swimPhase: number;
  pattern: FishPattern;
  boost: number;
};
type FishPattern = 'traveling' | 'circling' | 'wandering';
type JellyfishInternal = {
  x: number;
  y: number;
  size: number;
  boost: number;
  chain: Float32Array;
};

function fishOf(scene: UnderwaterScene): FishInternal[] {
  return (scene as unknown as { fish: FishInternal[] }).fish;
}

function jellyfishOf(scene: UnderwaterScene): JellyfishInternal[] {
  return (scene as unknown as { jellyfish: JellyfishInternal[] }).jellyfish;
}

describe('UnderwaterScene', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates fish and jellyfish counts from ctx.params on setup', () => {
    const scene = new UnderwaterScene();
    scene.setup(makeCtx({ params: { fishCount: 5, jellyfishCount: 3 } }));

    expect(fishOf(scene)).toHaveLength(5);
    expect(jellyfishOf(scene)).toHaveLength(3);
  });

  it('grows or shrinks fish and jellyfish populations live as params change on update', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ params: { fishCount: 2, jellyfishCount: 2 } });
    scene.setup(ctx);

    ctx.params = { fishCount: 5, jellyfishCount: 1 };
    scene.update(ctx);

    expect(fishOf(scene)).toHaveLength(5);
    expect(jellyfishOf(scene)).toHaveLength(1);
  });

  it('confines spawned fish and jellyfish to the visualization area, not the chroma key band', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ width: 900, height: 900, chromaKeyHeight: 300 });
    scene.setup(ctx);

    const visHeight = ctx.height - ctx.chromaKeyHeight;
    for (const fish of fishOf(scene)) {
      expect(fish.y).toBeGreaterThanOrEqual(0);
      expect(fish.y).toBeLessThanOrEqual(visHeight);
    }
    for (const jelly of jellyfishOf(scene)) {
      expect(jelly.y).toBeGreaterThanOrEqual(0);
      expect(jelly.y).toBeLessThanOrEqual(visHeight);
    }
  });

  it('wraps a wandering fish that drifts past the right edge back to the left edge', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ params: { fishCount: 1, jellyfishCount: 0 } });
    scene.setup(ctx);
    const fish = fishOf(scene)[0];
    fish.pattern = 'wandering';
    fish.x = ctx.width + fish.size * 3 + 10; // past the edge with its whole body

    scene.update(ctx);

    expect(fish.x).toBeLessThan(ctx.width);
  });

  it('keeps a jellyfish within the visualization band vertically, never drifting into the chroma key area', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({
      width: 900,
      height: 900,
      chromaKeyHeight: 300,
      params: { fishCount: 0, jellyfishCount: 1 },
    });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;

    for (let i = 0; i < 500; i++) scene.update(ctx);

    const jelly = jellyfishOf(scene)[0];
    expect(jelly.y).toBeGreaterThanOrEqual(jelly.size);
    expect(jelly.y).toBeLessThanOrEqual(visHeight - jelly.size * 2);
  });

  it('never paints a creature into the band, at full population, speed and boost', () => {
    let seed = 7;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    const scene = new UnderwaterScene();
    const p = new ExtentP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      width: 1600,
      height: 800,
      chromaKeyHeight: 800 / 3,
      params: { fishCount: 40, jellyfishCount: 20, creatureSpeed: 3 },
      drawCrystals: () => p.reset(), // everything measured from here on is a creature
    });
    const visHeight = ctx.height - ctx.chromaKeyHeight;
    scene.setup(ctx);

    for (let frame = 0; frame < 2500; frame++) {
      if (frame % 20 === 0) {
        const note = 36 + (frame % 61);
        scene.onNoteOn({ note, name: 'n', velocity: 1, raw: 127, channel: 1 }, ctx);
      }
      scene.update(ctx);
      scene.draw(ctx);
      expect(p.maxY).toBeLessThanOrEqual(visHeight);
    }
  });

  it('keeps a circling fish inside the band even when its orbit would not fit', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ params: { fishCount: 1, jellyfishCount: 0 } });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;
    const fish = fishOf(scene)[0];
    fish.pattern = 'circling';
    fish.centerY = visHeight;
    fish.radiusY = visHeight * 2;

    for (let i = 0; i < 800; i++) {
      scene.update(ctx);
      expect(fish.y + fish.size).toBeLessThanOrEqual(visHeight);
      expect(fish.y - fish.size).toBeGreaterThanOrEqual(0);
    }
  });

  it('turns a wandering fish back from the floor rather than wrapping it through the band', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ params: { fishCount: 1, jellyfishCount: 0 } });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;
    const fish = fishOf(scene)[0];
    fish.pattern = 'wandering';
    fish.y = visHeight - fish.size * 3;
    fish.direction = Math.PI / 2; // straight down

    let lowest = fish.y;
    let biggestStep = 0;
    for (let i = 0; i < 300; i++) {
      const before = fish.y;
      scene.update(ctx);
      lowest = Math.max(lowest, fish.y);
      biggestStep = Math.max(biggestStep, Math.abs(fish.y - before));
    }

    expect(lowest).toBeLessThan(visHeight);
    expect(fish.y).toBeLessThan(lowest); // climbed away again
    expect(biggestStep).toBeLessThan(fish.size); // swam there: no teleport to the top
  });

  it('scales a circling fish with Creature Speed, like every other pattern', () => {
    const travelled = (creatureSpeed: number): number => {
      const scene = new UnderwaterScene();
      const ctx = makeCtx({ params: { fishCount: 1, jellyfishCount: 0, creatureSpeed } });
      scene.setup(ctx);
      const fish = fishOf(scene)[0];
      fish.pattern = 'circling';
      let distance = 0;
      scene.update(ctx);
      for (let i = 0; i < 10; i++) {
        const { x, y } = fish;
        scene.update(ctx);
        distance += Math.hypot(fish.x - x, fish.y - y);
      }
      return distance;
    };

    expect(travelled(2)).toBeCloseTo(travelled(1) * 2, 0);
  });

  it("beats a boosted fish's tail faster, within a limit that stops it strobing", () => {
    const beatOver = (creatureSpeed: number, velocity: number): number => {
      const scene = new UnderwaterScene();
      const ctx = makeCtx({ params: { fishCount: 1, jellyfishCount: 0, creatureSpeed } });
      scene.setup(ctx);
      const fish = fishOf(scene)[0];
      fish.x = 0;
      fish.y = 0;
      scene.onNoteOn({ note: 36, name: 'C2', velocity, raw: 127, channel: 1 }, ctx);
      const before = fish.swimPhase;
      scene.update(ctx);
      return fish.swimPhase - before;
    };

    expect(beatOver(1, 1)).toBeGreaterThan(beatOver(1, 0));
    expect(beatOver(3, 1)).toBeCloseTo(beatOver(1.5, 1));
  });

  it('carries the tentacles along when a jellyfish wraps across the canvas edge', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ params: { fishCount: 0, jellyfishCount: 1 } });
    scene.setup(ctx);
    for (let i = 0; i < 30; i++) scene.update(ctx);
    const jelly = jellyfishOf(scene)[0];
    const tipOffset = () => jelly.chain[jelly.chain.length - 2] - jelly.x;
    const before = tipOffset();

    // Past the right edge, tentacles included — the very next update must wrap it.
    const shift = ctx.width + 1000 - jelly.x;
    jelly.x += shift;
    for (let i = 0; i < jelly.chain.length; i += 2) jelly.chain[i] += shift;

    scene.update(ctx);

    expect(jelly.x).toBeLessThan(ctx.width);
    expect(Math.abs(tipOffset() - before)).toBeLessThan(jelly.size);
  });

  it('confines the water background gradient to the visualization area, never painting into the chroma key band', () => {
    const scene = new UnderwaterScene();
    const p = new RecordingP5();
    const ctx = makeCtx({ p: p as unknown as P5Like, params: { fishCount: 0, jellyfishCount: 0 } });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;

    scene.draw(ctx);

    const lineYs = p.calls.filter((c) => c.name === 'line').map((c) => c.args[1] as number);
    expect(lineYs.length).toBeGreaterThan(0);
    for (const y of lineYs) expect(y).toBeLessThan(visHeight);
  });

  it('draws the engine crystals via the seam, after the water and before the creatures', () => {
    const scene = new UnderwaterScene();
    const p = new RecordingP5();
    const drawCrystals = vi.fn(() => p.calls.push({ name: 'crystals', args: [] }));
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { fishCount: 1, jellyfishCount: 1 },
      drawCrystals,
    });
    scene.setup(ctx);

    scene.update(ctx);
    scene.draw(ctx);

    expect(drawCrystals).toHaveBeenCalledTimes(1);
    const crystalsAt = p.calls.findIndex((c) => c.name === 'crystals');
    const lastWaterLineAt = p.calls
      .map((c) => c.name === 'line' && c.args[2] === ctx.width)
      .lastIndexOf(true);
    const firstCreatureAt = p.calls.findIndex((c) => c.name === 'ellipse' || c.name === 'triangle');
    expect(crystalsAt).toBeGreaterThan(lastWaterLineAt); // after the water
    expect(crystalsAt).toBeLessThan(firstCreatureAt); // before the fish/jellyfish
  });

  it('draw does not throw and confines drawing calls within a push/pop pair', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx();
    scene.setup(ctx);

    expect(() => {
      scene.update(ctx);
      scene.draw(ctx);
    }).not.toThrow();
  });

  it('clears its populations on teardown', () => {
    const scene = new UnderwaterScene();
    scene.setup(makeCtx());

    scene.teardown();

    expect(fishOf(scene)).toHaveLength(0);
    expect(jellyfishOf(scene)).toHaveLength(0);
  });

  it('onNoteOn boosts the creature nearest the key position, scaled by velocity', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ width: 900, params: { fishCount: 1, jellyfishCount: 0 } });
    scene.setup(ctx);
    const fish = fishOf(scene)[0];
    fish.x = 0;
    fish.y = 0;

    scene.onNoteOn({ note: 36, name: 'C2', velocity: 0.8, raw: 102, channel: 1 }, ctx);

    expect(fish.boost).toBeCloseTo(0.8);
  });

  it('decays the boost effect on a creature over subsequent updates', () => {
    const scene = new UnderwaterScene();
    const ctx = makeCtx({ width: 900, params: { fishCount: 1, jellyfishCount: 0 } });
    scene.setup(ctx);
    const fish = fishOf(scene)[0];
    fish.x = 0;
    fish.y = 0;

    scene.onNoteOn({ note: 36, name: 'C2', velocity: 1, raw: 127, channel: 1 }, ctx);
    const boostAfterNoteOn = fish.boost;

    scene.update(ctx);

    expect(fish.boost).toBeLessThan(boostAfterNoteOn);
    expect(fish.boost).toBeGreaterThan(0);
  });
});
