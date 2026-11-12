import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GalaxyScene } from '@/scenes/GalaxyScene';
import type { NoteEvent, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';
import { KEYBOARD_BASE_NOTE, KEYBOARD_TOP_NOTE } from '@/engine/keyboardGeometry';

const NOOP_P5: Partial<P5Like> = {
  noStroke: () => {},
  stroke: () => {},
  strokeWeight: () => {},
  strokeCap: () => {},
  line: () => {},
  fill: () => {},
  noFill: () => {},
  rect: () => {},
  ellipse: () => {},
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
    width: 1600,
    height: 800,
    chromaKeyHeight: 800 / 3,
    params: { starCount: 1200 },
    elapsed: 0,
    deltaTime: 16,
    crystals: [],
    drawCrystals: () => {},
    ...overrides,
  };
}

function noteOn(note: number, velocity = 1): NoteEvent {
  return { note, name: 'n', velocity, raw: Math.round(velocity * 127), channel: 1 };
}

function noteOff(note: number): NoteEvent {
  return { note, name: 'n', velocity: 0, raw: 0, channel: 1 };
}

/** A repeatable Math.random, so star layouts vary but tests don't flake. */
function seedRandom(seed = 7): void {
  let state = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  });
}

type DiscStar = { a: number; psi: number; jitter: number; base: number; giant: boolean };
type Birth = { note: number; a: number; psi: number; velocity: number; releasedAt: number };

interface GalaxyInternals {
  disc: DiscStar[];
  bulge: unknown[];
  field: unknown[];
  beacons: unknown[];
  births: Birth[];
  shooting: { bornAt: number } | null;
  nextShootingAt: number;
}

function internals(scene: GalaxyScene): GalaxyInternals {
  return scene as unknown as GalaxyInternals;
}

/**
 * Follows p5's transform stack and reports the lowest canvas y any drawing
 * reaches, counting half a stroke's width and a rotated ellipse's true extent.
 */
class ExtentP5 implements Partial<P5Like> {
  maxY = -Infinity;
  private matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private stack: (typeof this.matrix)[] = [];
  private weight = 1;

  reset(): void {
    this.maxY = -Infinity;
  }

  private reach(x: number, y: number, radius: number): void {
    const m = this.matrix;
    this.maxY = Math.max(this.maxY, m.b * x + m.d * y + m.f + radius);
  }

  noStroke = () => {};
  stroke = () => {};
  noFill = () => {};
  fill = () => {};
  strokeWeight = (weight: number) => {
    this.weight = weight;
  };
  strokeCap = () => {};
  line = (x1: number, y1: number, x2: number, y2: number) => {
    this.reach(x1, y1, this.weight / 2);
    this.reach(x2, y2, this.weight / 2);
  };
  ellipse = (x: number, y: number, w: number, h: number) => {
    // The vertical half-extent of an axis-aligned ellipse under the current matrix.
    const half = Math.hypot((this.matrix.b * w) / 2, (this.matrix.d * h) / 2);
    this.reach(x, y, half);
  };
  rect = (x: number, y: number, w: number, h: number) => this.reach(x + w, y + h, 0);
  beginShape = () => {};
  vertex = (x: number, y: number) => this.reach(x, y, this.weight / 2);
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

/** Records the order of the draw calls that matter for layering. */
class OrderP5 implements Partial<P5Like> {
  events: string[] = [];
  private weight = 1;
  /** Round dots drawn this frame: [x, y, strokeWeight]. */
  dots: [number, number, number][] = [];

  noStroke = () => {};
  stroke = () => {};
  noFill = () => {};
  fill = () => {};
  strokeWeight = (weight: number) => {
    this.weight = weight;
  };
  strokeCap = () => {};
  line = (x1: number, y1: number, x2: number, y2: number) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 0.1) this.dots.push([x1, y1, this.weight]);
  };
  ellipse = () => {};
  rect = () => this.events.push('rect');
  beginShape = () => {
    this.events.push('shape');
  };
  vertex = () => {};
  endShape = () => {};
  push = () => {};
  pop = () => {};
  translate = () => {};
  rotate = () => {};
}

describe('GalaxyScene', () => {
  beforeEach(() => seedRandom());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('splits the star count between the disc and the bulge on setup', () => {
    const scene = new GalaxyScene();
    scene.setup(makeCtx({ params: { starCount: 1000 } }));

    expect(internals(scene).disc).toHaveLength(800);
    expect(internals(scene).bulge).toHaveLength(200);
  });

  it('clamps the star count to its declared range', () => {
    const scene = new GalaxyScene();
    scene.setup(makeCtx({ params: { starCount: 99999 } }));
    const { disc, bulge } = internals(scene);

    expect(disc.length + bulge.length).toBe(2000);
  });

  it('grows or shrinks the galaxy live as the star count changes', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx({ params: { starCount: 1000 } });
    scene.setup(ctx);

    scene.update({ ...ctx, params: { starCount: 500 } });
    expect(internals(scene).disc.length + internals(scene).bulge.length).toBe(500);

    scene.update({ ...ctx, params: { starCount: 2000 } });
    expect(internals(scene).disc.length + internals(scene).bulge.length).toBe(2000);
  });

  it('turns the disc counter-clockwise on screen, inner stars faster than outer ones', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx({ params: { starCount: 400, rotationSpeed: 1 } });
    scene.setup(ctx);
    const [inner, outer] = internals(scene).disc;
    inner.a = 0.15;
    inner.psi = 1;
    outer.a = 0.8;
    outer.psi = 1;

    scene.update({ ...ctx, deltaTime: 40 });

    // The arms wind clockwise going out, so a counter-clockwise turn keeps them trailing.
    expect(inner.psi).toBeLessThan(1);
    expect(outer.psi).toBeLessThan(1);
    expect(1 - inner.psi).toBeGreaterThan(1 - outer.psi);
  });

  it('scales the turn by Rotation Speed, and freezes the galaxy at zero', () => {
    const turnAt = (rotationSpeed: number): number => {
      const scene = new GalaxyScene();
      const ctx = makeCtx({ params: { starCount: 400, rotationSpeed } });
      scene.setup(ctx);
      const star = internals(scene).disc[0];
      star.a = 0.5;
      star.psi = 1;
      scene.update({ ...ctx, deltaTime: 40 });
      return 1 - star.psi;
    };

    expect(turnAt(0)).toBe(0);
    expect(turnAt(2)).toBeCloseTo(turnAt(1) * 2, 10);
  });

  it('does not let one long frame (a backgrounded tab) jump the galaxy', () => {
    const turnAfter = (deltaTime: number): number => {
      const scene = new GalaxyScene();
      const ctx = makeCtx({ params: { starCount: 400 } });
      scene.setup(ctx);
      const star = internals(scene).disc[0];
      star.a = 0.5;
      star.psi = 1;
      scene.update({ ...ctx, deltaTime });
      return 1 - star.psi;
    };

    expect(turnAfter(5000)).toBeCloseTo(turnAfter(50), 10);
  });

  it('never paints into the band, at max stars, every tilt and arm count, with a storm of notes', () => {
    for (const tilt of [0, 60, 75]) {
      for (const armCount of ['2', '4']) {
        const scene = new GalaxyScene();
        const p = new ExtentP5();
        const ctx = makeCtx({
          p: p as unknown as P5Like,
          params: { starCount: 2000, rotationSpeed: 3, tilt, armCount },
        });
        const visHeight = ctx.height - ctx.chromaKeyHeight;
        scene.setup(ctx);

        for (let frame = 0; frame < 900; frame++) {
          const frameCtx = { ...ctx, elapsed: frame * 16 };
          if (frame % 7 === 0) {
            const note =
              KEYBOARD_BASE_NOTE + ((frame * 5) % (KEYBOARD_TOP_NOTE - KEYBOARD_BASE_NOTE + 1));
            scene.onNoteOn(noteOn(note, 1), frameCtx);
            if (frame % 14 === 0) scene.onNoteOff(noteOff(note), frameCtx);
          }
          scene.update(frameCtx);
          p.reset();
          scene.draw(frameCtx);
          expect(p.maxY).toBeLessThanOrEqual(visHeight);
        }
      }
    }
  });

  it('never paints a shooting star into the band', () => {
    const scene = new GalaxyScene();
    const p = new ExtentP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      width: 1600,
      height: 300,
      chromaKeyHeight: 100,
    });
    scene.setup(ctx);
    let seen = 0;

    for (let elapsed = 0; elapsed < 120_000; elapsed += 16) {
      const frameCtx = { ...ctx, elapsed };
      scene.update(frameCtx);
      if (internals(scene).shooting) seen++;
      p.reset();
      scene.draw(frameCtx);
      expect(p.maxY).toBeLessThanOrEqual(200);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('launches a shooting star after its gap, and clears it once its streak has run', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    const due = internals(scene).nextShootingAt;
    expect(due).toBeGreaterThanOrEqual(4000);
    expect(due).toBeLessThanOrEqual(10000);

    scene.update({ ...ctx, elapsed: due - 1 });
    expect(internals(scene).shooting).toBeNull();

    scene.update({ ...ctx, elapsed: due });
    expect(internals(scene).shooting?.bornAt).toBe(due);

    scene.update({ ...ctx, elapsed: due + 900 });
    expect(internals(scene).shooting).toBeNull();
    expect(internals(scene).nextShootingAt).toBeGreaterThan(due + 900);
  });

  it('draws the background and sky first, then the Crystals, then the galaxy', () => {
    const scene = new GalaxyScene();
    const p = new OrderP5();
    const ctx = makeCtx({
      p: p as unknown as P5Like,
      drawCrystals: () => p.events.push('crystals'),
    });
    scene.setup(ctx);
    scene.draw(ctx);

    const crystals = p.events.indexOf('crystals');
    expect(p.events[0]).toBe('rect');
    expect(crystals).toBeGreaterThan(1); // the sky's star shapes come before
    expect(p.events.slice(crystals + 1)).toContain('shape'); // the galaxy's stars come after
    expect(p.events.filter((e) => e === 'crystals')).toHaveLength(1);
  });

  it('confines the space background to the visualization area', () => {
    const scene = new GalaxyScene();
    const p = new ExtentP5();
    const ctx = makeCtx({ p: p as unknown as P5Like });
    scene.setup(ctx);
    scene.draw(ctx);

    expect(p.maxY).toBeLessThanOrEqual(ctx.height - ctx.chromaKeyHeight);
  });

  it('births a star nearer the core for a low key than for a high one', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx();
    scene.setup(ctx);

    scene.onNoteOn(noteOn(KEYBOARD_BASE_NOTE), ctx);
    scene.onNoteOn(noteOn(KEYBOARD_TOP_NOTE), ctx);
    const [low, high] = internals(scene).births;

    expect(low.a).toBeLessThan(0.2);
    expect(high.a).toBeGreaterThan(0.75);
  });

  it('places a born star on the side of the galaxy its key sits on', () => {
    const bornStarX = (note: number): number => {
      const scene = new GalaxyScene();
      const p = new OrderP5();
      const ctx = makeCtx({ p: p as unknown as P5Like });
      scene.setup(ctx);
      scene.onNoteOn(noteOn(note, 1), ctx);
      // Past the attack: a nebula is still dark at the instant of its birth.
      scene.draw({ ...ctx, elapsed: 200 });
      // The born star is the only dot drawn far thicker than any other star.
      const star = p.dots.find(([, , weight]) => weight > 4);
      if (!star) throw new Error('no born star drawn');
      return star[0];
    };

    expect(bornStarX(KEYBOARD_BASE_NOTE + 12)).toBeLessThan(800);
    expect(bornStarX(KEYBOARD_TOP_NOTE - 12)).toBeGreaterThan(800);
  });

  it('draws a louder note as a bigger born star', () => {
    const bornStarWeight = (velocity: number): number => {
      const scene = new GalaxyScene();
      const p = new OrderP5();
      const ctx = makeCtx({ p: p as unknown as P5Like });
      scene.setup(ctx);
      scene.onNoteOn(noteOn(60, velocity), ctx);
      scene.draw({ ...ctx, elapsed: 200 });
      return Math.max(...p.dots.map(([, , weight]) => weight));
    };

    expect(bornStarWeight(1)).toBeGreaterThan(bornStarWeight(0.3));
  });

  it('keeps a held note glowing past the fade time', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);

    scene.update({ ...ctx, elapsed: 20_000 });

    expect(internals(scene).births).toHaveLength(1);
  });

  it('fades a nebula on release, then settles its star into the disc', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx({ params: { starCount: 1000, rotationSpeed: 0 } });
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);
    const birth = internals(scene).births[0];

    scene.onNoteOff(noteOff(60), { ...ctx, elapsed: 500 });
    expect(birth.releasedAt).toBe(500);

    scene.update({ ...ctx, elapsed: 3499 });
    expect(internals(scene).births).toHaveLength(1);

    scene.update({ ...ctx, elapsed: 3500 });
    expect(internals(scene).births).toHaveLength(0);
    expect(internals(scene).disc).toHaveLength(800);
    const settled = internals(scene).disc.find((s) => s.a === birth.a && s.psi === birth.psi);
    expect(settled).toMatchObject({ jitter: 0, giant: true });
  });

  it('releases only the births of the note that was let go', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);
    scene.onNoteOn(noteOn(64), ctx);

    scene.onNoteOff(noteOff(64), { ...ctx, elapsed: 100 });

    const [held, released] = internals(scene).births;
    expect(held.releasedAt).toBe(-1);
    expect(released.releasedAt).toBe(100);
  });

  it('caps live births, retiring the oldest into the disc', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    for (let i = 0; i < 30; i++) scene.onNoteOn(noteOn(40 + i), ctx);

    const births = internals(scene).births;
    expect(births).toHaveLength(24);
    expect(births[0].note).toBe(46);
    expect(births[23].note).toBe(69);
  });

  it('clears all scene-owned state on teardown', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx();
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);
    scene.update({ ...ctx, elapsed: 20_000 });

    scene.teardown();

    const state = internals(scene);
    expect(state.disc).toHaveLength(0);
    expect(state.bulge).toHaveLength(0);
    expect(state.field).toHaveLength(0);
    expect(state.beacons).toHaveLength(0);
    expect(state.births).toHaveLength(0);
    expect(state.shooting).toBeNull();
  });

  it('falls back to the default palette on a malformed color param', () => {
    const scene = new GalaxyScene();
    const ctx = makeCtx({ params: { coreColor: 'oops', armColor: '', nebulaColor: '#12' } });
    scene.setup(ctx);
    scene.onNoteOn(noteOn(60), ctx);

    expect(() => scene.draw(ctx)).not.toThrow();
  });
});
