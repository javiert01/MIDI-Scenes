import type { P5Like } from './types';
import { keyColumnX, whiteKeyWidth } from './keyboardGeometry';

export type RgbColor = readonly [number, number, number];

/** A note-reactive Overlay shaft: spawns at a key column, grows while held, then falls and fades. */
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
const CRYSTAL_ALPHA = 150;
/** Clear space a held shaft keeps above an earlier crystal falling below it in the same column. */
const CRYSTAL_MIN_GAP = 6;

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
   * Draws every active crystal, clipping each shaft so it never spills into the
   * Chroma Key band. `opacity` (0-1) scales the fill alpha — the sidebar's global
   * Crystals opacity control.
   */
  draw(p: P5Like, visHeight: number, opacity = 1): void {
    p.noStroke();
    for (const crystal of this.crystals) {
      if (!crystal.active) continue;
      const height = Math.min(crystal.length, visHeight - crystal.y);
      if (height <= 0) continue;
      const [r, g, b] = crystal.color;
      p.fill(r, g, b, CRYSTAL_ALPHA * opacity);
      p.rect(crystal.x, crystal.y, crystal.width, height);
    }
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
