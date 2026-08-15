import { describe, expect, it } from 'vitest';
import { CRYSTAL_COLORS, CrystalField, rimColor } from '@/engine/crystals';
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
  stroke = (...args: number[]) => this.calls.push({ name: 'stroke', args });
  strokeWeight = (...args: number[]) => this.calls.push({ name: 'strokeWeight', args });
  fill = (...args: number[]) => this.calls.push({ name: 'fill', args });
  rect = (...args: number[]) => this.calls.push({ name: 'rect', args });
}

function activeCrystals(field: CrystalField) {
  return field.all.filter((c) => c.active);
}

function rects(p: RecordingP5): number[][] {
  return p.calls.filter((c) => c.name === 'rect').map((c) => c.args);
}

/** Every call that sets a colour — the fills of each layer plus the rim's stroke. */
function colorCalls(p: RecordingP5): RecordedCall[] {
  return p.calls.filter((c) => c.name === 'fill' || c.name === 'stroke');
}

/** A grown, held shaft in a canvas `width` wide, drawn once. */
function grownShaft(width = WIDTH, opacity?: number) {
  const field = new CrystalField();
  field.noteOn(36, width); // C2 -> column 0
  for (let i = 0; i < 10; i++) field.update(VIS_HEIGHT);
  const crystal = activeCrystals(field)[0];
  const p = new RecordingP5();
  field.draw(p as unknown as P5Like, VIS_HEIGHT, opacity);
  return { field, crystal, p };
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

  it('renders a shaft as a glass tube: halo, mid glow, and body, outermost first', () => {
    const { crystal, p } = grownShaft();

    const [halo, glow, body] = rects(p);
    expect(rects(p)).toHaveLength(3);
    // Each layer sits outside the next, centred on the same shaft.
    expect(halo[2]).toBeGreaterThan(glow[2]);
    expect(glow[2]).toBeGreaterThan(body[2]);
    expect(body[0]).toBeCloseTo(crystal.x);
    expect(body[2]).toBeCloseTo(crystal.width);
    expect(halo[0] + halo[2] / 2).toBeCloseTo(crystal.x + crystal.width / 2);
    expect(glow[0] + glow[2] / 2).toBeCloseTo(crystal.x + crystal.width / 2);
  });

  it('keeps the crystal colour in every layer, brightening inward rather than washing out to white', () => {
    const { crystal, p } = grownShaft();

    const fills = p.calls.filter((c) => c.name === 'fill');
    expect(fills).toHaveLength(3);
    for (const fill of fills) {
      expect(fill.args.slice(0, 3)).toEqual([...crystal.color]);
    }
    const [haloAlpha, glowAlpha, bodyAlpha] = fills.map((f) => f.args[3]);
    expect(haloAlpha).toBeGreaterThan(0);
    expect(haloAlpha).toBeLessThan(glowAlpha);
    expect(glowAlpha).toBeLessThan(bodyAlpha);
  });

  it('dims the body below its old flat alpha so the Scene shows through a shaft', () => {
    const { p } = grownShaft();

    const bodyAlpha = p.calls.filter((c) => c.name === 'fill')[2].args[3];
    expect(bodyAlpha).toBeGreaterThan(0);
    expect(bodyAlpha).toBeLessThan(150); // the old opaque-ish constant
  });

  it('traces a hot near-white rim on the body, stroked at a weight scaled to the shaft', () => {
    const { crystal, p } = grownShaft();

    const stroke = p.calls.find((c) => c.name === 'stroke')!;
    expect(stroke.args.slice(0, 3)).toEqual([...rimColor(crystal.color)]);
    const bodyAlpha = p.calls.filter((c) => c.name === 'fill')[2].args[3];
    expect(stroke.args[3]).toBeGreaterThan(bodyAlpha); // the rim is the hottest layer
    const weight = p.calls.find((c) => c.name === 'strokeWeight')!.args[0];
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(crystal.width / 2);
    // The rim belongs to the body: the stroke is set before the body rect, after the glow.
    const strokeAt = p.calls.indexOf(stroke);
    const rectAt = p.calls.map((c) => c.name).lastIndexOf('rect');
    expect(strokeAt).toBeLessThan(rectAt);
  });

  it('lerps the rim roughly halfway from the crystal colour toward white', () => {
    const [r, g, b] = CRYSTAL_COLORS.left;
    const rim = rimColor(CRYSTAL_COLORS.left);

    expect(rim[0]).toBeCloseTo(r + (255 - r) * 0.5, 0);
    expect(rim[1]).toBeCloseTo(g + (255 - g) * 0.5, 0);
    expect(rim[2]).toBeCloseTo(b + (255 - b) * 0.5, 0);
    // Bright, but not white — the crystal's hue still reads along the edge.
    expect(Math.min(...rim)).toBeLessThan(255);
    expect(rim[0] + rim[1] + rim[2]).toBeGreaterThan(r + g + b);
    expect(rim[2]).toBeGreaterThan(rim[0]); // purple's channel ordering survives
    expect(rim[0]).toBeGreaterThan(rim[1]);
  });

  it('rounds both ends of every layer, with the radius scaling with shaft width', () => {
    const narrow = grownShaft(WIDTH);
    const wide = grownShaft(WIDTH * 2);

    const narrowBody = rects(narrow.p)[2];
    const wideBody = rects(wide.p)[2];
    expect(narrowBody[4]).toBeGreaterThan(0);
    expect(wideBody[4]).toBeCloseTo(narrowBody[4] * 2);
    for (const rect of [...rects(narrow.p), ...rects(wide.p)]) {
      expect(rect[4]).toBeGreaterThan(0); // every layer, not just the body
    }
  });

  it('clamps the corner radius against shaft length so a short shaft never becomes a circle', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];
    crystal.length = crystal.width * 0.6; // shorter than it is wide

    const p = new RecordingP5();
    field.draw(p as unknown as P5Like, VIS_HEIGHT);

    for (const [, , w, h, radius] of rects(p)) {
      expect(radius * 2).toBeLessThan(h);
      expect(radius * 2).toBeLessThanOrEqual(w + 1e-9);
    }
  });

  it('squares off the end the floor cuts, leaving the free end rounded', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];
    for (let i = 0; i < 20; i++) field.update(VIS_HEIGHT);
    crystal.y = VIS_HEIGHT - 20; // the shaft's lower half is under the floor

    const p = new RecordingP5();
    field.draw(p as unknown as P5Like, VIS_HEIGHT);

    for (const [, , , , topLeft, topRight, bottomRight, bottomLeft] of rects(p)) {
      expect(topLeft).toBeGreaterThan(0);
      expect(topRight).toBe(topLeft);
      expect(bottomRight).toBe(0); // the floor is a cut, not an end
      expect(bottomLeft).toBe(0);
    }
  });

  it('keeps the free end rounded at a steady radius while the floor consumes a falling shaft', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    for (let i = 0; i < 20; i++) field.update(VIS_HEIGHT);
    field.noteOff(36);
    const crystal = activeCrystals(field)[0];
    crystal.y = VIS_HEIGHT - crystal.length; // its tip has just reached the floor

    const radii: number[] = [];
    while (crystal.active) {
      const p = new RecordingP5();
      field.draw(p as unknown as P5Like, VIS_HEIGHT);
      const body = rects(p)[2];
      if (body) radii.push(body[4]);
      field.update(VIS_HEIGHT);
    }

    // The radius follows the shaft's own length, not what survives the clip, so
    // the top corners never un-round as the shaft slides under the floor.
    expect(radii.length).toBeGreaterThan(3);
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0]);
  });

  it('floors the rim stroke weight so the edge still reads on a small canvas', () => {
    const tiny = grownShaft(200); // a shaft only ~2.9px wide

    const weight = tiny.p.calls.find((c) => c.name === 'strokeWeight')!.args[0];
    expect(weight).toBeGreaterThanOrEqual(1.5);
  });

  it('clips every drawn layer at the visualization floor (never into the Chroma Key band)', () => {
    const field = new CrystalField();
    field.noteOn(36, WIDTH);
    const crystal = activeCrystals(field)[0];
    // Grow to full, then park it straddling the band top edge.
    for (let i = 0; i < 50; i++) field.update(VIS_HEIGHT);
    crystal.y = VIS_HEIGHT - 10; // 10px of a 200px shaft is above the edge

    const p = new RecordingP5();
    field.draw(p as unknown as P5Like, VIS_HEIGHT);

    expect(rects(p).length).toBeGreaterThan(0);
    for (const [, y, , h] of rects(p)) {
      expect(y + h).toBeLessThanOrEqual(VIS_HEIGHT + 1e-9);
    }
  });

  it('scales every layer alpha by the opacity multiplier — halo and rim included', () => {
    const full = grownShaft(WIDTH, 1);
    const half = grownShaft(WIDTH, 0.5);

    const fullAlphas = colorCalls(full.p).map((c) => c.args[3]);
    const halfAlphas = colorCalls(half.p).map((c) => c.args[3]);
    expect(fullAlphas).toHaveLength(4); // halo, mid glow, body, rim
    expect(halfAlphas).toHaveLength(fullAlphas.length);
    halfAlphas.forEach((alpha, i) => expect(alpha).toBeCloseTo(fullAlphas[i] * 0.5));
  });

  it('defaults to full opacity when draw is called without a multiplier', () => {
    const withDefault = grownShaft(WIDTH, undefined);
    const withExplicitFull = grownShaft(WIDTH, 1);

    expect(colorCalls(withDefault.p).map((c) => c.args[3])).toEqual(
      colorCalls(withExplicitFull.p).map((c) => c.args[3]),
    );
  });

  it('draws nothing at all when no crystal is active', () => {
    const field = new CrystalField();
    const p = new RecordingP5();

    field.draw(p as unknown as P5Like, VIS_HEIGHT);

    expect(p.calls).toHaveLength(0);
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
