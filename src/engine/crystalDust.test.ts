import { afterEach, describe, expect, it, vi } from 'vitest';
import { DustField, type DustSource } from '@/engine/crystalDust';
import type { P5Like } from '@/engine/types';

const FLOOR = 600;
// Stand-ins for a Crystal's rim and body colour, picked so every channel differs.
const RIM = [240, 200, 160] as const;
const CORE = [60, 80, 100] as const;

const SOURCE: DustSource = { x: 100, width: 20, floor: FLOOR, rim: RIM, crystalColor: CORE };
/** Where a fleck is born with its column draw pinned to the middle. */
const BIRTH_X = SOURCE.x + SOURCE.width / 2;

interface RecordedCall {
  name: string;
  args: number[];
}

class RecordingP5 implements Partial<P5Like> {
  calls: RecordedCall[] = [];
  noStroke = () => this.calls.push({ name: 'noStroke', args: [] });
  fill = (...args: number[]) => this.calls.push({ name: 'fill', args });
  ellipse = (...args: number[]) => this.calls.push({ name: 'ellipse', args });
}

/**
 * The per-fleck values `emit` draws from `Math.random()`, in the order it draws
 * them. Tests pin the draws they care about and leave the rest mid-range.
 */
const RANDOM_DRAWS = ['birthX', 'phase', 'amplitude', 'wavelength', 'speed', 'lifespan'] as const;
type RandomDraw = (typeof RANDOM_DRAWS)[number];

/** Pins `Math.random()` so every fleck is born with the named values; the rest sit mid-range. */
function pinRandoms(overrides: Partial<Record<RandomDraw, number>> = {}): void {
  const perFleck = RANDOM_DRAWS.map((name) => overrides[name] ?? 0.5);
  let call = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => perFleck[call++ % perFleck.length]);
}

/** One drawn fleck: its core's position and size, plus the alpha and colour of each ring. */
interface Sample {
  x: number;
  y: number;
  size: number;
  alpha: number;
  color: number[];
}

function samplesOf(p: RecordingP5): Sample[] {
  const glows = p.calls.filter((c) => c.name === 'ellipse');
  const fills = p.calls.filter((c) => c.name === 'fill');
  const out: Sample[] = [];
  // Each fleck draws a halo then a core, each preceded by its own fill.
  for (let i = 0; i + 1 < glows.length; i += 2) {
    const [gx, gy] = glows[i].args;
    const [, , size] = glows[i + 1].args;
    out.push({
      x: gx,
      y: gy,
      size,
      alpha: fills[i + 1].args[3],
      color: fills[i + 1].args.slice(0, 3),
    });
  }
  return out;
}

/** Draws the field one frame and returns what each airborne fleck rendered as. */
function frame(field: DustField, opacity = 1): Sample[] {
  const p = new RecordingP5();
  field.draw(p as unknown as P5Like, FLOOR, opacity);
  return samplesOf(p);
}

/** A single fleck's whole flight, one sample per frame until it is retired. */
function flightOf(overrides: Partial<Record<RandomDraw, number>> = {}): Sample[] {
  pinRandoms(overrides);
  const field = new DustField();
  field.emit(3, SOURCE); // enough consumption for exactly one fleck
  const path: Sample[] = [];
  for (let i = 0; i < 500; i++) {
    const [sample] = frame(field);
    if (!sample) break;
    path.push(sample);
    field.update();
  }
  return path;
}

/** A source whose Rim and Crystal colour are the same flat grey, so a cohort stays recognisable for life. */
function cohort(grey: number): DustSource {
  return { ...SOURCE, rim: [grey, grey, grey], crystalColor: [grey, grey, grey] };
}

function countOf(samples: Sample[], { rim }: DustSource): number {
  return samples.filter((s) => s.color[0] === rim[0]).length;
}

function advance(field: DustField, frames: number): void {
  for (let i = 0; i < frames; i++) field.update();
}

describe('DustField', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sways a fleck to both sides of the column it broke off from', () => {
    const path = flightOf();

    const offsets = path.map((s) => s.x - BIRTH_X);
    expect(Math.min(...offsets)).toBeLessThan(0);
    expect(Math.max(...offsets)).toBeGreaterThan(0);
  });

  it('sways against distance risen, not time — a faster fleck traces the same wave sooner', () => {
    // The rise-speed draw spans exactly a factor of two, so the fast fleck
    // reaches in one frame what the slow one reaches in two.
    const slow = flightOf({ speed: 0 });
    const fast = flightOf({ speed: 1 });

    let compared = 0;
    for (let n = 1; n < fast.length && 2 * n < slow.length; n++) {
      expect(fast[n].y).toBeCloseTo(slow[2 * n].y);
      expect(fast[n].x).toBeCloseTo(slow[2 * n].x);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('fades and shrinks a fleck to nothing across its lifespan, then retires it', () => {
    const path = flightOf();

    expect(path.length).toBeGreaterThan(10);
    expect(path.length).toBeLessThan(500); // it was retired, not still flying
    for (let i = 1; i < path.length; i++) {
      expect(path[i].alpha).toBeLessThan(path[i - 1].alpha);
      expect(path[i].size).toBeLessThan(path[i - 1].size);
    }
    const last = path[path.length - 1];
    expect(last.alpha).toBeLessThan(path[0].alpha * 0.05);
    expect(last.size).toBeLessThan(path[0].size * 0.05);
  });

  it("is born at the rim's white tint and cools to its Crystal's own colour early in life", () => {
    const path = flightOf();

    expect(path[0].color).toEqual([...RIM]);
    // Part-way through the cooling: past the rim, not yet the Crystal's colour.
    for (const [i, channel] of path[Math.floor(path.length * 0.15)].color.entries()) {
      expect(channel).toBeLessThan(RIM[i]);
      expect(channel).toBeGreaterThan(CORE[i]);
    }
    // Settled on its Crystal's colour by mid-flight, so the left/right colour
    // choice still reads in the Dust for most of what the eye sees.
    for (const sample of path.slice(Math.floor(path.length * 0.5))) {
      expect(sample.color).toEqual([...CORE]);
    }
  });

  it('recycles its faintest fleck to hold a fixed pool, so the note just played always shows', () => {
    pinRandoms(); // one lifespan for every fleck, so age alone decides which is faintest
    const field = new DustField();
    const oldest = cohort(10);
    const middle = cohort(20);
    const newest = cohort(30);

    field.emit(3000, oldest); // far more consumption than the pool can hold
    const cap = frame(field).length;
    advance(field, 10);
    field.emit(15, middle); // a second cohort, recycled out of the first
    const middleCount = countOf(frame(field), middle);
    advance(field, 10);
    field.emit(3, newest); // one more fleck, with the pool still full

    const samples = frame(field);
    expect(cap).toBeGreaterThan(50); // room enough for a dense chord to read
    expect(samples).toHaveLength(cap); // the pool never grew to fit the newcomers
    expect(countOf(samples, newest)).toBe(1); // the newest emission is never the one dropped
    expect(countOf(samples, middle)).toBe(middleCount); // it took the faintest, not a fresher fleck
  });

  it('retires flecks in order when one burst overruns the pool, rather than churning a slot', () => {
    pinRandoms();
    const field = new DustField();
    const first = cohort(10);
    const second = cohort(20);
    // How many flecks the second burst is worth, measured on an empty field.
    const burst = new DustField();
    burst.emit(300, second);
    const burstSize = frame(burst).length;

    field.emit(3000, first); // fills the pool
    field.emit(300, second); // …and overruns it in the same frame, nothing yet aged

    // Every fleck is newborn, so faintness alone cannot choose: birth order does.
    expect(countOf(frame(field), second)).toBe(burstSize);
  });

  it('banks consumption too small for a whole fleck until it adds up to one', () => {
    pinRandoms();
    const field = new DustField();

    // A single frame of this much consumption is worth well under one fleck.
    expect(frame(field)).toHaveLength(0);
    for (let i = 0; i < 10; i++) field.emit(1, SOURCE);

    expect(countOf(frame(field), SOURCE)).toBeGreaterThan(0);
  });

  it('dies in the lower-middle of the visualization area, at a height that varies per fleck', () => {
    // Reach is rise speed times lifespan, and both are drawn per fleck.
    const nearest = flightOf({ speed: 0, lifespan: 0 });
    const furthest = flightOf({ speed: 1, lifespan: 1 });

    const deaths = [nearest, furthest].map((path) => path[path.length - 1].y);
    expect(deaths[1]).toBeLessThan(deaths[0]);
    for (const y of deaths) {
      expect(y).toBeLessThan(FLOOR * 0.95); // well clear of the floor it rose from
      expect(y).toBeGreaterThan(FLOOR * 0.5); // and never as high as the upper half
    }
  });
});
