import type { RgbColor } from './crystals';
import type { P5Like } from './types';

/** One airborne fleck of Dust, rising from the floor along a sine path. */
interface Fleck {
  active: boolean;
  /** Emission order, for retiring the longest-airborne first when flecks are otherwise equal. */
  bornAt: number;
  /** The column the fleck broke off at — its drawn x is this plus the sway. */
  birthX: number;
  /** Where it broke off, already clear of the floor; its drawn y is this less `risen`. */
  birthY: number;
  /** Distance risen so far — the sine's input, so the wave is a shape in space, not in time. */
  risen: number;
  speed: number;
  /** Frames flown so far, and the count at which the fleck is retired. */
  life: number;
  lifespan: number;
  phase: number;
  amplitude: number;
  /** Radians of sway per pixel risen — the wavelength, expressed the way the sine wants it. */
  frequency: number;
  size: number;
  /** A fleck's birth colour and the colour it cools to — the Rim, then the Crystal's own. */
  rim: RgbColor;
  crystalColor: RgbColor;
}

/** Where a fleck is breaking off: the consumed shaft's column, floor, and colours. */
export interface DustSource {
  /** Left edge of the shaft's column and its width — flecks are born across it. */
  x: number;
  width: number;
  /** The visualization floor, where the shaft is being consumed. */
  floor: number;
  /** The Rim's white tint, a fleck's birth colour. */
  rim: RgbColor;
  /** The Crystal's own colour, which a fleck cools toward. */
  crystalColor: RgbColor;
}

/** Flecks born per pixel of shaft height consumed. */
const FLECKS_PER_PIXEL = 0.35;
/** The alpha of a fleck's bright inner disc, and of the softer halo around it. */
const FLECK_ALPHA = 200;
const GLOW_ALPHA = 55;
/** The halo's diameter, as a multiple of the inner disc's. */
const GLOW_SCALE = 2.4;

// Every measure below is a fraction of the visualization floor rather than a
// pixel count, so Dust reads the same at any canvas size — as the shafts do,
// whose width is a fraction of a key column.
/** Rise speed per frame. The span is exactly a factor of two, so flecks visibly stagger. */
const RISE_SPEED_RATIO = { min: 0.0025, max: 0.005 };
/** How far a fleck swings either side of its birth column. */
const AMPLITUDE_RATIO = { min: 0.008, max: 0.03 };
/** The vertical distance one full sway takes. */
const WAVELENGTH_RATIO = { min: 0.08, max: 0.2 };
/**
 * Frames a fleck flies before it is retired. With the rise speeds above, reach
 * lands between an eighth and just under half the visualization height, so
 * flecks die at varying heights across its lower-middle.
 */
const LIFESPAN_FRAMES = { min: 50, max: 90 };
/** A fleck's inner-disc diameter at birth, before it shrinks away. */
const SIZE_RATIO = 0.006;
/** The fraction of a fleck's life spent cooling from the Rim to its Crystal's colour. */
const COOLING_FRACTION = 0.3;
/**
 * The hard cap on airborne flecks, allocated once. Unlike the Crystal pool this
 * never grows: it is what puts a ceiling on the Overlay's draw cost however
 * densely the keyboard is played (ADR-0008).
 */
const POOL_SIZE = 300;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** The whole pool, allocated once — `shed` only ever rewrites an entry in place. */
function spawnPool(): Fleck[] {
  return Array.from({ length: POOL_SIZE }, () => ({
    active: false,
    bornAt: 0,
    birthX: 0,
    birthY: 0,
    risen: 0,
    speed: 0,
    life: 0,
    lifespan: 1,
    phase: 0,
    amplitude: 0,
    frequency: 0,
    size: 0,
    rim: [0, 0, 0] as RgbColor,
    crystalColor: [0, 0, 0] as RgbColor,
  }));
}

/** How far through its life a fleck is: 0 newborn, 1 spent — and so how faint it has grown. */
function spent(fleck: Fleck): number {
  return fleck.life / fleck.lifespan;
}

/**
 * The Dust a Crystal sheds as the visualization floor consumes it. Owned
 * privately by `CrystalField` rather than exposed as an Overlay of its own —
 * see ADR-0008.
 */
export class DustField {
  private readonly flecks: Fleck[] = spawnPool();
  private births = 0;
  /**
   * Fractional flecks carried between frames so slow consumption still emits,
   * banked per key column so each column earns its own Dust rather than
   * spending a neighbour's remainder. Bounded by the key count, and the
   * difference against one shared bank is under a fleck either way.
   */
  private readonly pendingByColumn = new Map<number, number>();

  /** Sheds Dust for `consumed` px of shaft height eaten by the floor this frame. */
  emit(consumed: number, source: DustSource): void {
    if (consumed <= 0) return;
    let pending = (this.pendingByColumn.get(source.x) ?? 0) + consumed * FLECKS_PER_PIXEL;
    while (pending >= 1) {
      pending -= 1;
      this.shed(source);
    }
    this.pendingByColumn.set(source.x, pending);
  }

  private shed(source: DustSource): void {
    const { floor } = source;
    const size = floor * SIZE_RATIO;
    const fleck = this.acquire();
    fleck.active = true;
    fleck.bornAt = this.births++;
    fleck.birthX = randomRange(source.x, source.x + source.width);
    // Just clear of the floor, so even the halo of a newborn fleck stays above
    // the line — a fleck only ever rises, so this holds for the rest of its life.
    fleck.birthY = floor - (size * GLOW_SCALE) / 2;
    fleck.risen = 0;
    fleck.phase = Math.random() * Math.PI * 2;
    fleck.amplitude = floor * randomRange(AMPLITUDE_RATIO.min, AMPLITUDE_RATIO.max);
    fleck.frequency =
      (Math.PI * 2) / (floor * randomRange(WAVELENGTH_RATIO.min, WAVELENGTH_RATIO.max));
    fleck.speed = floor * randomRange(RISE_SPEED_RATIO.min, RISE_SPEED_RATIO.max);
    fleck.life = 0;
    fleck.lifespan = randomRange(LIFESPAN_FRAMES.min, LIFESPAN_FRAMES.max);
    fleck.size = size;
    fleck.rim = source.rim;
    fleck.crystalColor = source.crystalColor;
  }

  /**
   * A retired slot, or — with the pool full — the faintest fleck, and among
   * equally faint ones the longest airborne. The faintest is what the eye
   * misses; recycling it costs less than dropping the emission, which would
   * leave the note just played with no Dust at all. The tie-break matters when
   * a burst larger than the pool arrives in one frame, where every fleck is
   * newborn: without it the same slot would be overwritten again and again.
   */
  private acquire(): Fleck {
    let faintest = this.flecks[0];
    for (const fleck of this.flecks) {
      if (!fleck.active) return fleck;
      const gap = spent(fleck) - spent(faintest);
      if (gap > 0 || (gap === 0 && fleck.bornAt < faintest.bornAt)) faintest = fleck;
    }
    return faintest;
  }

  /** Advances every airborne fleck one frame. */
  update(): void {
    for (const fleck of this.flecks) {
      if (!fleck.active) continue;
      fleck.risen += fleck.speed;
      fleck.life += 1;
      if (fleck.life >= fleck.lifespan) fleck.active = false;
    }
  }

  /**
   * Draws every airborne fleck, clipped at `floor` exactly as the shaft layers
   * are. `opacity` (0-1) scales alpha, as it does for the shafts.
   */
  draw(p: P5Like, floor: number, opacity: number): void {
    let drewAny = false;
    for (const fleck of this.flecks) {
      if (!fleck.active) continue;
      // Deferred to the first fleck, so an empty field touches no p5 state at all.
      if (!drewAny) p.noStroke();
      drewAny = true;

      // What is left of the fleck: both its size and its alpha run down to
      // nothing over its lifespan, so it thins out rather than blinking away.
      const remaining = 1 - spent(fleck);
      const size = fleck.size * remaining;
      const glow = size * GLOW_SCALE;
      const x =
        fleck.birthX + fleck.amplitude * Math.sin(fleck.phase + fleck.risen * fleck.frequency);
      // The same visualization-floor rule every shaft layer obeys, so the whole
      // Overlay keeps one clamp. A fleck is born clear of the line and only
      // rises, so this guards the invariant rather than correcting a position.
      const y = Math.min(fleck.birthY - fleck.risen, floor - glow / 2);

      // Born wearing the Rim's white tint, cooling to its Crystal's own colour
      // over the first stretch of life and holding there — so the left/right
      // colour choice still reads in the Dust.
      const cooled = Math.min(spent(fleck) / COOLING_FRACTION, 1);
      const { rim, crystalColor } = fleck;
      const r = rim[0] + (crystalColor[0] - rim[0]) * cooled;
      const g = rim[1] + (crystalColor[1] - rim[1]) * cooled;
      const b = rim[2] + (crystalColor[2] - rim[2]) * cooled;

      p.fill(r, g, b, GLOW_ALPHA * remaining * opacity);
      p.ellipse(x, y, glow, glow);
      p.fill(r, g, b, FLECK_ALPHA * remaining * opacity);
      p.ellipse(x, y, size, size);
    }
  }

  /** Retires every airborne fleck (e.g. the Overlay was hidden, or reset). */
  clear(): void {
    for (const fleck of this.flecks) fleck.active = false;
    this.pendingByColumn.clear();
  }
}
