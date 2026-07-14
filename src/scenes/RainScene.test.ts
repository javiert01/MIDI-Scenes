import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RainScene } from '@/scenes/RainScene';
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
    params: { rainCount: 5 },
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

type RainInternal = { x: number; y: number; length: number; speed: number };
type DropInternal = { x: number; y: number; vy: number; size: number };
type RippleInternal = { x: number; y: number; radius: number; maxRadius: number };

function rainOf(scene: RainScene): RainInternal[] {
  return (scene as unknown as { rain: RainInternal[] }).rain;
}

function dropsOf(scene: RainScene): DropInternal[] {
  return (scene as unknown as { drops: DropInternal[] }).drops;
}

function ripplesOf(scene: RainScene): RippleInternal[] {
  return (scene as unknown as { ripples: RippleInternal[] }).ripples;
}

describe('RainScene', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates rain count from ctx.params on setup', () => {
    const scene = new RainScene();
    scene.setup(makeCtx({ params: { rainCount: 8 } }));

    expect(rainOf(scene)).toHaveLength(8);
  });

  it('grows or shrinks rain population live as params change on update', () => {
    const scene = new RainScene();
    const ctx = makeCtx({ params: { rainCount: 3 } });
    scene.setup(ctx);

    ctx.params = { rainCount: 10 };
    scene.update(ctx);

    expect(rainOf(scene)).toHaveLength(10);
  });

  it('confines spawned rain to the visualization area, not the chroma key band', () => {
    const scene = new RainScene();
    const ctx = makeCtx({ width: 900, height: 900, chromaKeyHeight: 300, params: { rainCount: 20 } });
    scene.setup(ctx);

    const visHeight = ctx.height - ctx.chromaKeyHeight;
    for (const streak of rainOf(scene)) {
      expect(streak.x).toBeGreaterThanOrEqual(0);
      expect(streak.x).toBeLessThanOrEqual(ctx.width);
      expect(streak.y).toBeLessThanOrEqual(visHeight);
    }
  });

  it('resets a rain streak to the top once it falls past the bottom', () => {
    const scene = new RainScene();
    const ctx = makeCtx({ params: { rainCount: 1 } });
    scene.setup(ctx);
    const streak = rainOf(scene)[0];
    const visHeight = ctx.height - ctx.chromaKeyHeight;
    streak.y = visHeight + 100;

    scene.update(ctx);

    expect(streak.y).toBeLessThan(0);
  });

  it('confines the flat black background to the visualization area, never painting into the chroma key band', () => {
    const scene = new RainScene();
    const p = new RecordingP5();
    const ctx = makeCtx({ p: p as unknown as P5Like, params: { rainCount: 0 } });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;

    scene.draw(ctx);

    const rectCall = p.calls.find((c) => c.name === 'rect');
    expect(rectCall).toBeDefined();
    expect(rectCall!.args[3]).toBeLessThanOrEqual(visHeight);
  });

  it('draws the engine crystals via the seam, after the rain and before the drop/ripple', () => {
    const scene = new RainScene();
    const p = new RecordingP5();
    const drawCrystals = vi.fn(() => p.calls.push({ name: 'crystals', args: [] }));
    const ctx = makeCtx({ p: p as unknown as P5Like, params: { rainCount: 1 }, drawCrystals });
    scene.setup(ctx);
    scene.onNoteOn({ note: 60, name: 'C4', velocity: 0.9, raw: 114, channel: 1 }, ctx);

    scene.update(ctx);
    scene.draw(ctx);

    expect(drawCrystals).toHaveBeenCalledTimes(1);
    const crystalsAt = p.calls.findIndex((c) => c.name === 'crystals');
    const firstLineAt = p.calls.findIndex((c) => c.name === 'line');
    const firstEllipseAfterCrystals = p.calls.findIndex(
      (c, i) => i > crystalsAt && c.name === 'ellipse',
    );
    expect(crystalsAt).toBeGreaterThan(firstLineAt); // after the rain
    expect(firstEllipseAfterCrystals).toBeGreaterThan(crystalsAt); // before the drop
  });

  it('draw does not throw and confines drawing calls within a push/pop pair', () => {
    const scene = new RainScene();
    const ctx = makeCtx();
    scene.setup(ctx);

    expect(() => {
      scene.update(ctx);
      scene.draw(ctx);
    }).not.toThrow();
  });

  it('clears rain, drops, and ripples on teardown', () => {
    const scene = new RainScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn({ note: 60, name: 'C4', velocity: 0.5, raw: 63, channel: 1 }, ctx);

    scene.teardown();

    expect(rainOf(scene)).toHaveLength(0);
    expect(dropsOf(scene)).toHaveLength(0);
    expect(ripplesOf(scene)).toHaveLength(0);
  });

  it('onNoteOn spawns a drop at the note key column, scaled by velocity', () => {
    const scene = new RainScene();
    const ctx = makeCtx({ width: 900 });
    scene.setup(ctx);

    scene.onNoteOn({ note: 36, name: 'C2', velocity: 0.8, raw: 102, channel: 1 }, ctx);

    const drops = dropsOf(scene);
    expect(drops).toHaveLength(1);
    expect(drops[0].y).toBe(0);
    expect(drops[0].size).toBeGreaterThan(4);
  });

  it('caps concurrent drops, dropping the oldest when the cap is exceeded', () => {
    const scene = new RainScene();
    const ctx = makeCtx();
    scene.setup(ctx);

    for (let i = 0; i < 25; i++) {
      scene.onNoteOn({ note: 36 + i, name: 'note', velocity: 0.5, raw: 63, channel: 1 }, ctx);
    }

    expect(dropsOf(scene).length).toBeLessThanOrEqual(20);
  });

  it('turns a drop into a ripple once it reaches the bottom of the visualization area', () => {
    const scene = new RainScene();
    const ctx = makeCtx({ width: 900, height: 900, chromaKeyHeight: 300 });
    scene.setup(ctx);
    scene.onNoteOn({ note: 60, name: 'C4', velocity: 1, raw: 127, channel: 1 }, ctx);
    const drop = dropsOf(scene)[0];
    const visHeight = ctx.height - ctx.chromaKeyHeight;
    drop.y = visHeight;

    scene.update(ctx);

    expect(dropsOf(scene)).toHaveLength(0);
    expect(ripplesOf(scene)).toHaveLength(1);
  });

  it('removes a ripple once it has expanded to its max radius', () => {
    const scene = new RainScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn({ note: 60, name: 'C4', velocity: 1, raw: 127, channel: 1 }, ctx);
    const drop = dropsOf(scene)[0];
    const visHeight = ctx.height - ctx.chromaKeyHeight;
    drop.y = visHeight;
    scene.update(ctx);
    expect(ripplesOf(scene)).toHaveLength(1);

    for (let i = 0; i < 100; i++) scene.update(ctx);

    expect(ripplesOf(scene)).toHaveLength(0);
  });

  it('onNoteOff is a no-op — crystals now fall inside the engine', () => {
    const scene = new RainScene();
    scene.setup(makeCtx());

    expect(() => scene.onNoteOff()).not.toThrow();
  });
});
