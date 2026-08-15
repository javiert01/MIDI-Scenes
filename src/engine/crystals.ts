import type { P5Like } from './types';
import { keyColumnX, whiteKeyWidth } from './keyboardGeometry';

export type RgbColor = readonly [number, number, number];

/** A note-reactive Overlay shaft: spawns at a key column, grows while held, then falls
 * until the visualization floor clips it away. */
export interface Crystal {
  x: number;
  y: number;
  /** Shaft width in px — a fraction of the key column, so it scales with the resolution. */
  width: number;
  length: number;
  active: boolean;
  /** True while the key is down: the shaft grows in place. On release it falls instead. */
  held: boolean;
  color: RgbColor;
}

/** Left-half purple, right-half orange-red — the hues stay, brightened for visibility as an Overlay. */
export const CRYSTAL_COLORS: { left: RgbColor; right: RgbColor } = {
  left: [170, 85, 255],
  right: [255, 90, 20],
};

/** Parses a `#RRGGBB` hex color; malformed input falls back to `fallback`. */
export function hexToRgb(hex: string, fallback: RgbColor): RgbColor {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return fallback;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** Starting pool size — the pool grows past this on demand, so dense playing never steals a still-visible crystal. */
const INITIAL_POOL_SIZE = 12;
/** Px/frame for both growth (held) and fall (released) — one constant velocity
 * so a crystal's leading edge reaches the floor a fixed time after note-on,
 * no matter how long the note was held. */
const TRAVEL_RATE = 4;
/** Shaft width as a fraction of one white key's width — restores the original's chunky look. */
const CRYSTAL_WIDTH_RATIO = 0.5;
/** Clear space a held shaft keeps above an earlier crystal falling below it in the same column. */
const CRYSTAL_MIN_GAP = 6;

// A shaft is drawn as a luminous glass tube: three stacked fills, outermost
// first, plus a hot rim stroked on the innermost one. Spreads are multiples of
// the shaft width, so the whole tube scales with the resolution like the shaft.
/** Widest, faintest layer — the crystal's colour bleeding out into the Scene. */
const HALO_SPREAD_RATIO = 0.8;
const HALO_ALPHA = 16;
/** Just outside the body: the glow that makes the tube read as lit from within. */
const GLOW_SPREAD_RATIO = 0.28;
const GLOW_ALPHA = 42;
/** The body, dimmed well below the old flat 150 so the Scene shows through a shaft. */
const BODY_ALPHA = 90;
/** The rim: a near-white edge on the body, the brightest thing a Crystal draws. */
const RIM_ALPHA = 215;
const RIM_WEIGHT_RATIO = 0.12;
/** How far the rim colour is lerped from the crystal's own colour toward white. */
const RIM_WHITENESS = 0.5;
/** Corner radius: half the layer's width (a capsule end)… */
const CORNER_WIDTH_RATIO = 0.5;
/** …but never more than this fraction of its length, so a short shaft stays a rod, not a circle. */
const CORNER_LENGTH_RATIO = 0.4;

/**
 * The near-white edge colour of a shaft — its own colour lerped halfway toward
 * white, so the rim reads as hot without losing the hue. Exported because Dust
 * is born from the rim and inherits its colour.
 */
export function rimColor(color: RgbColor): RgbColor {
  return [
    color[0] + (255 - color[0]) * RIM_WHITENESS,
    color[1] + (255 - color[1]) * RIM_WHITENESS,
    color[2] + (255 - color[2]) * RIM_WHITENESS,
  ];
}

/** One drawn ring of the tube: the body rect grown by `spread` on every side, with rounded ends. */
interface ShaftLayer {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

/**
 * The body rect grown by `spread` on every side and clipped at `floor` — the one
 * place the visualization-floor rule lives, so no layer can spill into the Chroma
 * Key band. Returns null when the clip leaves nothing to draw.
 */
function shaftLayer(
  crystal: Crystal,
  bodyHeight: number,
  spread: number,
  floor: number,
): ShaftLayer | null {
  const x = crystal.x - spread;
  const y = crystal.y - spread;
  const w = crystal.width + spread * 2;
  const h = Math.min(crystal.y + bodyHeight + spread, floor) - y;
  if (w <= 0 || h <= 0) return null;
  return {
    x,
    y,
    w,
    h,
    radius: Math.min(w * CORNER_WIDTH_RATIO, h * CORNER_LENGTH_RATIO),
  };
}

function spawnPool(): Crystal[] {
  return Array.from({ length: INITIAL_POOL_SIZE }, () => ({
    x: 0,
    y: 0,
    width: 0,
    length: 0,
    active: false,
    held: false,
    color: CRYSTAL_COLORS.left,
  }));
}

/**
 * The engine-owned pool of Crystals. A note-on spawns one at the pressed key's
 * column; it grows while held, then falls and deactivates at the visualization
 * area's bottom edge — it never enters the Chroma Key band. State lives here so
 * Crystals appear on every Scene and on No Scene; rendering is a separate step a
 * Scene may invoke where it likes, or the engine performs itself.
 */
export class CrystalField {
  private readonly crystals: Crystal[] = spawnPool();
  /** Which pooled crystal is growing for each held note, keyed by MIDI note id. */
  private readonly noteCrystals = new Map<number, Crystal>();
  /** User-customizable left/right colors — new noteOns pick from these; defaults to `CRYSTAL_COLORS`. */
  private leftColor: RgbColor = CRYSTAL_COLORS.left;
  private rightColor: RgbColor = CRYSTAL_COLORS.right;

  /** The current pool, for a Scene that wants to inspect Crystals via `SceneContext`. */
  get all(): readonly Crystal[] {
    return this.crystals;
  }

  /** Sets the colors newly spawned Crystals use; already-active Crystals keep their spawn-time color. */
  setColors(left: RgbColor, right: RgbColor): void {
    this.leftColor = left;
    this.rightColor = right;
  }

  /** Spawns a growing crystal at `note`'s key column within a canvas of `width`. */
  noteOn(note: number, width: number): void {
    const x = keyColumnX(note, width);
    const crystal = this.acquire();
    crystal.x = x;
    crystal.y = 0;
    crystal.width = whiteKeyWidth(width) * CRYSTAL_WIDTH_RATIO;
    crystal.length = 0.5;
    crystal.active = true;
    crystal.held = true;
    crystal.color = x < width / 2 ? this.leftColor : this.rightColor;
    this.noteCrystals.set(note, crystal);
  }

  /** Releases the crystal held for `note`, letting it fall; unknown notes are ignored. */
  noteOff(note: number): void {
    const crystal = this.noteCrystals.get(note);
    if (!crystal) return;
    crystal.held = false;
    this.noteCrystals.delete(note);
  }

  /** Advances every active crystal one frame within a `visHeight`-tall visualization area. */
  update(visHeight: number): void {
    for (const crystal of this.crystals) {
      if (!crystal.active) continue;
      if (crystal.held) {
        // Grow in place while the key is down — the longer the hold, the taller
        // the shaft — but never down into an earlier crystal still falling below
        // it in the same column, so replays of a note never overlap.
        crystal.length = Math.min(
          crystal.length + TRAVEL_RATE,
          this.growthCeiling(crystal, visHeight),
        );
        continue;
      }
      crystal.y += TRAVEL_RATE;
      // Deactivate the moment the shaft's top reaches the band edge, so it is
      // gone before any part could render inside the Chroma Key band.
      if (crystal.y >= visHeight) crystal.active = false;
    }
  }

  /** How far a held shaft may extend below its anchor: to the floor, or just above the crystal below it. */
  private growthCeiling(held: Crystal, visHeight: number): number {
    let ceiling = visHeight - held.y;
    for (const other of this.crystals) {
      if (other === held || !other.active || other.x !== held.x) continue;
      if (other.y <= held.y) continue; // only crystals falling below this one
      const roomAbove = other.y - CRYSTAL_MIN_GAP - held.y;
      if (roomAbove < ceiling) ceiling = roomAbove;
    }
    return Math.max(ceiling, 0);
  }

  /**
   * Draws every active crystal as a luminous glass tube, clipping every layer so
   * none spills into the Chroma Key band. `opacity` (0-1) scales every layer's
   * alpha — the sidebar's global Crystals opacity control.
   */
  draw(p: P5Like, visHeight: number, opacity = 1): void {
    const shafts = this.crystals
      .filter((crystal) => crystal.active)
      .map((crystal) => ({ crystal, height: Math.min(crystal.length, visHeight - crystal.y) }))
      .filter(({ height }) => height > 0);
    // Nothing to draw touches no p5 state at all, so a hidden Overlay is truly silent.
    if (shafts.length === 0) return;

    for (const { crystal, height } of shafts) {
      this.drawShaft(p, crystal, height, visHeight, opacity);
    }
    p.noStroke(); // don't leave the rim's stroke behind for the next Overlay
  }

  /** One shaft: halo, mid glow, then the body wearing the rim as its stroke. */
  private drawShaft(
    p: P5Like,
    crystal: Crystal,
    height: number,
    visHeight: number,
    opacity: number,
  ): void {
    const [r, g, b] = crystal.color;
    p.noStroke();
    for (const [spreadRatio, alpha] of [
      [HALO_SPREAD_RATIO, HALO_ALPHA],
      [GLOW_SPREAD_RATIO, GLOW_ALPHA],
    ]) {
      const layer = shaftLayer(crystal, height, crystal.width * spreadRatio, visHeight);
      if (!layer) continue;
      p.fill(r, g, b, alpha * opacity);
      p.rect(layer.x, layer.y, layer.w, layer.h, layer.radius);
    }

    // The rim is stroked on the body, so it traces exactly the body's rounded
    // edge. p5 centres a stroke on the path, hence the half-weight the body's
    // floor is pulled up by — the rim must not bleed past visHeight either.
    const weight = crystal.width * RIM_WEIGHT_RATIO;
    const body = shaftLayer(crystal, height, 0, visHeight - weight / 2);
    if (!body) return;
    const [rimR, rimG, rimB] = rimColor(crystal.color);
    p.stroke(rimR, rimG, rimB, RIM_ALPHA * opacity);
    p.strokeWeight(weight);
    p.fill(r, g, b, BODY_ALPHA * opacity);
    p.rect(body.x, body.y, body.w, body.h, body.radius);
  }

  /** Deactivates every crystal and forgets all held notes (e.g. on resolution change). */
  reset(): void {
    for (const crystal of this.crystals) {
      crystal.active = false;
      crystal.held = false;
    }
    this.noteCrystals.clear();
  }

  /** Reuses a free pooled crystal, or grows the pool with a new one — never steals a still-active crystal. */
  private acquire(): Crystal {
    const free = this.crystals.find((c) => !c.active);
    if (free) return free;

    const crystal: Crystal = {
      x: 0,
      y: 0,
      width: 0,
      length: 0,
      active: false,
      held: false,
      color: CRYSTAL_COLORS.left,
    };
    this.crystals.push(crystal);
    return crystal;
  }
}
