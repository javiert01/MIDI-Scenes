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
  it('spawns a held crystal at the pressed key column on note-on', () => {
    const field = new CrystalField();

    field.noteOn(36, WIDTH); // C2 -> column 0

    const crystals = activeCrystals(field);
    expect(crystals).toHaveLength(1);
    expect(crystals[0].x).toBeCloseTo(keyColumnX(36, WIDTH));
    expect(crystals[0].held).toBe(true);
    expect(crystals[0].y).toBe(0);
  });

  it('sizes the shaft as a fraction of the key column, so it scales with the canvas width', () => {
    const field = new CrystalField();

    field.noteOn(36, WIDTH);
    field.noteOn(38, WIDTH * 2);

    const [narrow, wide] = activeCrystals(field);
    expect(narrow.width).toBeGreaterThan(6); // wider than the old fixed 6px shaft
    expect(wide.width).toBeCloseTo(narrow.width * 2); // proportional to canvas width
  });

  it('colours crystals purple on the left half and orange-red on the right half', () => {
    const field = new CrystalField();

    field.noteOn(36, WIDTH); // far left
    field.noteOn(95, WIDTH); // far right

    const [left, right] = activeCrystals(field);
    expect(left.color).toEqual(CRYSTAL_COLORS.left);
    expect(right.color).toEqual(CRYSTAL_COLORS.right);
  });

  it('keeps growing a held crystal each update — a longer hold yields a taller shaft', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];

    field.update(VIS_HEIGHT);
    const afterShortHold = crystal.length;
    for (let i = 0; i < 5; i++) field.update(VIS_HEIGHT);
    const afterLongerHold = crystal.length;

    expect(afterShortHold).toBeGreaterThan(0.5);
    expect(afterLongerHold).toBeGreaterThan(afterShortHold);
    // It stays held and in place (does not start falling on its own).
    expect(crystal.held).toBe(true);
    expect(crystal.y).toBe(0);
  });

  it('bounds a held crystal at the visualization height so it never grows past what is drawable', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];

    for (let i = 0; i < 1000; i++) field.update(VIS_HEIGHT);

    expect(crystal.length).toBe(VIS_HEIGHT);
    expect(crystal.held).toBe(true);
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

  it('never lets a held crystal grow into an earlier falling one on the same note — the first stays ahead', () => {
    const field = new CrystalField();
    // First note: a quick tap, released so it starts falling.
    field.noteOn(60, WIDTH);
    field.noteOff(60);
    field.update(VIS_HEIGHT);
    // Same note again, held long this time.
    field.noteOn(60, WIDTH);

    const falling = field.all.find((c) => c.active && !c.held)!;
    const held = field.all.find((c) => c.active && c.held)!;
    expect(falling).toBeDefined();
    expect(held).toBeDefined();

    // Across the whole fall, the held shaft's bottom must stay above the falling one's top.
    for (let i = 0; i < 500 && falling.active; i++) {
      field.update(VIS_HEIGHT);
      if (held.active && falling.active) {
        expect(held.y + held.length).toBeLessThanOrEqual(falling.y);
      }
    }
  });

  it('note-off releases the held crystal without deactivating it', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);

    field.noteOff(36);

    const crystal = activeCrystals(field)[0];
    expect(crystal).toBeDefined();
    expect(crystal.held).toBe(false);
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

  it('scales the fill alpha by the opacity multiplier passed to draw', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);

    const full = new RecordingP5();
    field.draw(full as unknown as P5Like, VIS_HEIGHT, 1);
    const fullAlpha = full.calls.find((c) => c.name === 'fill')!.args[3];

    const half = new RecordingP5();
    field.draw(half as unknown as P5Like, VIS_HEIGHT, 0.5);
    const halfAlpha = half.calls.find((c) => c.name === 'fill')!.args[3];

    expect(halfAlpha).toBeCloseTo(fullAlpha * 0.5);
  });

  it('defaults to full opacity when draw is called without a multiplier', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);

    const withDefault = new RecordingP5();
    field.draw(withDefault as unknown as P5Like, VIS_HEIGHT);
    const withExplicitFull = new RecordingP5();
    field.draw(withExplicitFull as unknown as P5Like, VIS_HEIGHT, 1);

    expect(withDefault.calls.find((c) => c.name === 'fill')!.args[3]).toBe(
      withExplicitFull.calls.find((c) => c.name === 'fill')!.args[3],
    );
  });

  it('does not draw an inactive crystal', () => {
    const field = new CrystalField();
    const p = new RecordingP5();

    field.draw(p as unknown as P5Like, VIS_HEIGHT);

    expect(p.calls.some((c) => c.name === 'rect')).toBe(false);
  });

  it('grows the pool past its initial size instead of stealing a still-active crystal', () => {
    const field = new CrystalField();
    const initialPoolSize = field.all.length;

    field.noteOn(36, WIDTH);
    const firstCrystal = field.all[0];
    // Exhaust the rest of the pool, then one more note-on — the pool should
    // grow rather than recycle firstCrystal out from under its held note.
    for (let i = 0; i < initialPoolSize; i++) field.noteOn(37 + i, WIDTH);

    expect(field.all.length).toBeGreaterThan(initialPoolSize);
    expect(firstCrystal.held).toBe(true);
    // The note-off for 36 still legitimately reaches its own crystal.
    field.noteOff(36);
    expect(firstCrystal.held).toBe(false);
  });

  it('clears all crystals and held-note tracking on reset', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);

    field.reset();

    expect(activeCrystals(field)).toHaveLength(0);
  });
});
