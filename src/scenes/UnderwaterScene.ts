import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';
import { keyPosition } from '@/engine/keyboardGeometry';

type FishPattern = 'traveling' | 'circling' | 'wandering';
type RgbColor = readonly [number, number, number];

/** The visualization area a Scene's elements move and wrap within — never the Chroma Key band. */
interface Bounds {
  width: number;
  visHeight: number;
}

const DEFAULT_FISH_COUNT = 20;
const DEFAULT_JELLYFISH_COUNT = 10;
const DEFAULT_CREATURE_SPEED = 1;
const DEFAULT_WATER_COLOR = '#145573';

const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const FISH_COLORS: Record<FishPattern, RgbColor> = {
  traveling: [50, 190, 210],
  circling: [50, 120, 220],
  wandering: [60, 200, 150],
};
const FISH_PATTERNS = Object.keys(FISH_COLORS) as FishPattern[];

const JELLYFISH_COLORS: RgbColor[] = [
  [90, 190, 220],
  [210, 110, 220],
  [110, 220, 170],
];

const FISH_BOOST_SPEED_SCALE = 2;
const FISH_BOOST_SIZE_SCALE = 0.5;
const JELLYFISH_BOOST_PULSE_SCALE = 3;
const JELLYFISH_BOOST_SIZE_SCALE = 0.6;
const BOOST_DECAY = 0.95;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function boundsOf(ctx: SceneContext): Bounds {
  return { width: ctx.width, visHeight: ctx.height - ctx.chromaKeyHeight };
}

function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

/** Finds the item nearest (x, y); private to the Scene, the engine never sees creatures. */
function findNearest<T extends { x: number; y: number }>(
  x: number,
  y: number,
  items: T[],
): T | null {
  let nearest: T | null = null;
  let nearestDistance = Infinity;
  for (const item of items) {
    const d = distanceSquared(x, y, item.x, item.y);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = item;
    }
  }
  return nearest;
}

function randomPattern(): FishPattern {
  return FISH_PATTERNS[Math.floor(Math.random() * FISH_PATTERNS.length)];
}

/** Wraps a horizontal position that has drifted past the canvas edge back to the opposite edge. */
function wrapHorizontal(x: number, margin: number, width: number): number {
  if (x < -margin) return width + margin;
  if (x > width + margin) return -margin;
  return x;
}

interface Fish {
  x: number;
  y: number;
  size: number;
  speed: number;
  direction: number;
  frequency: number;
  amplitude: number;
  pattern: FishPattern;
  color: RgbColor;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  /** Normalized velocity boost from a nearby note-on; decays toward 0 each frame. */
  boost: number;
}

function spawnFish({ width, visHeight }: Bounds): Fish {
  const x = randomRange(0, width);
  const y = randomRange(0, visHeight);
  const pattern = randomPattern();
  return {
    x,
    y,
    size: randomRange(8, 15),
    speed: randomRange(1, 2.5),
    direction: randomRange(0, TWO_PI),
    frequency: randomRange(0.5, 1.5),
    amplitude: randomRange(10, 30),
    pattern,
    color: FISH_COLORS[pattern],
    centerX: x,
    centerY: y,
    radiusX: randomRange(100, 250),
    radiusY: randomRange(80, 200),
    boost: 0,
  };
}

function updateFish(
  fish: Fish,
  frame: number,
  { width, visHeight }: Bounds,
  speedScale: number,
): void {
  fish.boost *= BOOST_DECAY;
  const speed = fish.speed * speedScale * (1 + fish.boost * FISH_BOOST_SPEED_SCALE);

  switch (fish.pattern) {
    case 'traveling': {
      const time = frame * 0.02;
      const xVel = speed * Math.cos(time * fish.frequency);
      const yVel = fish.amplitude * 0.1 * Math.sin(time * 0.5);
      fish.x += xVel;
      fish.y += yVel;
      fish.direction = Math.atan2(yVel, xVel);
      break;
    }
    case 'circling': {
      const time = frame * 0.015;
      fish.x = fish.centerX + Math.cos(time * fish.frequency) * fish.radiusX;
      fish.y = fish.centerY + Math.sin(time * fish.frequency) * fish.radiusY;
      fish.direction = time * fish.frequency + HALF_PI;
      return;
    }
    case 'wandering': {
      if (frame % 180 === 0) fish.direction += randomRange(-PI / 4, PI / 4);
      fish.x += speed * Math.cos(fish.direction);
      fish.y += speed * Math.sin(fish.direction);
      break;
    }
  }

  fish.x = wrapHorizontal(fish.x, fish.size, width);

  if (fish.y < -fish.size) fish.y = visHeight + fish.size;
  else if (fish.y > visHeight + fish.size) fish.y = -fish.size;
}

function drawFish(p: P5Like, fish: Fish): void {
  const [r, g, b] = fish.color;
  const size = fish.size * (1 + fish.boost * FISH_BOOST_SIZE_SCALE);
  const bodyLength = size * 2;
  const bodyWidth = size * 0.8;

  p.push();
  p.translate(fish.x, fish.y);
  p.rotate(fish.direction);

  p.fill(r * 0.7, g * 0.7, b * 0.7);
  p.triangle(
    -bodyLength * 0.6,
    0,
    -bodyLength * 0.95,
    -bodyWidth * 0.6,
    -bodyLength * 0.95,
    bodyWidth * 0.6,
  );

  p.fill(r, g, b);
  p.ellipse(0, 0, bodyLength, bodyWidth);

  p.fill(r * 0.8, g * 0.8, b * 0.8);
  p.triangle(
    -bodyLength * 0.15,
    -bodyWidth * 0.4,
    bodyLength * 0.05,
    -bodyWidth * 0.9,
    bodyLength * 0.2,
    -bodyWidth * 0.35,
  );

  p.fill(255, 255, 255);
  const eyeSize = size * 0.25;
  p.ellipse(bodyLength * 0.25, 0, eyeSize, eyeSize);
  p.fill(0, 0, 0);
  p.ellipse(bodyLength * 0.27, 0, eyeSize * 0.5, eyeSize * 0.5);

  p.pop();
}

interface Jellyfish {
  x: number;
  y: number;
  size: number;
  speed: number;
  direction: number;
  pulsePhase: number;
  pulseSpeed: number;
  bobOffset: number;
  bobSpeed: number;
  tentacleCount: number;
  color: RgbColor;
  /** Normalized velocity boost from a nearby note-on; decays toward 0 each frame. */
  boost: number;
}

function spawnJellyfish({ width, visHeight }: Bounds): Jellyfish {
  return {
    x: randomRange(0, width),
    y: randomRange(0, visHeight),
    size: randomRange(15, 30),
    speed: randomRange(0.3, 0.8),
    direction: randomRange(0, TWO_PI),
    pulsePhase: randomRange(0, TWO_PI),
    pulseSpeed: randomRange(0.05, 0.1),
    bobOffset: randomRange(0, TWO_PI),
    bobSpeed: randomRange(0.02, 0.04),
    tentacleCount: Math.floor(randomRange(6, 12)),
    color: JELLYFISH_COLORS[Math.floor(Math.random() * JELLYFISH_COLORS.length)],
    boost: 0,
  };
}

function updateJellyfish(
  jelly: Jellyfish,
  frame: number,
  { width, visHeight }: Bounds,
  speedScale: number,
): void {
  jelly.boost *= BOOST_DECAY;
  const pulseSpeed = jelly.pulseSpeed * (1 + jelly.boost * JELLYFISH_BOOST_PULSE_SCALE);
  const speed = jelly.speed * speedScale;

  jelly.x += Math.cos(jelly.direction) * speed;
  jelly.y += Math.sin(jelly.direction) * speed * 0.5;
  jelly.y += Math.sin(frame * jelly.bobSpeed + jelly.bobOffset) * 0.5;

  if (frame % 200 === 0) jelly.direction += randomRange(-PI / 6, PI / 6);
  jelly.pulsePhase += pulseSpeed;

  jelly.x = wrapHorizontal(jelly.x, jelly.size * 2, width);

  const minY = jelly.size * 2;
  const maxY = visHeight - jelly.size * 2;
  if (jelly.y < minY) {
    jelly.y = minY;
    if (Math.sin(jelly.direction) < 0) jelly.direction = -jelly.direction;
  } else if (jelly.y > maxY) {
    jelly.y = maxY;
    if (Math.sin(jelly.direction) > 0) jelly.direction = -jelly.direction;
  }
}

function drawJellyfish(p: P5Like, jelly: Jellyfish, frame: number): void {
  const [r, g, b] = jelly.color;
  const pulse = Math.sin(jelly.pulsePhase);
  const boostedSize = jelly.size * (1 + jelly.boost * JELLYFISH_BOOST_SIZE_SCALE);
  const size = boostedSize + pulse * boostedSize * 0.2;

  p.push();
  p.translate(jelly.x, jelly.y);

  for (let i = 0; i < jelly.tentacleCount; i++) {
    const angle = (i / jelly.tentacleCount) * TWO_PI;
    const startX = Math.cos(angle) * size * 0.5;
    const startY = Math.sin(angle) * size * 0.3 + size * 0.3;
    const wave = Math.sin(frame * 0.05 + angle * 3) * size * 0.3;
    p.fill(r * 0.6, g * 0.6, b * 0.6, 180);
    p.ellipse(startX + wave * 0.5, startY + size * 1.5, size * 0.15, size * 1.6);
  }

  p.fill(r, g, b, 90);
  p.ellipse(0, 0, size * 1.6, size * 1.4);
  p.fill(r, g, b, 200);
  p.ellipse(0, 0, size * 1.1, size * 1.2);

  p.pop();
}

/** Parses a `#RRGGBB` hex color; falls back to the default water color when malformed. */
function hexToRgb(hex: string): RgbColor {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hexToRgb(DEFAULT_WATER_COLOR);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** Grows or shrinks `items` in place to match `targetLength`, spawning new entries as needed. */
function resizePopulation<T>(items: T[], targetLength: number, spawn: () => T): void {
  while (items.length < targetLength) items.push(spawn());
  if (items.length > targetLength) items.length = targetLength;
}

function drawWaterBackground(p: P5Like, { width, visHeight }: Bounds, surface: RgbColor): void {
  const [r0, g0, b0] = surface;
  const [r1, g1, b1] = [r0 * 0.25, g0 * 0.41, b0 * 0.48];
  for (let y = 0; y < visHeight; y++) {
    const inter = visHeight > 0 ? y / visHeight : 0;
    const r = r0 + (r1 - r0) * inter;
    const g = g0 + (g1 - g0) * inter;
    const b = b0 + (b1 - b0) * inter;
    p.stroke(r, g, b);
    p.line(0, y, width, y);
  }
}

/**
 * Revived from fish.js/jellyfish.js/piano.js/key.js. Crystals are no longer this
 * Scene's — they are an engine-owned Overlay (ADR 0004); the Scene only chooses
 * where to render them, drawing them behind its creatures via ctx.drawCrystals().
 */
export class UnderwaterScene implements Scene {
  readonly id = 'underwater';
  readonly label = 'Underwater';
  readonly params: ParamSpec[] = [
    {
      key: 'fishCount',
      label: 'Fish Count',
      type: 'range',
      default: DEFAULT_FISH_COUNT,
      min: 5,
      max: 40,
      step: 1,
    },
    {
      key: 'jellyfishCount',
      label: 'Jellyfish Count',
      type: 'range',
      default: DEFAULT_JELLYFISH_COUNT,
      min: 2,
      max: 20,
      step: 1,
    },
    {
      key: 'creatureSpeed',
      label: 'Creature Speed',
      type: 'range',
      default: DEFAULT_CREATURE_SPEED,
      min: 0.25,
      max: 3,
      step: 0.25,
    },
    {
      key: 'waterColor',
      label: 'Water Color',
      type: 'color',
      default: DEFAULT_WATER_COLOR,
    },
  ];

  private fish: Fish[] = [];
  private jellyfish: Jellyfish[] = [];
  private frame = 0;

  setup(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const fishCount = Number(ctx.params.fishCount ?? DEFAULT_FISH_COUNT);
    const jellyfishCount = Number(ctx.params.jellyfishCount ?? DEFAULT_JELLYFISH_COUNT);

    this.fish = Array.from({ length: fishCount }, () => spawnFish(bounds));
    this.jellyfish = Array.from({ length: jellyfishCount }, () => spawnJellyfish(bounds));
    this.frame = 0;
  }

  update(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const speedScale = Number(ctx.params.creatureSpeed ?? DEFAULT_CREATURE_SPEED);
    const fishCount = Number(ctx.params.fishCount ?? DEFAULT_FISH_COUNT);
    const jellyfishCount = Number(ctx.params.jellyfishCount ?? DEFAULT_JELLYFISH_COUNT);
    this.frame += 1;

    resizePopulation(this.fish, fishCount, () => spawnFish(bounds));
    resizePopulation(this.jellyfish, jellyfishCount, () => spawnJellyfish(bounds));

    for (const fish of this.fish) updateFish(fish, this.frame, bounds, speedScale);
    for (const jelly of this.jellyfish) updateJellyfish(jelly, this.frame, bounds, speedScale);
  }

  draw(ctx: SceneContext): void {
    const { p } = ctx;
    const bounds = boundsOf(ctx);
    const waterColor = hexToRgb(String(ctx.params.waterColor ?? DEFAULT_WATER_COLOR));

    p.push();
    drawWaterBackground(p, bounds, waterColor);

    // Draw the engine's Crystals here — after the water, before the creatures — so
    // they read as behind the fish/jellyfish (their placement in the original Scene).
    ctx.drawCrystals();
    for (const jelly of this.jellyfish) drawJellyfish(p, jelly, this.frame);
    for (const fish of this.fish) drawFish(p, fish);

    p.pop();
  }

  onNoteOn(event: NoteEvent, ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    // Crystals are spawned by the engine; the Scene only boosts the creature
    // nearest the pressed key, scaled by velocity.
    const pos = keyPosition(event.note, bounds.width, bounds.visHeight);
    const nearest = findNearest<Fish | Jellyfish>(pos.x, pos.y, [...this.fish, ...this.jellyfish]);
    if (nearest) nearest.boost = event.velocity;
  }

  onNoteOff(): void {
    // Crystals fall on release inside the engine; the Scene has nothing to do.
  }

  teardown(): void {
    this.fish = [];
    this.jellyfish = [];
  }
}
