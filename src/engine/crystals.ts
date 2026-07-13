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

const POOL_SIZE = 12;
const GROWTH_RATE = 6;
const FALL_RATE = 4;
/** Shaft width as a fraction of one white key's width — restores the original's chunky look. */
const CRYSTAL_WIDTH_RATIO = 0.5;
const CRYSTAL_ALPHA = 150;
/** Clear space a held shaft keeps above an earlier crystal falling below it in the same column. */
const CRYSTAL_MIN_GAP = 6;

function spawnPool(): Crystal[] {
  return Array.from({ length: POOL_SIZE }, () => ({
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
  private nextIndex = 0;

  /** The current pool, for a Scene that wants to inspect Crystals via `SceneContext`. */
  get all(): readonly Crystal[] {
    return this.crystals;
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
    crystal.color = x < width / 2 ? CRYSTAL_COLORS.left : CRYSTAL_COLORS.right;
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
          crystal.length + GROWTH_RATE,
          this.growthCeiling(crystal, visHeight),
        );
        continue;
      }
      crystal.y += FALL_RATE;
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

  /** Draws every active crystal, clipping each shaft so it never spills into the Chroma Key band. */
  draw(p: P5Like, visHeight: number): void {
    p.noStroke();
    for (const crystal of this.crystals) {
      if (!crystal.active) continue;
      const height = Math.min(crystal.length, visHeight - crystal.y);
      if (height <= 0) continue;
      const [r, g, b] = crystal.color;
      p.fill(r, g, b, CRYSTAL_ALPHA);
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
    this.nextIndex = 0;
  }

  /** Reuses a free pooled crystal, or recycles the oldest one round-robin when the pool is full. */
  private acquire(): Crystal {
    const free = this.crystals.find((c) => !c.active);
    if (free) return free;

    const crystal = this.crystals[this.nextIndex % this.crystals.length];
    this.nextIndex += 1;
    // The recycled crystal may still be tracked for a held note; drop that stale
    // mapping so a later note-off can't reach into what is now a different note's crystal.
    for (const [note, tracked] of this.noteCrystals) {
      if (tracked === crystal) this.noteCrystals.delete(note);
    }
    return crystal;
  }
}
