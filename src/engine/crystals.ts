import type { P5Like } from './types';
import { DustField } from './crystalDust';
import { keyColumnX, whiteKeyWidth } from './keyboardGeometry';

export type RgbColor = readonly [number, number, number];

/** A note-reactive Overlay shaft: spawns at a key column, grows while held, then falls
 * until the visualization floor clips it away — where Dust will take over (see
 * `CONTEXT.md`, which defines a Crystal by the finished model, Dust included). */
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

// A shaft is drawn as a luminous glass tube: the glow layers below, then the
// body, with a hot rim stroked on the body. Spreads are multiples of the shaft
// width, so the whole tube scales with the resolution exactly as the shaft does.
/**
 * The fills drawn outside the body, outermost first: a wide, very faint halo of
 * the crystal's colour bleeding into the Scene, then a tighter, brighter glow
 * that makes the tube read as lit from within.
 */
const GLOW_LAYERS: readonly { spread: number; alpha: number }[] = [
  { spread: 0.8, alpha: 16 },
  { spread: 0.28, alpha: 42 },
];
/** The body, dimmed well below the old flat 150 so the Scene shows through a shaft. */
const BODY_ALPHA = 90;
/** The rim: a near-white edge on the body, the brightest thing a Crystal draws. */
const RIM_ALPHA = 215;
const RIM_WEIGHT_RATIO = 0.12;
/** Floor on the rim's stroke weight, so the edge still reads at small canvas sizes. */
const RIM_MIN_WEIGHT = 1.5;
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
  /** Corner radii in p5's order: top-left, top-right, bottom-right, bottom-left. */
  radii: [number, number, number, number];
}

/**
 * The body rect grown by `spread` on every side and clipped at `floor` — the one
 * place the visualization-floor rule lives, so no layer can spill into the Chroma
 * Key band. Returns null when the clip leaves nothing to draw.
 *
 * The radius is taken from the shaft's own length rather than the clipped height,
 * so a falling shaft's free end keeps its shape while the floor eats the other;
 * and the clipped end is squared off, because the floor is a cut, not an end.
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
  const bottom = crystal.y + bodyHeight + spread;
  const h = Math.min(bottom, floor) - y;
  if (w <= 0 || h <= 0) return null;
  const radius = Math.min(
    w * CORNER_WIDTH_RATIO,
    (crystal.length + spread * 2) * CORNER_LENGTH_RATIO,
  );
  const endRadius = bottom > floor ? 0 : radius;
  return { x, y, w, h, radii: [radius, radius, endRadius, endRadius] };
}

/** How much of a shaft still shows above the floor — the figure every drawn layer is clipped to. */
function visibleHeight(crystal: Crystal, floor: number): number {
  return Math.max(Math.min(crystal.length, floor - crystal.y), 0);
}

/** …and how much the floor has eaten: the rest of it. One clip, read from the other side. */
function consumedHeight(crystal: Crystal, floor: number): number {
  return crystal.length - visibleHeight(crystal, floor);
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
  /** The Dust these shafts shed at the floor — private, and drawn in this same layer (ADR-0008). */
  private readonly dust = new DustField();
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

  /**
   * Advances every active crystal one frame within a `visHeight`-tall
   * visualization area, and with it the Dust the floor shakes loose.
   *
   * `visible` is the Crystals Overlay's own visibility. Shafts keep falling
   * either way, but Dust neither flies nor piles up unseen: hiding the Overlay
   * clears what was airborne, so it can never reappear mid-flight later.
   */
  update(visHeight: number, visible = true): void {
    if (visible) this.dust.update();
    else this.dust.clear();

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
      const consumedBefore = consumedHeight(crystal, visHeight);
      crystal.y += TRAVEL_RATE;
      // Deactivate the moment the shaft's top reaches the band edge, so it is
      // gone before any part could render inside the Chroma Key band.
      if (crystal.y >= visHeight) crystal.active = false;
      if (!visible) continue;
      // Whatever the floor ate this frame turns into Dust — so a long-held
      // shaft streams for longer and a staccato tap gives a small puff, with no
      // second notion of note length to keep in step.
      this.dust.emit(consumedHeight(crystal, visHeight) - consumedBefore, {
        x: crystal.x,
        width: crystal.width,
        floor: visHeight,
        rim: rimColor(crystal.color),
        crystalColor: crystal.color,
      });
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
   * Draws every active crystal as a luminous glass tube, plus the Dust they have
   * shed, clipping everything so none of it spills into the Chroma Key band.
   * `opacity` (0-1) scales every layer's alpha — the sidebar's global Crystals
   * opacity control.
   */
  draw(p: P5Like, visHeight: number, opacity = 1): void {
    let drewAny = false;
    for (const crystal of this.crystals) {
      if (!crystal.active) continue;
      const height = visibleHeight(crystal, visHeight);
      if (height <= 0) continue;
      this.drawShaft(p, crystal, height, visHeight, opacity);
      drewAny = true;
    }
    // With nothing drawn, no p5 state is touched at all — a hidden Overlay is truly silent.
    if (drewAny) p.noStroke(); // don't leave the rim's stroke behind for the next Overlay
    // Dust last, so flecks drift in front of the shafts they broke off — still
    // inside this one call, wherever the Scene chose to place it.
    this.dust.draw(p, visHeight, opacity);
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
    for (const { spread, alpha } of GLOW_LAYERS) {
      const layer = shaftLayer(crystal, height, crystal.width * spread, visHeight);
      if (!layer) continue;
      p.fill(r, g, b, alpha * opacity);
      p.rect(layer.x, layer.y, layer.w, layer.h, ...layer.radii);
    }

    // The rim is stroked on the body, so it traces exactly the body's rounded
    // edge. p5 centres a stroke on the path, hence the half-weight the body's
    // floor is pulled up by — the rim must not bleed past visHeight either.
    const weight = Math.max(RIM_MIN_WEIGHT, crystal.width * RIM_WEIGHT_RATIO);
    const body = shaftLayer(crystal, height, 0, visHeight - weight / 2);
    if (!body) return;
    const [rimR, rimG, rimB] = rimColor(crystal.color);
    p.stroke(rimR, rimG, rimB, RIM_ALPHA * opacity);
    p.strokeWeight(weight);
    p.fill(r, g, b, BODY_ALPHA * opacity);
    p.rect(body.x, body.y, body.w, body.h, ...body.radii);
  }

  /** Deactivates every crystal and forgets all held notes (e.g. on resolution change). */
  reset(): void {
    for (const crystal of this.crystals) {
      crystal.active = false;
      crystal.held = false;
    }
    this.noteCrystals.clear();
    this.dust.clear();
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
