import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GreatHallScene } from '@/scenes/GreatHallScene';
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
};

function makeCtx(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    p: NOOP_P5 as P5Like,
    width: 900,
    height: 900,
    chromaKeyHeight: 300,
    params: { candleCount: 4, cloudCount: 2 },
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
}

type CandleInternal = {
  x: number;
  baseY: number;
  bodyHeight: number;
  bobAmplitude: number;
  flare: number;
};
type CloudInternal = { x: number; y: number };
type OwlInternal = {
  x: number;
  y: number;
  baseY: number;
  size: number;
  direction: 1 | -1;
  bobAmplitude: number;
};

function candlesOf(scene: GreatHallScene): CandleInternal[] {
  return (scene as unknown as { candles: CandleInternal[] }).candles;
}

function cloudsOf(scene: GreatHallScene): CloudInternal[] {
  return (scene as unknown as { clouds: CloudInternal[] }).clouds;
}

function owlsOf(scene: GreatHallScene): OwlInternal[] {
  return (scene as unknown as { owls: OwlInternal[] }).owls;
}

describe('GreatHallScene', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates candle and cloud counts from ctx.params on setup', () => {
    const scene = new GreatHallScene();
    scene.setup(makeCtx({ params: { candleCount: 6, cloudCount: 3 } }));

    expect(candlesOf(scene)).toHaveLength(6);
    expect(cloudsOf(scene)).toHaveLength(3);
  });

  it('grows or shrinks candle and cloud populations live as params change on update', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ params: { candleCount: 4, cloudCount: 2 } });
    scene.setup(ctx);

    ctx.params = { candleCount: 10, cloudCount: 5 };
    scene.update(ctx);

    expect(candlesOf(scene)).toHaveLength(10);
    expect(cloudsOf(scene)).toHaveLength(5);
  });

  it('keeps every candle — even at the bottom of its levitation bob — inside the visualization area', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ width: 900, height: 900, chromaKeyHeight: 300 });
    scene.setup(ctx);

    const visHeight = ctx.height - ctx.chromaKeyHeight;
    for (const candle of candlesOf(scene)) {
      expect(candle.baseY + candle.bodyHeight + candle.bobAmplitude).toBeLessThanOrEqual(visHeight);
      expect(candle.baseY - candle.bobAmplitude).toBeGreaterThanOrEqual(0);
    }
  });

  it('spawns clouds in the upper part of the visualization area, never in the chroma key band', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ width: 900, height: 900, chromaKeyHeight: 300 });
    scene.setup(ctx);

    const visHeight = ctx.height - ctx.chromaKeyHeight;
    for (const cloud of cloudsOf(scene)) {
      expect(cloud.y).toBeGreaterThanOrEqual(0);
      expect(cloud.y).toBeLessThanOrEqual(visHeight * 0.4);
    }
  });

  it('populates the owl count from ctx.params on setup and resizes it live on update', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ params: { candleCount: 4, cloudCount: 2, owlCount: 1 } });
    scene.setup(ctx);

    expect(owlsOf(scene)).toHaveLength(1);

    ctx.params = { candleCount: 4, cloudCount: 2, owlCount: 3 };
    scene.update(ctx);

    expect(owlsOf(scene)).toHaveLength(3);
  });

  it('keeps an owl — wing tips and full bob included — inside the visualization area', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ width: 900, height: 900, chromaKeyHeight: 300 });
    scene.setup(ctx);

    const visHeight = ctx.height - ctx.chromaKeyHeight;
    for (const owl of owlsOf(scene)) {
      expect(owl.baseY - owl.bobAmplitude - owl.size * 1.5).toBeGreaterThanOrEqual(0);
      expect(owl.baseY + owl.bobAmplitude + owl.size).toBeLessThanOrEqual(visHeight);
    }
  });

  it('flies an owl horizontally while bobbing it on a sine around its base altitude', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ params: { candleCount: 0, cloudCount: 0, owlCount: 1 } });
    scene.setup(ctx);
    const owl = owlsOf(scene)[0];
    const startX = owl.x;

    scene.update({ ...ctx, elapsed: 0 });
    const yAtStart = owl.y;
    scene.update({ ...ctx, elapsed: 875 });

    expect(owl.x).not.toBe(startX);
    expect(owl.y).not.toBe(yAtStart);
    expect(Math.abs(owl.y - owl.baseY)).toBeLessThanOrEqual(owl.bobAmplitude + 1e-9);
  });

  it('wraps an owl that flies past the right edge back to the left edge', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ params: { candleCount: 0, cloudCount: 0, owlCount: 1 } });
    scene.setup(ctx);
    const owl = owlsOf(scene)[0];
    owl.direction = 1;
    owl.x = ctx.width + owl.size * 2 + 10;

    scene.update(ctx);

    expect(owl.x).toBeLessThan(0);
  });

  it('confines the sky gradient to the visualization area, never painting into the chroma key band', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({ p: p as unknown as P5Like, params: { candleCount: 0, cloudCount: 0 } });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;

    scene.draw(ctx);

    const lineYs = p.calls.filter((c) => c.name === 'line').map((c) => c.args[1] as number);
    expect(lineYs.length).toBeGreaterThan(0);
    for (const y of lineYs) expect(y).toBeLessThan(visHeight);
  });

  it('draws the engine crystals via the seam, after the sky and clouds and before the candles', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const drawCrystals = vi.fn(() => p.calls.push({ name: 'crystals', args: [] }));
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      // Castle off so the only rects are candle bodies, keeping the
      // candle-ordering assertion unambiguous.
      params: { candleCount: 2, cloudCount: 1, castle: false },
      drawCrystals,
    });
    scene.setup(ctx);

    scene.update(ctx);
    scene.draw(ctx);

    expect(drawCrystals).toHaveBeenCalledTimes(1);
    const crystalsAt = p.calls.findIndex((c) => c.name === 'crystals');
    const lastSkyLineAt = p.calls.map((c) => c.name).lastIndexOf('line');
    const lastCloudEllipseAt = p.calls
      .map((c, i) => (c.name === 'ellipse' && i < crystalsAt ? i : -1))
      .reduce((a, b) => Math.max(a, b), -1);
    const firstCandleRectAt = p.calls.findIndex((c) => c.name === 'rect');
    expect(crystalsAt).toBeGreaterThan(lastSkyLineAt); // after the sky gradient
    expect(lastCloudEllipseAt).toBeGreaterThan(-1); // clouds drew before crystals
    expect(crystalsAt).toBeLessThan(firstCandleRectAt); // before the candle bodies
  });

  it('confines the castle to the right quarter of the visualization area, above the chroma key band', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 0, cloudCount: 0, owlCount: 0 },
    });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;

    scene.draw(ctx);

    // With no candles, clouds, or owls, every rect and triangle is the castle.
    const rects = p.calls.filter((c) => c.name === 'rect');
    expect(rects).toHaveLength(3); // the three towers, nothing else
    for (const rect of rects) {
      const [x, y, , h] = rect.args as number[];
      expect(x).toBeGreaterThanOrEqual(ctx.width * 0.75);
      expect(y + h).toBeLessThanOrEqual(visHeight);
    }
    // The right tower sits flush against the right edge.
    const rightEdge = Math.max(...rects.map((r) => (r.args[0] as number) + (r.args[2] as number)));
    expect(rightEdge).toBeCloseTo(ctx.width);
    const spires = p.calls.filter((c) => c.name === 'triangle');
    expect(spires).toHaveLength(3);
    for (const spire of spires) {
      const xs = [spire.args[0], spire.args[2], spire.args[4]] as number[];
      for (const x of xs) expect(x).toBeGreaterThanOrEqual(ctx.width * 0.75);
    }
  });

  it('draws no castle when the toggle is off', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 0, cloudCount: 0, owlCount: 0, castle: false },
    });
    scene.setup(ctx);

    scene.draw(ctx);

    expect(p.calls.filter((c) => c.name === 'rect')).toHaveLength(0);
    expect(p.calls.filter((c) => c.name === 'triangle')).toHaveLength(0);
  });

  it('paints the castle as the backdrop, behind the owls and the crystals', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const drawCrystals = vi.fn(() => p.calls.push({ name: 'crystals', args: [] }));
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 0, cloudCount: 0, owlCount: 1 },
      drawCrystals,
    });
    scene.setup(ctx);

    scene.update(ctx);
    scene.draw(ctx);

    const firstCastleRectAt = p.calls.findIndex((c) => c.name === 'rect');
    const firstOwlEllipseAt = p.calls.findIndex((c) => c.name === 'ellipse');
    const crystalsAt = p.calls.findIndex((c) => c.name === 'crystals');
    expect(firstCastleRectAt).toBeGreaterThan(-1);
    expect(firstOwlEllipseAt).toBeGreaterThan(firstCastleRectAt); // owl over the castle
    expect(crystalsAt).toBeGreaterThan(firstOwlEllipseAt); // crystals over both
  });

  it('fires a lightning flash once the randomly scheduled interval elapses', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({ p: p as unknown as P5Like });
    scene.setup(ctx);

    // Math.random is pinned to 0.5, so the first flash lands at 14 000 ms.
    scene.update({ ...ctx, elapsed: 14_001 });
    scene.draw({ ...ctx, elapsed: 14_001 });

    const fullScreenRects = p.calls.filter((c) => c.name === 'rect' && c.args[2] === ctx.width);
    expect(fullScreenRects).toHaveLength(1);
  });

  it('fades the lightning flash out instead of holding it', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({ p: p as unknown as P5Like });
    scene.setup(ctx);

    scene.update({ ...ctx, elapsed: 14_001 });
    scene.draw({ ...ctx, elapsed: 15_000 });

    const fullScreenRects = p.calls.filter((c) => c.name === 'rect' && c.args[2] === ctx.width);
    expect(fullScreenRects).toHaveLength(0);
  });

  it('never flashes when the lightning toggle is off', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 4, cloudCount: 2, lightning: false },
    });
    scene.setup(ctx);

    scene.update({ ...ctx, elapsed: 30_000 });
    scene.draw({ ...ctx, elapsed: 30_000 });

    const fullScreenRects = p.calls.filter((c) => c.name === 'rect' && c.args[2] === ctx.width);
    expect(fullScreenRects).toHaveLength(0);
  });

  it('onNoteOn flares the candle nearest the key column, scaled by velocity', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ width: 900, params: { candleCount: 2, cloudCount: 0 } });
    scene.setup(ctx);
    const candles = candlesOf(scene);
    candles[0].x = 0;
    candles[1].x = 890;

    // Note 36 (C2) maps to the leftmost key column.
    scene.onNoteOn({ note: 36, name: 'C2', velocity: 0.8, raw: 102, channel: 1 }, ctx);

    expect(candles[0].flare).toBeCloseTo(0.8);
    expect(candles[1].flare).toBe(0);
  });

  it('decays a candle flare over subsequent updates', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({ width: 900, params: { candleCount: 1, cloudCount: 0 } });
    scene.setup(ctx);

    scene.onNoteOn({ note: 36, name: 'C2', velocity: 1, raw: 127, channel: 1 }, ctx);
    const flareAfterNoteOn = candlesOf(scene)[0].flare;

    scene.update(ctx);

    expect(candlesOf(scene)[0].flare).toBeLessThan(flareAfterNoteOn);
    expect(candlesOf(scene)[0].flare).toBeGreaterThan(0);
  });

  it('onNoteOff is a no-op — crystals fall inside the engine', () => {
    const scene = new GreatHallScene();
    scene.setup(makeCtx());

    expect(() => scene.onNoteOff()).not.toThrow();
  });

  it('draw does not throw across update/draw cycles', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx();
    scene.setup(ctx);

    expect(() => {
      for (let i = 0; i < 10; i++) {
        scene.update({ ...ctx, elapsed: i * 16 });
        scene.draw({ ...ctx, elapsed: i * 16 });
      }
    }).not.toThrow();
  });

  it('clears its populations on teardown', () => {
    const scene = new GreatHallScene();
    scene.setup(makeCtx());

    scene.teardown();

    expect(candlesOf(scene)).toHaveLength(0);
    expect(cloudsOf(scene)).toHaveLength(0);
    expect(owlsOf(scene)).toHaveLength(0);
  });
});
