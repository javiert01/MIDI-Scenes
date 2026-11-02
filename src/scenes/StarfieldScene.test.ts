import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StarfieldScene } from '@/scenes/StarfieldScene';
import type { NoteEvent, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';

const NOOP_P5: Partial<P5Like> = {
  stroke: () => {},
  strokeWeight: () => {},
  line: () => {},
};

function makeCtx(overrides: Partial<SceneContext> = {}): SceneContext {
  return {
    p: NOOP_P5 as P5Like,
    width: 1000,
    height: 1000,
    chromaKeyHeight: 0,
    params: { starCount: 1, speed: 8 },
    elapsed: 0,
    deltaTime: 16,
    crystals: [],
    drawCrystals: () => {},
    ...overrides,
  };
}

function noteOn(velocity: number): NoteEvent {
  return { note: 60, name: 'C4', velocity, raw: Math.round(velocity * 127), channel: 1 };
}

function starZ(scene: StarfieldScene): number {
  return (scene as unknown as { stars: { z: number }[] }).stars[0].z;
}

type StarInternal = { x: number; y: number; z: number; pz: number };

function starsOf(scene: StarfieldScene): StarInternal[] {
  return (scene as unknown as { stars: StarInternal[] }).stars;
}

/** Records each line along with the stroke weight it was drawn at. */
class LineP5 {
  lines: { x1: number; y1: number; x2: number; y2: number; weight: number }[] = [];
  private weight = 1;

  stroke = () => {};
  strokeWeight = (weight: number) => {
    this.weight = weight;
  };
  line = (x1: number, y1: number, x2: number, y2: number) => {
    this.lines.push({ x1, y1, x2, y2, weight: this.weight });
  };
}

describe('StarfieldScene', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('advances a star by the base speed with no note activity', () => {
    const scene = new StarfieldScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    const before = starZ(scene);

    scene.update(ctx);

    expect(before - starZ(scene)).toBeCloseTo(8);
  });

  it('scales the note-on speed burst by normalized velocity: full velocity triples speed', () => {
    const scene = new StarfieldScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(1), ctx);
    const before = starZ(scene);

    scene.update(ctx);

    expect(before - starZ(scene)).toBeCloseTo(8 * 3);
  });

  it('scales the note-on speed burst by normalized velocity: half velocity is a smaller burst', () => {
    const scene = new StarfieldScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(0.5), ctx);
    const before = starZ(scene);

    scene.update(ctx);

    expect(before - starZ(scene)).toBeCloseTo(8 * 2);
  });

  it('a note-on with velocity 0 produces no burst above base speed', () => {
    const scene = new StarfieldScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(0), ctx);
    const before = starZ(scene);

    scene.update(ctx);

    expect(before - starZ(scene)).toBeCloseTo(8);
  });

  it('the burst fades once its window has elapsed', () => {
    const scene = new StarfieldScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(1), ctx);

    const laterCtx = makeCtx({ elapsed: 1000 });
    const before = starZ(scene);
    scene.update(laterCtx);

    expect(before - starZ(scene)).toBeCloseTo(8);
  });

  it('never paints a star into the Keyboard band, stroke width included', () => {
    let seed = 7;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    const scene = new StarfieldScene();
    const p = new LineP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      width: 1600,
      height: 800,
      chromaKeyHeight: 800 / 3,
      params: { starCount: 400, speed: 20 },
    });
    const visHeight = ctx.height - ctx.chromaKeyHeight;
    scene.setup(ctx);

    let lowest = 0;
    for (let frame = 0; frame < 1500; frame++) {
      if (frame % 20 === 0) scene.onNoteOn(noteOn(1), ctx);
      scene.update(ctx);
      p.lines = [];
      scene.draw(ctx);
      for (const { y1, y2, weight } of p.lines) {
        lowest = Math.max(lowest, y1 + weight / 2, y2 + weight / 2);
      }
      expect(lowest).toBeLessThanOrEqual(visHeight);
    }

    // The field still fills the area down to its floor, rather than stopping short of it.
    expect(lowest).toBeGreaterThan(visHeight * 0.98);
  });

  it('centres the star field in the visualization area', () => {
    const scene = new StarfieldScene();
    const p = new LineP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      width: 1600,
      height: 900,
      chromaKeyHeight: 300,
    });
    scene.setup(ctx);
    Object.assign(starsOf(scene)[0], { x: 0, y: 0, z: 100, pz: 110 });

    scene.draw(ctx);

    expect(p.lines[0].y2).toBeCloseTo(300);
  });

  it('cuts a streak crossing the floor at the floor, keeping its direction', () => {
    const scene = new StarfieldScene();
    const p = new LineP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      width: 1000,
      height: 900,
      chromaKeyHeight: 300,
    });
    scene.setup(ctx);
    // Projects from (600, 500) toward (700, 700), which is 100px below the 600px floor.
    Object.assign(starsOf(scene)[0], { x: 60, y: 200, z: 150, pz: 300 });

    scene.draw(ctx);

    const { x1, y1, x2, y2, weight } = p.lines[0];
    expect(x1).toBeCloseTo(600);
    expect(y1).toBeCloseTo(500);
    expect(y2 + weight / 2).toBeCloseTo(600);
    expect((x2 - x1) / (y2 - y1)).toBeCloseTo(100 / 200);
  });

  it('draws nothing for a star that has already passed the floor', () => {
    const scene = new StarfieldScene();
    const p = new LineP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      width: 1000,
      height: 900,
      chromaKeyHeight: 300,
    });
    scene.setup(ctx);
    Object.assign(starsOf(scene)[0], { x: 0, y: 400, z: 100, pz: 200 });

    scene.draw(ctx);

    expect(p.lines).toHaveLength(0);
  });

  it('clears its stars on teardown', () => {
    const scene = new StarfieldScene();
    scene.setup(makeCtx());

    scene.teardown();

    expect((scene as unknown as { stars: unknown[] }).stars).toHaveLength(0);
  });
});
