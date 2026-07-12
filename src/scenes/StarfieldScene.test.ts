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
    ...overrides,
  };
}

function noteOn(velocity: number): NoteEvent {
  return { note: 60, name: 'C4', velocity, raw: Math.round(velocity * 127), channel: 1 };
}

function starZ(scene: StarfieldScene): number {
  return (scene as unknown as { stars: { z: number }[] }).stars[0].z;
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

  it('clears its stars on teardown', () => {
    const scene = new StarfieldScene();
    scene.setup(makeCtx());

    scene.teardown();

    expect((scene as unknown as { stars: unknown[] }).stars).toHaveLength(0);
  });
});
