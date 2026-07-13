import type { P5Like } from './types';
import { keyColumnX } from './keyboardGeometry';

export type RgbColor = readonly [number, number, number];

/** A note-reactive Overlay shaft: spawns at a key column, grows while held, then falls and fades. */
export interface Crystal {
  x: number;
  y: number;
  length: number;
  active: boolean;
  growing: boolean;
  color: RgbColor;
}

/** Left-half purple, right-half orange-red — unchanged from the original Underwater crystals. */
export const CRYSTAL_COLORS: { left: RgbColor; right: RgbColor } = {
  left: [138, 43, 226],
  right: [255, 69, 0],
};

const POOL_SIZE = 12;
const GROWTH_RATE = 6;
const MAX_LENGTH = 60;
const FALL_RATE = 4;
const CRYSTAL_WIDTH = 6;
const CRYSTAL_ALPHA = 40;

function spawnPool(): Crystal[] {
  return Array.from({ length: POOL_SIZE }, () => ({
    x: 0,
    y: 0,
    length: 0,
    active: false,
    growing: false,
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
    crystal.length = 0.5;
    crystal.active = true;
    crystal.growing = true;
    crystal.color = x < width / 2 ? CRYSTAL_COLORS.left : CRYSTAL_COLORS.right;
    this.noteCrystals.set(note, crystal);
  }

  /** Ends growth of the crystal held for `note`, letting it fall; unknown notes are ignored. */
  noteOff(note: number): void {
    const crystal = this.noteCrystals.get(note);
    if (!crystal) return;
    crystal.growing = false;
    this.noteCrystals.delete(note);
  }

  /** Advances every active crystal one frame within a `visHeight`-tall visualization area. */
  update(visHeight: number): void {
    for (const crystal of this.crystals) {
      if (!crystal.active) continue;
      if (crystal.growing) {
        crystal.length += GROWTH_RATE;
        if (crystal.length >= MAX_LENGTH) crystal.growing = false;
        continue;
      }
      crystal.y += FALL_RATE;
      // Deactivate the moment the shaft's top reaches the band edge, so it is
      // gone before any part could render inside the Chroma Key band.
      if (crystal.y >= visHeight) crystal.active = false;
    }
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
      p.rect(crystal.x, crystal.y, CRYSTAL_WIDTH, height);
    }
  }

  /** Deactivates every crystal and forgets all held notes (e.g. on resolution change). */
  reset(): void {
    for (const crystal of this.crystals) {
      crystal.active = false;
      crystal.growing = false;
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
