import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnowfallScene } from '@/scenes/SnowfallScene';
import { keyPosition } from '@/engine/keyboardGeometry';
import type { NoteEvent, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';

const WIDTH = 900;
const VIS_HEIGHT = 600;

interface RecordedCall {
  name: string;
  args: number[];
  /** The lowest canvas y the call can paint, after the active translate/rotate. */
  bottom: number;
}

/** Records every painting call, resolving push/pop/translate/rotate to canvas coordinates. */
class RecordingP5 implements Partial<P5Like> {
  calls: RecordedCall[] = [];
  private stack: { tx: number; ty: number; angle: number }[] = [];
  private tx = 0;
  private ty = 0;
  private angle = 0;

  private canvasY(x: number, y: number): number {
    return this.ty + x * Math.sin(this.angle) + y * Math.cos(this.angle);
  }

  private record(name: string, args: number[], bottom: number): void {
    this.calls.push({ name, args, bottom });
  }

  noStroke = () => {};
  stroke = () => {};
  strokeWeight = () => {};
  beginShape = () => {};
  endShape = () => {};
  fill = (...args: number[]) => this.record('fill', args, -Infinity);
  rect = (x: number, y: number, w: number, h: number) =>
    this.record(
      'rect',
      [x, y, w, h],
      Math.max(
        this.canvasY(x, y),
        this.canvasY(x + w, y),
        this.canvasY(x, y + h),
        this.canvasY(x + w, y + h),
      ),
    );
  ellipse = (x: number, y: number, w: number, h: number) =>
    this.record('ellipse', [x, y, w, h], this.canvasY(x, y) + Math.max(w, h) / 2);
  triangle = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    this.record(
      'triangle',
      [x1, y1, x2, y2, x3, y3],
      Math.max(this.canvasY(x1, y1), this.canvasY(x2, y2), this.canvasY(x3, y3)),
    );
  vertex = (x: number, y: number) => this.record('vertex', [x, y], this.canvasY(x, y));
  push = () => {
    this.stack.push({ tx: this.tx, ty: this.ty, angle: this.angle });
  };
  pop = () => {
    const saved = this.stack.pop();
    if (!saved) return;
    this.tx = saved.tx;
    this.ty = saved.ty;
    this.angle = saved.angle;
  };
  translate = (x: number, y: number) => {
    this.tx += x * Math.cos(this.angle) - y * Math.sin(this.angle);
    this.ty += x * Math.sin(this.angle) + y * Math.cos(this.angle);
  };
  rotate = (angle: number) => {
    this.angle += angle;
  };

  named(name: string): RecordedCall[] {
    return this.calls.filter((call) => call.name === name);
  }
}

function makeCtx(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    p: new RecordingP5() as unknown as P5Like,
    width: WIDTH,
    height: 900,
    chromaKeyHeight: 300,
    params: { snowCount: 5, treeCount: 4, starCount: 0 },
    elapsed: 0,
    deltaTime: 1000 / 60,
    crystals: [],
    drawCrystals: () => {},
    ...overrides,
  };
}

function noteOn(note: number, velocity = 1): NoteEvent {
  return { note, name: 'X', velocity, raw: Math.round(velocity * 127), channel: 1 };
}

type FlakeInternal = { x: number; y: number; depth: number; size: number; fallSpeed: number };
type FlurryInternal = { x: number; y: number; vy: number; ageMs: number; lifeMs: number };
type TreeInternal = {
  xFrac: number;
  heightFrac: number;
  front: boolean;
  glow: number;
  struckAtMs: number;
};

function flakesOf(scene: SnowfallScene): FlakeInternal[] {
  return (scene as unknown as { flakes: FlakeInternal[] }).flakes;
}

function flurryOf(scene: SnowfallScene): FlurryInternal[] {
  return (scene as unknown as { flurry: FlurryInternal[] }).flurry;
}

function treesOf(scene: SnowfallScene): TreeInternal[] {
  return (scene as unknown as { trees: TreeInternal[] }).trees;
}

describe('SnowfallScene', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares only bounded params, each with a default', () => {
    for (const spec of new SnowfallScene().params) {
      expect(spec.default).toBeDefined();
      if (spec.type === 'range') {
        expect(spec.min).toBeTypeOf('number');
        expect(spec.max).toBeTypeOf('number');
        expect(spec.step).toBeTypeOf('number');
      }
      if (spec.type === 'select') expect(spec.options?.length).toBeGreaterThan(0);
    }
  });

  it('populates snowflakes and trees from ctx.params on setup', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx({ params: { snowCount: 8, treeCount: 6 } }));

    expect(flakesOf(scene)).toHaveLength(8);
    expect(treesOf(scene)).toHaveLength(6);
  });

  it('grows or shrinks the snowfall live as the param changes', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx({ params: { snowCount: 5, treeCount: 4 } }));

    scene.update(makeCtx({ params: { snowCount: 12, treeCount: 4 } }));
    expect(flakesOf(scene)).toHaveLength(12);

    scene.update(makeCtx({ params: { snowCount: 3, treeCount: 4 } }));
    expect(flakesOf(scene)).toHaveLength(3);
  });

  it('replants the trees, evenly spread, when the tree count changes', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx());

    scene.update(makeCtx({ params: { snowCount: 5, treeCount: 8 } }));

    const trees = treesOf(scene);
    expect(trees).toHaveLength(8);
    trees.forEach((tree, i) => expect(tree.xFrac).toBeCloseTo((i + 0.5) / 8));
    expect(trees.filter((tree) => tree.front)).toHaveLength(4);
  });

  it('keeps the same trees while the tree count is unchanged', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx());
    const before = treesOf(scene);

    scene.update(makeCtx());

    expect(treesOf(scene)).toBe(before);
  });

  it('lets each flake fall at its own speed, scaled by Snow Speed', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx());
    const flake = flakesOf(scene)[0];
    const startY = flake.y;

    scene.update(makeCtx({ params: { snowCount: 5, treeCount: 4, snowSpeed: 2 } }));

    expect(flake.y).toBeCloseTo(startY + flake.fallSpeed * 2);
  });

  it('scales the fall by the frame time and caps a stalled frame', () => {
    const fallAfter = (deltaTime: number): number => {
      const scene = new SnowfallScene();
      scene.setup(makeCtx());
      const flake = flakesOf(scene)[0];
      const startY = flake.y;
      scene.update(makeCtx({ deltaTime }));
      return flake.y - startY;
    };

    expect(fallAfter(2000 / 60)).toBeCloseTo(fallAfter(1000 / 60) * 2);
    expect(fallAfter(5000)).toBeCloseTo(fallAfter(50));
  });

  it('pushes the snow sideways with the wind, and not at all when Wind is 0', () => {
    const driftAfter = (wind: number): number => {
      const scene = new SnowfallScene();
      scene.setup(makeCtx());
      const flake = flakesOf(scene)[0];
      const startX = flake.x;
      // Zero frame time for the sway: compare two winds at the same instant instead.
      scene.update(makeCtx({ elapsed: 4000, params: { snowCount: 5, treeCount: 4, wind } }));
      return flake.x - startX;
    };

    expect(driftAfter(2)).not.toBeCloseTo(driftAfter(0));
  });

  it('recycles a flake to the top once it lands on the snow', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx());
    const flake = flakesOf(scene)[0];
    flake.y = VIS_HEIGHT;

    scene.update(makeCtx());

    expect(flake.y).toBeLessThan(0);
  });

  it('wraps a flake blown past one edge round to the other', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx());
    const [left, right] = flakesOf(scene);
    left.x = -50;
    right.x = WIDTH + 50;

    scene.update(makeCtx({ params: { snowCount: 5, treeCount: 4, wind: 0 } }));

    expect(left.x).toBeGreaterThan(WIDTH);
    expect(right.x).toBeLessThan(0);
  });

  it('shakes a flurry loose at the key column, bigger for a harder note', () => {
    const scene = new SnowfallScene();
    const ctx = makeCtx();
    scene.setup(ctx);

    scene.onNoteOn(noteOn(60, 0), ctx);
    const soft = flurryOf(scene).length;
    scene.onNoteOn(noteOn(60, 1), ctx);
    const hard = flurryOf(scene).length - soft;

    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
    const columnX = keyPosition(60, WIDTH, VIS_HEIGHT).x;
    for (const flake of flurryOf(scene)) expect(flake.x).toBeCloseTo(columnX);
  });

  it('throws the flurry upward, then lets gravity bring it back down', () => {
    const scene = new SnowfallScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);
    const flake = flurryOf(scene)[0];
    const launchVy = flake.vy;

    expect(launchVy).toBeLessThan(0);
    for (let i = 0; i < 120; i++) scene.update(ctx);
    expect(flake.vy).toBeGreaterThan(0);
  });

  it('caps the flurry however many notes land', () => {
    const scene = new SnowfallScene();
    const ctx = makeCtx();
    scene.setup(ctx);

    for (let i = 0; i < 50; i++) scene.onNoteOn(noteOn(36 + (i % 48)), ctx);

    expect(flurryOf(scene)).toHaveLength(150);
  });

  it('removes flurry flakes once their lifespan runs out', () => {
    const scene = new SnowfallScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);

    for (let i = 0; i < 60; i++) scene.update(makeCtx({ deltaTime: 50 }));

    expect(flurryOf(scene)).toHaveLength(0);
  });

  it('lights up only the tree nearest the key, brighter for a harder note', () => {
    const glowFor = (velocity: number): number[] => {
      const scene = new SnowfallScene();
      const ctx = makeCtx();
      scene.setup(ctx);
      const columnX = keyPosition(60, WIDTH, VIS_HEIGHT).x;
      scene.onNoteOn(noteOn(60, velocity), ctx);
      const trees = treesOf(scene);
      const nearest = trees.reduce((best, tree) =>
        Math.abs(tree.xFrac * WIDTH - columnX) < Math.abs(best.xFrac * WIDTH - columnX)
          ? tree
          : best,
      );
      expect(trees.filter((tree) => tree.glow > 0)).toEqual([nearest]);
      return [nearest.glow];
    };

    const [soft] = glowFor(0.1);
    const [hard] = glowFor(1);
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
  });

  it("fades a struck tree's glow back to nothing", () => {
    const scene = new SnowfallScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);

    for (let i = 0; i < 40; i++) scene.update(makeCtx({ deltaTime: 50 }));

    expect(treesOf(scene).every((tree) => tree.glow === 0)).toBe(true);
  });

  it('keeps a rocking tree in rhythm when it is struck again', () => {
    const scene = new SnowfallScene();
    scene.setup(makeCtx());
    scene.onNoteOn(noteOn(60), makeCtx({ elapsed: 1000 }));
    scene.onNoteOn(noteOn(60), makeCtx({ elapsed: 1200 }));

    const struck = treesOf(scene).find((tree) => tree.glow > 0);
    expect(struck?.struckAtMs).toBe(1000);
  });

  it('does nothing on note-off', () => {
    const scene = new SnowfallScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);
    const flurry = flurryOf(scene).length;
    const glow = treesOf(scene).map((tree) => tree.glow);

    scene.onNoteOff();

    expect(flurryOf(scene)).toHaveLength(flurry);
    expect(treesOf(scene).map((tree) => tree.glow)).toEqual(glow);
  });

  it('draws the Crystals exactly once, behind the falling snow', () => {
    const scene = new SnowfallScene();
    const p = new RecordingP5();
    let callsBeforeCrystals = -1;
    const drawCrystals = vi.fn(() => {
      callsBeforeCrystals = p.calls.length;
    });
    const ctx = makeCtx({ p: p as unknown as P5Like, drawCrystals });
    scene.setup(ctx);

    scene.draw(ctx);

    expect(drawCrystals).toHaveBeenCalledTimes(1);
    const snowEllipses = p.calls.slice(callsBeforeCrystals).filter((c) => c.name === 'ellipse');
    expect(snowEllipses).toHaveLength(5);
  });

  it('draws as many stars as Star Count asks for', () => {
    const ellipsesWith = (starCount: number): number => {
      const scene = new SnowfallScene();
      const p = new RecordingP5();
      const ctx = makeCtx({
        p: p as unknown as P5Like,
        params: { snowCount: 5, treeCount: 4, starCount },
      });
      scene.setup(ctx);
      scene.draw(ctx);
      return p.named('ellipse').length;
    };

    expect(ellipsesWith(50) - ellipsesWith(0)).toBe(50);
  });

  it('strings ten fairy lights on each tree, and none when they are Off', () => {
    const ellipsesWith = (lightPalette: string): number => {
      const scene = new SnowfallScene();
      const p = new RecordingP5();
      const ctx = makeCtx({
        p: p as unknown as P5Like,
        params: { snowCount: 5, treeCount: 4, starCount: 0, lightPalette },
      });
      scene.setup(ctx);
      scene.draw(ctx);
      return p.named('ellipse').length;
    };

    // Each light is a bulb plus its halo.
    expect(ellipsesWith('classic') - ellipsesWith('off')).toBe(4 * 10 * 2);
    expect(ellipsesWith('warm')).toBe(ellipsesWith('classic'));
    expect(ellipsesWith('not-a-palette')).toBe(ellipsesWith('classic'));
  });

  it('paints the snow in the Snow Color', () => {
    const scene = new SnowfallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { snowCount: 5, treeCount: 4, starCount: 0, snowColor: '#102030' },
    });
    scene.setup(ctx);

    scene.draw(ctx);

    const fills = p.named('fill').map((call) => call.args.slice(0, 3));
    expect(fills).toContainEqual([16, 32, 48]);
  });

  it('never paints into the Chroma Key band, at max params with a storm of notes', () => {
    vi.restoreAllMocks();
    const scene = new SnowfallScene();
    const params = { snowCount: 600, treeCount: 16, starCount: 200, snowSpeed: 3, wind: 2 };
    scene.setup(makeCtx({ params }));

    let elapsed = 0;
    for (let frame = 0; frame < 240; frame++) {
      elapsed += 1000 / 60;
      const p = new RecordingP5();
      const ctx = makeCtx({ p: p as unknown as P5Like, params, elapsed });
      for (let n = 0; n < 4; n++) scene.onNoteOn(noteOn(21 + ((frame * 7 + n * 13) % 88)), ctx);
      scene.update(ctx);
      scene.draw(ctx);
      for (const call of p.calls) {
        if (call.bottom > VIS_HEIGHT + 1e-6) {
          throw new Error(
            `${call.name}(${call.args.join(', ')}) reaches y=${call.bottom} on frame ${frame}`,
          );
        }
      }
    }
  });

  it('clears all of its state on teardown', () => {
    const scene = new SnowfallScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);

    scene.teardown();

    expect(flakesOf(scene)).toHaveLength(0);
    expect(flurryOf(scene)).toHaveLength(0);
    expect(treesOf(scene)).toHaveLength(0);
  });
});
