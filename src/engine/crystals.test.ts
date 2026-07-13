import { describe, expect, it } from 'vitest';
import { CRYSTAL_COLORS, CrystalField } from '@/engine/crystals';
import { keyColumnX } from '@/engine/keyboardGeometry';
import type { P5Like } from '@/engine/types';

const WIDTH = 900;
const VIS_HEIGHT = 600;

interface RecordedCall {
  name: string;
  args: number[];
}

class RecordingP5 implements Partial<P5Like> {
  calls: RecordedCall[] = [];
  noStroke = () => this.calls.push({ name: 'noStroke', args: [] });
  fill = (...args: number[]) => this.calls.push({ name: 'fill', args });
  rect = (...args: number[]) => this.calls.push({ name: 'rect', args });
}

function activeCrystals(field: CrystalField) {
  return field.all.filter((c) => c.active);
}

describe('CrystalField', () => {
  it('spawns a growing crystal at the pressed key column on note-on', () => {
    const field = new CrystalField();

    field.noteOn(36, WIDTH); // C2 -> column 0

    const crystals = activeCrystals(field);
    expect(crystals).toHaveLength(1);
    expect(crystals[0].x).toBeCloseTo(keyColumnX(36, WIDTH));
    expect(crystals[0].growing).toBe(true);
    expect(crystals[0].y).toBe(0);
  });

  it('colours crystals purple on the left half and orange-red on the right half', () => {
    const field = new CrystalField();

    field.noteOn(36, WIDTH); // far left
    field.noteOn(95, WIDTH); // far right

    const [left, right] = activeCrystals(field);
    expect(left.color).toEqual(CRYSTAL_COLORS.left);
    expect(right.color).toEqual(CRYSTAL_COLORS.right);
  });

  it('grows a held crystal each update until it reaches full length, then stops growing', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];
    const startLength = crystal.length;

    field.update(VIS_HEIGHT);
    expect(crystal.length).toBeGreaterThan(startLength);

    for (let i = 0; i < 50; i++) field.update(VIS_HEIGHT);
    expect(crystal.growing).toBe(false);
  });

  it('falls a released crystal down the visualization area and deactivates it at the band top edge', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];
    field.noteOff(36);

    field.update(VIS_HEIGHT);
    const yAfterOneFall = crystal.y;
    expect(yAfterOneFall).toBeGreaterThan(0);

    // Keep falling until it reaches the band's top edge, where it deactivates.
    for (let i = 0; i < 1000 && crystal.active; i++) field.update(VIS_HEIGHT);
    expect(crystal.active).toBe(false);
    expect(crystal.y).toBeGreaterThanOrEqual(VIS_HEIGHT);
  });

  it('note-off ends growth of the held crystal without deactivating it', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);

    field.noteOff(36);

    const crystal = activeCrystals(field)[0];
    expect(crystal).toBeDefined();
    expect(crystal.growing).toBe(false);
    expect(crystal.active).toBe(true);
  });

  it('note-off for an unknown note is a no-op', () => {
    const field = new CrystalField();
    expect(() => field.noteOff(60)).not.toThrow();
  });

  it('never draws a crystal below the visualization area (into the Chroma Key band)', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];
    // Grow to full, then park it straddling the band top edge.
    for (let i = 0; i < 50; i++) field.update(VIS_HEIGHT);
    crystal.y = VIS_HEIGHT - 10; // 10px of a 60px shaft is above the edge

    const p = new RecordingP5();
    field.draw(p as unknown as P5Like, VIS_HEIGHT);

    const rects = p.calls.filter((c) => c.name === 'rect');
    expect(rects.length).toBe(1);
    for (const rect of rects) {
      const [, y, , h] = rect.args;
      expect(y + h).toBeLessThanOrEqual(VIS_HEIGHT + 1e-9);
    }
  });

  it('does not draw an inactive crystal', () => {
    const field = new CrystalField();
    const p = new RecordingP5();

    field.draw(p as unknown as P5Like, VIS_HEIGHT);

    expect(p.calls.some((c) => c.name === 'rect')).toBe(false);
  });

  it('recycles the oldest crystal when the pool is exhausted, dropping its stale note mapping', () => {
    const field = new CrystalField();
    const poolSize = field.all.length;

    field.noteOn(36, WIDTH);
    const firstCrystal = field.all[0];
    // Exhaust the rest of the pool, then one more note-on recycles firstCrystal.
    for (let i = 0; i < poolSize; i++) field.noteOn(37 + i, WIDTH);

    expect(firstCrystal.growing).toBe(true);
    // A stale note-off for the recycled note must not stop the new owner's growth.
    field.noteOff(36);
    expect(firstCrystal.growing).toBe(true);
  });

  it('clears all crystals and held-note tracking on reset', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);

    field.reset();

    expect(activeCrystals(field)).toHaveLength(0);
  });
});
