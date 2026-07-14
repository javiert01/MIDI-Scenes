import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';
import { keyPosition } from '@/engine/keyboardGeometry';

type RgbColor = readonly [number, number, number];

/** The visualization area a Scene's elements move and wrap within — never the Chroma Key band. */
interface Bounds {
  width: number;
  visHeight: number;
}

const DEFAULT_RAIN_COUNT = 150;
const DEFAULT_RAIN_SPEED = 1;
const DEFAULT_RAIN_COLOR = '#9fc9e8';
const DEFAULT_RIPPLE_SIZE = 1;

const MAX_DROPS = 20;
const MAX_RIPPLES = 30;

const DROP_GRAVITY = 0.6;
const DROP_BASE_VY = 2;
const DROP_VELOCITY_VY_SCALE = 6;
const DROP_BASE_SIZE = 4;
const DROP_VELOCITY_SIZE_SCALE = 4;

const RIPPLE_GROWTH_SPEED = 2.5;
const RIPPLE_BASE_MAX_RADIUS = 25;
const RIPPLE_VELOCITY_RADIUS_SCALE = 25;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function boundsOf(ctx: SceneContext): Bounds {
  return { width: ctx.width, visHeight: ctx.height - ctx.chromaKeyHeight };
}

/** Parses a `#RRGGBB` hex color; falls back to the default rain color when malformed. */
function hexToRgb(hex: string): RgbColor {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hexToRgb(DEFAULT_RAIN_COLOR);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** Grows or shrinks `items` in place to match `targetLength`, spawning new entries as needed. */
function resizePopulation<T>(items: T[], targetLength: number, spawn: () => T): void {
  while (items.length < targetLength) items.push(spawn());
  if (items.length > targetLength) items.length = targetLength;
}

interface RainStreak {
  x: number;
  y: number;
  length: number;
  speed: number;
}

/**
 * Straight-fall rain, reset-at-bottom — the classic p5.js "rain" particle-system
 * example (falling particles that respawn at the top once off-screen), with
 * per-streak length/speed varied for parallax depth.
 */
function spawnRainStreak({ width, visHeight }: Bounds): RainStreak {
  return {
    x: randomRange(0, width),
    y: randomRange(-visHeight, 0),
    length: randomRange(8, 24),
    speed: randomRange(4, 12),
  };
}

function updateRainStreak(streak: RainStreak, { width, visHeight }: Bounds, speedScale: number): void {
  streak.y += streak.speed * speedScale;
  if (streak.y - streak.length > visHeight) {
    streak.x = randomRange(0, width);
    streak.y = -streak.length;
    streak.length = randomRange(8, 24);
    streak.speed = randomRange(4, 12);
  }
}

function drawRainStreak(p: P5Like, streak: RainStreak, color: RgbColor): void {
  const [r, g, b] = color;
  p.stroke(r, g, b, 160);
  p.strokeWeight(1);
  p.line(streak.x, streak.y, streak.x, streak.y + streak.length);
}

interface Drop {
  x: number;
  y: number;
  vy: number;
  size: number;
}

/**
 * A single accelerating drop per note-on. Modeled on Nature of Code's forces
 * chapter — constant downward acceleration (gravity) accumulated into velocity
 * each frame — rather than a fixed fall speed like the ambient rain streaks.
 */
function spawnDrop(x: number, velocity: number): Drop {
  return {
    x,
    y: 0,
    vy: DROP_BASE_VY + velocity * DROP_VELOCITY_VY_SCALE,
    size: DROP_BASE_SIZE + velocity * DROP_VELOCITY_SIZE_SCALE,
  };
}

function updateDrop(drop: Drop): void {
  drop.vy += DROP_GRAVITY;
  drop.y += drop.vy;
}

function drawDrop(p: P5Like, drop: Drop, color: RgbColor): void {
  const [r, g, b] = color;
  p.stroke(r, g, b, 0);
  p.fill(r, g, b, 220);
  p.ellipse(drop.x, drop.y, drop.size, drop.size * 1.4);
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
}

/**
 * Expanding, fading ring on drop impact — same fade-out-over-lifespan idea as
 * a p5.js particle-system example, applied to radius/alpha instead of position.
 */
function spawnRipple(x: number, y: number, velocity: number, sizeScale: number): Ripple {
  return {
    x,
    y,
    radius: 2,
    maxRadius: (RIPPLE_BASE_MAX_RADIUS + velocity * RIPPLE_VELOCITY_RADIUS_SCALE) * sizeScale,
  };
}

function updateRipple(ripple: Ripple): void {
  ripple.radius += RIPPLE_GROWTH_SPEED;
}

function isRippleDone(ripple: Ripple): boolean {
  return ripple.radius >= ripple.maxRadius;
}

function drawRipple(p: P5Like, ripple: Ripple, color: RgbColor): void {
  const [r, g, b] = color;
  const alpha = 255 * (1 - ripple.radius / ripple.maxRadius);
  p.fill(0, 0, 0, 0);
  p.stroke(r, g, b, alpha);
  p.strokeWeight(2);
  p.ellipse(ripple.x, ripple.y, ripple.radius * 2, ripple.radius * 2);
}

/** Pushes `item`, dropping the oldest entry first if `items` is already at `cap`. */
function pushBounded<T>(items: T[], item: T, cap: number): void {
  if (items.length >= cap) items.shift();
  items.push(item);
}

/** Drops entries matching `shouldRemove` in place — no per-frame array allocation. */
function removeInPlace<T>(items: T[], shouldRemove: (item: T) => boolean): void {
  let write = 0;
  for (let read = 0; read < items.length; read++) {
    if (!shouldRemove(items[read])) items[write++] = items[read];
  }
  items.length = write;
}

/** A simple black background with falling rain and a drop that reacts to each note. */
export class RainScene implements Scene {
  readonly id = 'rain';
  readonly label = 'Rain';
  readonly params: ParamSpec[] = [
    {
      key: 'rainCount',
      label: 'Rain Density',
      type: 'range',
      default: DEFAULT_RAIN_COUNT,
      min: 50,
      max: 300,
      step: 10,
    },
    {
      key: 'rainSpeed',
      label: 'Rain Speed',
      type: 'range',
      default: DEFAULT_RAIN_SPEED,
      min: 0.25,
      max: 3,
      step: 0.25,
    },
    {
      key: 'rainColor',
      label: 'Rain Color',
      type: 'color',
      default: DEFAULT_RAIN_COLOR,
    },
    {
      key: 'rippleSize',
      label: 'Ripple Size',
      type: 'range',
      default: DEFAULT_RIPPLE_SIZE,
      min: 0.5,
      max: 2,
      step: 0.1,
    },
  ];

  private rain: RainStreak[] = [];
  private drops: Drop[] = [];
  private ripples: Ripple[] = [];

  setup(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const rainCount = Number(ctx.params.rainCount ?? DEFAULT_RAIN_COUNT);

    this.rain = Array.from({ length: rainCount }, () => spawnRainStreak(bounds));
    this.drops = [];
    this.ripples = [];
  }

  update(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const speedScale = Number(ctx.params.rainSpeed ?? DEFAULT_RAIN_SPEED);
    const rainCount = Number(ctx.params.rainCount ?? DEFAULT_RAIN_COUNT);

    resizePopulation(this.rain, rainCount, () => spawnRainStreak(bounds));
    for (const streak of this.rain) updateRainStreak(streak, bounds, speedScale);

    const impactY = bounds.visHeight;
    for (const drop of this.drops) updateDrop(drop);
    for (const drop of this.drops) {
      if (drop.y >= impactY) {
        const sizeScale = Number(ctx.params.rippleSize ?? DEFAULT_RIPPLE_SIZE);
        const velocity = (drop.vy - DROP_BASE_VY) / DROP_VELOCITY_VY_SCALE;
        pushBounded(this.ripples, spawnRipple(drop.x, impactY, velocity, sizeScale), MAX_RIPPLES);
      }
    }
    removeInPlace(this.drops, (drop) => drop.y >= impactY);

    for (const ripple of this.ripples) updateRipple(ripple);
    removeInPlace(this.ripples, isRippleDone);
  }

  draw(ctx: SceneContext): void {
    const { p } = ctx;
    const bounds = boundsOf(ctx);
    const rainColor = hexToRgb(String(ctx.params.rainColor ?? DEFAULT_RAIN_COLOR));

    p.push();
    p.stroke(0, 0, 0, 0);
    p.fill(0);
    p.rect(0, 0, bounds.width, bounds.visHeight);

    for (const streak of this.rain) drawRainStreak(p, streak, rainColor);

    // Crystals sit behind the note-reactive drop/ripple, like Underwater's
    // creatures, so the drop's splash reads as the foreground reaction.
    ctx.drawCrystals();

    for (const ripple of this.ripples) drawRipple(p, ripple, rainColor);
    for (const drop of this.drops) drawDrop(p, drop, rainColor);

    p.pop();
  }

  onNoteOn(event: NoteEvent, ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const pos = keyPosition(event.note, bounds.width, bounds.visHeight);
    pushBounded(this.drops, spawnDrop(pos.x, event.velocity), MAX_DROPS);
  }

  onNoteOff(): void {
    // Crystals fall on release inside the engine; the Scene has nothing to do.
  }

  teardown(): void {
    this.rain = [];
    this.drops = [];
    this.ripples = [];
  }
}
