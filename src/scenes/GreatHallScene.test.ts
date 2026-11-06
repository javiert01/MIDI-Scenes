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
  rotate: () => {},
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
  rotate = () => {};
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
  hasLetter: boolean;
};
type FallingLetterInternal = { x: number; y: number; size: number };
type MoteInternal = { x: number; y: number; vy: number; life: number };

function motesOf(scene: GreatHallScene, kind: 'dust' | 'sparks'): MoteInternal[] {
  return (scene as unknown as Record<'dust' | 'sparks', MoteInternal[]>)[kind];
}

function candlesOf(scene: GreatHallScene): CandleInternal[] {
  return (scene as unknown as { candles: CandleInternal[] }).candles;
}

function cloudsOf(scene: GreatHallScene): CloudInternal[] {
  return (scene as unknown as { clouds: CloudInternal[] }).clouds;
}

function owlsOf(scene: GreatHallScene): OwlInternal[] {
  return (scene as unknown as { owls: OwlInternal[] }).owls;
}

function fallingLettersOf(scene: GreatHallScene): FallingLetterInternal[] {
  return (scene as unknown as { fallingLetters: FallingLetterInternal[] }).fallingLetters;
}

/** Index of the first `fill` call with exactly this RGB (any alpha), or -1. */
function fillAt(calls: RecordedCall[], r: number, g: number, b: number, from = 0): number {
  return calls.findIndex(
    (c, i) =>
      i >= from && c.name === 'fill' && c.args[0] === r && c.args[1] === g && c.args[2] === b,
  );
}

/** The `line` calls drawn while the stroke was this RGB (any alpha). */
function linesInStroke(calls: RecordedCall[], r: number, g: number, b: number): number[][] {
  const lines: number[][] = [];
  let inStroke = false;
  for (const c of calls) {
    if (c.name === 'stroke') inStroke = c.args[0] === r && c.args[1] === g && c.args[2] === b;
    else if (c.name === 'line' && inStroke) lines.push(c.args as number[]);
  }
  return lines;
}

/** The ellipse drawn right after each `fill` of this RGB — e.g. one per star. */
function ellipsesAfterFill(calls: RecordedCall[], r: number, g: number, b: number) {
  const found: { alpha: number; args: number[] }[] = [];
  calls.forEach((c, i) => {
    const next = calls[i + 1];
    if (c.name !== 'fill' || c.args[0] !== r || c.args[1] !== g || c.args[2] !== b) return;
    if (next?.name === 'ellipse') {
      found.push({ alpha: (c.args[3] as number) ?? 255, args: next.args as number[] });
    }
  });
  return found;
}

function noteOn(note: number, velocity: number) {
  return { note, name: '', velocity, raw: Math.round(velocity * 127), channel: 1 };
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
      // Castle and owls (with the envelopes they carry) off so the only rects
      // are candle bodies, keeping the candle-ordering assertion unambiguous.
      params: { candleCount: 2, cloudCount: 1, owlCount: 0, castle: false },
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

  it('keeps the castle on the right half of the visualization area, above the chroma key band', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 0, cloudCount: 0, owlCount: 0, lightning: false },
    });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;

    scene.draw(ctx);

    // With no candles, clouds, or owls, every rect and triangle is the castle.
    const rects = p.calls.filter((c) => c.name === 'rect');
    const triangles = p.calls.filter((c) => c.name === 'triangle');
    expect(rects.length).toBeGreaterThan(0);
    expect(triangles.length).toBeGreaterThan(0);
    for (const rect of rects) {
      const [x, y, w, h] = rect.args as number[];
      expect(x).toBeGreaterThanOrEqual(ctx.width * 0.5);
      expect(x + w).toBeLessThanOrEqual(ctx.width);
      expect(y + h).toBeLessThanOrEqual(visHeight);
    }
    for (const triangle of triangles) {
      const [x1, y1, x2, y2, x3, y3] = triangle.args as number[];
      for (const x of [x1, x2, x3]) expect(x).toBeGreaterThanOrEqual(ctx.width * 0.5);
      for (const y of [y1, y2, y3]) expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it('builds the castle as one block, with no sky showing between its buildings', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 0, cloudCount: 0, owlCount: 0, lightning: false },
    });
    scene.setup(ctx);
    const visHeight = ctx.height - ctx.chromaKeyHeight;

    scene.draw(ctx);

    // Hall and tower bodies are the rects standing on the bottom edge.
    const bodies = p.calls
      .filter((c) => c.name === 'rect' && c.args.length === 4)
      .map((c) => c.args as number[])
      .filter(([, y, , h]) => Math.abs(y + h - visHeight) < 1e-6)
      .sort((a, b) => a[0] - b[0]);
    expect(bodies.length).toBeGreaterThan(1);
    let reach = bodies[0][0] + bodies[0][2];
    for (const [x, , w] of bodies.slice(1)) {
      expect(x).toBeLessThanOrEqual(reach + 1e-6); // starts before the last one ends
      reach = Math.max(reach, x + w);
    }
    expect(reach).toBeCloseTo(ctx.width); // flush to the right edge
  });

  it('never draws one castle window crowding into another', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 0, cloudCount: 0, owlCount: 0, lightning: false },
    });
    scene.setup(ctx);

    scene.draw(ctx);

    // Windows are the only rects drawn with corner radii (their arched tops).
    const windows = p.calls
      .filter((c) => c.name === 'rect' && c.args.length === 8)
      .map((c) => c.args as number[]);
    expect(windows.length).toBeGreaterThan(0);
    const minGap = 4;
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const [ax, ay, aw, ah] = windows[i];
        const [bx, by, bw, bh] = windows[j];
        const xGap = Math.max(ax, bx) - Math.min(ax + aw, bx + bw);
        const yGap = Math.max(ay, by) - Math.min(ay + ah, by + bh);
        expect(xGap >= minGap || yGap >= minGap).toBe(true);
      }
    }
  });

  it('brightens the castle windows on a note, then lets them settle', () => {
    const scene = new GreatHallScene();
    const ctx = makeCtx({
      params: { candleCount: 0, cloudCount: 0, owlCount: 0, lightning: false },
    });
    scene.setup(ctx);
    // Window lights are the only warm (r = 255) fills left in this setup.
    const windowLight = () => {
      const p = new RecordingP5();
      scene.draw({ ...ctx, p: p as unknown as P5Like });
      return p.calls
        .filter((c) => c.name === 'fill' && c.args[0] === 255)
        .reduce((sum, c) => sum + (c.args[3] as number), 0);
    };

    const resting = windowLight();
    scene.onNoteOn({ note: 60, name: 'C4', velocity: 1, raw: 127, channel: 1 }, ctx);
    const lit = windowLight();
    for (let i = 0; i < 300; i++) scene.update(ctx);
    const settled = windowLight();

    expect(lit).toBeGreaterThan(resting);
    expect(settled).toBeCloseTo(resting, 0);
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
    // The owl is the first ellipse after its own soft grey-white fill (the
    // stars and moon are ellipses too, drawn before the castle).
    const owlFillAt = fillAt(p.calls, 214, 216, 226);
    const firstOwlEllipseAt = p.calls.findIndex((c, i) => i > owlFillAt && c.name === 'ellipse');
    const crystalsAt = p.calls.findIndex((c) => c.name === 'crystals');
    expect(owlFillAt).toBeGreaterThan(-1);
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

  it('waits out a full interval when the lightning toggle comes back on, rather than flashing at once', () => {
    const scene = new GreatHallScene();
    const p = new RecordingP5();
    const off = makeCtx({
      p: p as unknown as P5Like,
      params: { candleCount: 4, cloudCount: 2, lightning: false },
    });
    const on = { ...off, params: { ...off.params, lightning: true } };
    const fullScreenRects = () =>
      p.calls.filter((c) => c.name === 'rect' && c.args[2] === off.width);
    scene.setup(off);

    // Well past the 14 000 ms the first flash was scheduled for (Math.random is pinned to 0.5).
    scene.update({ ...off, elapsed: 100_000 });
    scene.update({ ...on, elapsed: 100_016 });
    scene.draw({ ...on, elapsed: 100_016 });
    expect(fullScreenRects()).toHaveLength(0);

    scene.update({ ...on, elapsed: 108_001 });
    scene.draw({ ...on, elapsed: 108_001 });
    expect(fullScreenRects()).toHaveLength(1);
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

  describe('storm sky', () => {
    const QUIET = { candleCount: 0, cloudCount: 0, owlCount: 0, castle: false, lightning: false };

    function drawAt(params: SceneContext['params'], elapsed: number, flashAt?: number) {
      const scene = new GreatHallScene();
      const p = new RecordingP5();
      const ctx = makeCtx({ p: p as unknown as P5Like, params });
      scene.setup(ctx);
      if (flashAt !== undefined) scene.update({ ...ctx, elapsed: flashAt });
      p.calls = [];
      scene.draw({ ...ctx, elapsed });
      return { p, ctx, visHeight: ctx.height - ctx.chromaKeyHeight };
    }

    it('scatters the stars across the top half of the sky only', () => {
      const { p, ctx, visHeight } = drawAt(QUIET, 0);

      const stars = ellipsesAfterFill(p.calls, 250, 246, 230);
      expect(stars.length).toBeGreaterThan(0);
      for (const { args } of stars) {
        const [x, y] = args;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(ctx.width);
        expect(y).toBeLessThanOrEqual(visHeight * 0.5);
      }
    });

    it('twinkles the stars over time', () => {
      const brightness = (elapsed: number) =>
        ellipsesAfterFill(drawAt(QUIET, elapsed).p.calls, 250, 246, 230).map((s) => s.alpha);

      expect(brightness(1_000)).not.toEqual(brightness(0));
    });

    it('hangs the moon high on the left, behind the castle', () => {
      const { p, ctx, visHeight } = drawAt({ ...QUIET, castle: true }, 0);

      const moonAt = fillAt(p.calls, 240, 236, 220);
      expect(moonAt).toBeGreaterThan(-1);
      const [x, y] = p.calls[moonAt + 1].args as number[];
      expect(x).toBeLessThan(ctx.width * 0.5);
      expect(y).toBeLessThan(visHeight * 0.5);
      const firstCastleRectAt = p.calls.findIndex((c) => c.name === 'rect');
      expect(moonAt).toBeLessThan(firstCastleRectAt);
    });

    it('strikes a forked bolt with the flash, inside the sky and behind the castle', () => {
      // Math.random is pinned to 0.5, so the first flash lands at 14 000 ms.
      const { p, ctx, visHeight } = drawAt(
        { ...QUIET, castle: true, lightning: true },
        14_001,
        14_001,
      );

      const core = linesInStroke(p.calls, 246, 248, 255);
      // A 12-segment main channel plus two 5-segment branches.
      expect(core).toHaveLength(22);
      for (const [x1, y1, x2, y2] of core) {
        for (const x of [x1, x2]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(ctx.width);
        }
        for (const y of [y1, y2]) {
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThan(visHeight);
        }
      }
      const firstBoltLineAt = p.calls.findIndex((c) => c.name === 'stroke' && c.args[0] === 190);
      const firstCastleRectAt = p.calls.findIndex((c) => c.name === 'rect');
      expect(firstBoltLineAt).toBeLessThan(firstCastleRectAt);
    });

    it('draws no bolt once the flash has faded', () => {
      const { p } = drawAt({ ...QUIET, lightning: true }, 15_000, 14_001);

      expect(linesInStroke(p.calls, 246, 248, 255)).toHaveLength(0);
    });

    it('lights the clouds up with the flash', () => {
      const cloudy = { ...QUIET, cloudCount: 2 };
      const cloudLight = (calls: RecordedCall[]) =>
        calls
          .filter((c, i) => c.name === 'fill' && calls[i + 1]?.name === 'ellipse')
          .reduce((sum, c) => sum + (c.args[0] as number), 0);

      const calm = cloudLight(drawAt(cloudy, 14_001, 14_001).p.calls);
      const lit = cloudLight(drawAt({ ...cloudy, lightning: true }, 14_001, 14_001).p.calls);

      expect(lit).toBeGreaterThan(calm);
    });

    it('forgets the bolt on teardown', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx();
      scene.setup(ctx);
      scene.update({ ...ctx, elapsed: 14_001 });

      scene.teardown();

      expect((scene as unknown as { bolt: unknown[] }).bolt).toHaveLength(0);
    });
  });

  describe('candle magic', () => {
    const CALM = { candleCount: 4, cloudCount: 0, owlCount: 0, lightning: false };

    it('releases golden dust above the flames that drifts upward', () => {
      const scene = new GreatHallScene();
      // A frame as long as the dust interval guarantees every candle releases a mote.
      const ctx = makeCtx({ params: CALM, deltaTime: 700 });
      scene.setup(ctx);

      scene.update(ctx);
      const dust = motesOf(scene, 'dust');
      expect(dust).toHaveLength(4);
      const lowestFlameTop = Math.max(...candlesOf(scene).map((c) => c.baseY + c.bobAmplitude));
      for (const mote of dust) expect(mote.y).toBeLessThan(lowestFlameTop);

      const first = dust[0];
      const startY = first.y;
      scene.update({ ...ctx, deltaTime: 16 });
      expect(first.y).toBeLessThan(startY);
    });

    it('lets dust fade out and disappear at the end of its life', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: CALM, deltaTime: 700 });
      scene.setup(ctx);
      scene.update(ctx);

      // Then a long pause in releases: frames short enough that none spawn.
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      for (let i = 0; i < 300; i++) scene.update({ ...ctx, deltaTime: 16 });

      expect(motesOf(scene, 'dust')).toHaveLength(0);
    });

    it('never keeps more than 70 motes of dust in the air', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // every candle releases every frame
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: { ...CALM, candleCount: 16 } });
      scene.setup(ctx);

      for (let i = 0; i < 200; i++) {
        scene.update(ctx);
        expect(motesOf(scene, 'dust').length).toBeLessThanOrEqual(70);
      }
      expect(motesOf(scene, 'dust').length).toBeGreaterThan(60);
    });

    it('bursts sparks from the candle under a hard note, and none for a soft one', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ width: 900, params: { ...CALM, candleCount: 2 } });
      scene.setup(ctx);
      const [left, right] = candlesOf(scene);
      left.x = 0;
      right.x = 890;

      scene.onNoteOn(noteOn(36, 0.5), ctx);
      expect(motesOf(scene, 'sparks')).toHaveLength(0);

      scene.onNoteOn(noteOn(36, 0.9), ctx);
      const sparks = motesOf(scene, 'sparks');
      expect(sparks).toHaveLength(12);
      for (const spark of sparks) expect(spark.x).toBe(left.x);
    });

    it('arcs sparks over and back down under gravity', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: CALM });
      scene.setup(ctx);
      scene.onNoteOn(noteOn(60, 1), ctx);
      const spark = motesOf(scene, 'sparks')[0];
      expect(spark.vy).toBeLessThan(0); // launched upward

      for (let i = 0; i < 50; i++) scene.update(ctx); // 800ms, inside its ~875ms life

      expect(spark.vy).toBeGreaterThan(0); // now falling back
    });

    it('never keeps more than 90 sparks in the air', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: CALM });
      scene.setup(ctx);

      for (let i = 0; i < 20; i++) scene.onNoteOn(noteOn(60, 1), ctx);

      expect(motesOf(scene, 'sparks')).toHaveLength(90);
    });

    it('brightens the halo rings around a flaring flame', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: { ...CALM, candleCount: 1, castle: false } });
      scene.setup(ctx);
      const outerRing = () => {
        const p = new RecordingP5();
        scene.draw({ ...ctx, p: p as unknown as P5Like });
        return p.calls[fillAt(p.calls, 255, 190, 110)].args[3] as number;
      };

      const resting = outerRing();
      candlesOf(scene)[0].flare = 1;

      expect(outerRing()).toBeGreaterThan(resting);
    });

    it('clears dust and sparks on teardown', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: CALM, deltaTime: 700 });
      scene.setup(ctx);
      scene.update(ctx);
      scene.onNoteOn(noteOn(60, 1), ctx);

      scene.teardown();

      expect(motesOf(scene, 'dust')).toHaveLength(0);
      expect(motesOf(scene, 'sparks')).toHaveLength(0);
    });
  });

  describe('owl post', () => {
    function twoOwls(): { scene: GreatHallScene; ctx: SceneContext } {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: { candleCount: 0, cloudCount: 0, owlCount: 2 } });
      scene.setup(ctx);
      const [left, right] = owlsOf(scene);
      left.x = 100;
      right.x = 800;
      return { scene, ctx };
    }

    it('starts every owl carrying a letter', () => {
      const { scene } = twoOwls();

      expect(owlsOf(scene).every((owl) => owl.hasLetter)).toBe(true);
    });

    it('a hard note makes the carrying owl nearest the key drop its letter', () => {
      const { scene, ctx } = twoOwls();
      const [left, right] = owlsOf(scene);

      scene.onNoteOn(noteOn(96, 0.9), ctx); // the top C, far right of the keyboard

      expect(right.hasLetter).toBe(false);
      expect(left.hasLetter).toBe(true);
      expect(fallingLettersOf(scene)).toHaveLength(1);
      expect(fallingLettersOf(scene)[0].y).toBeGreaterThan(right.y); // below the talons
    });

    it('a soft note leaves the letters where they are', () => {
      const { scene, ctx } = twoOwls();

      scene.onNoteOn(noteOn(96, 0.5), ctx);

      expect(owlsOf(scene).every((owl) => owl.hasLetter)).toBe(true);
      expect(fallingLettersOf(scene)).toHaveLength(0);
    });

    it('passes over an empty-handed owl to the nearest one still carrying', () => {
      const { scene, ctx } = twoOwls();
      const [left, right] = owlsOf(scene);

      scene.onNoteOn(noteOn(96, 0.9), ctx);
      scene.onNoteOn(noteOn(96, 0.9), ctx);

      expect(right.hasLetter).toBe(false);
      expect(left.hasLetter).toBe(false);
      expect(fallingLettersOf(scene)).toHaveLength(2);
    });

    it('gives an owl a new letter only after the reload time', () => {
      const { scene, ctx } = twoOwls();
      const right = owlsOf(scene)[1];
      scene.onNoteOn(noteOn(96, 0.9), ctx);

      scene.update({ ...ctx, elapsed: 5_900 });
      expect(right.hasLetter).toBe(false);

      scene.update({ ...ctx, elapsed: 6_000 });
      expect(right.hasLetter).toBe(true);
    });

    it('lets a letter fall and removes it once it passes the bottom of the scene', () => {
      const { scene, ctx } = twoOwls();
      scene.onNoteOn(noteOn(96, 0.9), ctx);
      const letter = fallingLettersOf(scene)[0];
      const startY = letter.y;

      scene.update(ctx);
      expect(letter.y).toBeGreaterThan(startY);

      const visHeight = ctx.height - ctx.chromaKeyHeight;
      letter.y = visHeight + letter.size + 1;
      scene.update(ctx);
      expect(fallingLettersOf(scene)).toHaveLength(0);
    });

    it('caps how many letters can fall at once', () => {
      const scene = new GreatHallScene();
      const ctx = makeCtx({ params: { candleCount: 0, cloudCount: 0, owlCount: 3 } });
      scene.setup(ctx);

      // Keep handing the owls fresh letters so only the cap can stop a drop.
      for (let i = 0; i < 20; i++) {
        for (const owl of owlsOf(scene)) owl.hasLetter = true;
        scene.onNoteOn(noteOn(60, 1), ctx);
      }

      expect(fallingLettersOf(scene)).toHaveLength(6);
    });

    it('clears falling letters on teardown', () => {
      const { scene, ctx } = twoOwls();
      scene.onNoteOn(noteOn(96, 0.9), ctx);

      scene.teardown();

      expect(fallingLettersOf(scene)).toHaveLength(0);
    });
  });
});
