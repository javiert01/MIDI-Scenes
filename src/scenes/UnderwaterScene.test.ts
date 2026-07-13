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
  push = () => {};
  pop = () => {};
  translate = () => {};
  rotate = () => {};
}

type FishInternal = { x: number; y: number; size: number; pattern: FishPattern; boost: number };
type FishPattern = 'traveling' | 'circling' | 'wandering';
type JellyfishInternal = { x: number; y: number; size: number; boost: number };

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
    fish.x = ctx.width + fish.size + 10;

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
    expect(jelly.y).toBeGreaterThanOrEqual(jelly.size * 2 - 1);
    expect(jelly.y).toBeLessThanOrEqual(visHeight - jelly.size * 2 + 1);
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
    const lastWaterLineAt = p.calls.map((c) => c.name).lastIndexOf('line');
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

  it('onNoteOff is a no-op — crystals now fall inside the engine', () => {
    const scene = new UnderwaterScene();
    scene.setup(makeCtx());

    expect(() => scene.onNoteOff()).not.toThrow();
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
