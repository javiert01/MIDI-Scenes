import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';

type FishPattern = 'traveling' | 'circling' | 'wandering';
type RgbColor = readonly [number, number, number];

/** The visualization area a Scene's elements move and wrap within — never the Chroma Key band. */
interface Bounds {
  width: number;
  visHeight: number;
}

const DEFAULT_FISH_COUNT = 20;
const DEFAULT_JELLYFISH_COUNT = 10;

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

const CRYSTAL_COLORS: [RgbColor, RgbColor] = [
  [138, 43, 226],
  [255, 69, 0],
];

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function boundsOf(ctx: SceneContext): Bounds {
  return { width: ctx.width, visHeight: ctx.height - ctx.chromaKeyHeight };
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
  };
}

function updateFish(fish: Fish, frame: number, { width, visHeight }: Bounds): void {
  switch (fish.pattern) {
    case 'traveling': {
      const time = frame * 0.02;
      const xVel = fish.speed * Math.cos(time * fish.frequency);
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
      fish.x += fish.speed * Math.cos(fish.direction);
      fish.y += fish.speed * Math.sin(fish.direction);
      break;
    }
  }

  fish.x = wrapHorizontal(fish.x, fish.size, width);

  if (fish.y < -fish.size) fish.y = visHeight + fish.size;
  else if (fish.y > visHeight + fish.size) fish.y = -fish.size;
}

function drawFish(p: P5Like, fish: Fish): void {
  const [r, g, b] = fish.color;
  const bodyLength = fish.size * 2;
  const bodyWidth = fish.size * 0.8;

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
  const eyeSize = fish.size * 0.25;
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
  };
}

function updateJellyfish(jelly: Jellyfish, frame: number, { width, visHeight }: Bounds): void {
  jelly.x += Math.cos(jelly.direction) * jelly.speed;
  jelly.y += Math.sin(jelly.direction) * jelly.speed * 0.5;
  jelly.y += Math.sin(frame * jelly.bobSpeed + jelly.bobOffset) * 0.5;

  if (frame % 200 === 0) jelly.direction += randomRange(-PI / 6, PI / 6);
  jelly.pulsePhase += jelly.pulseSpeed;

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
  const size = jelly.size + pulse * jelly.size * 0.2;

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

interface CrystalShaft {
  x: number;
  y: number;
  length: number;
  active: boolean;
  growing: boolean;
  color: RgbColor;
}

const CRYSTAL_POOL_SIZE = 12;
const CRYSTAL_SPAWN_CHANCE = 0.01;
const CRYSTAL_GROWTH_RATE = 6;
const CRYSTAL_MAX_LENGTH = 60;
const CRYSTAL_RISE_RATE = 4;

function spawnCrystalPool(): CrystalShaft[] {
  return Array.from({ length: CRYSTAL_POOL_SIZE }, () => ({
    x: 0,
    y: 0,
    length: 0,
    active: false,
    growing: false,
    color: CRYSTAL_COLORS[0],
  }));
}

function updateCrystal(crystal: CrystalShaft, { width, visHeight }: Bounds): void {
  if (!crystal.active) {
    if (Math.random() < CRYSTAL_SPAWN_CHANCE) {
      crystal.active = true;
      crystal.growing = true;
      crystal.x = randomRange(0, width);
      crystal.y = visHeight;
      crystal.length = 0.5;
      crystal.color = CRYSTAL_COLORS[Math.random() < 0.5 ? 0 : 1];
    }
    return;
  }

  if (crystal.growing) {
    crystal.length += CRYSTAL_GROWTH_RATE;
    if (crystal.length >= CRYSTAL_MAX_LENGTH) crystal.growing = false;
    return;
  }

  crystal.y -= CRYSTAL_RISE_RATE;
  if (crystal.y + crystal.length < 0) crystal.active = false;
}

function drawCrystal(p: P5Like, crystal: CrystalShaft): void {
  if (!crystal.active) return;
  const [r, g, b] = crystal.color;
  p.fill(r, g, b, 40);
  p.rect(crystal.x, crystal.y - crystal.length, 6, crystal.length);
}

function drawWaterBackground(p: P5Like, { width, visHeight }: Bounds): void {
  for (let y = 0; y < visHeight; y++) {
    const inter = visHeight > 0 ? y / visHeight : 0;
    const r = 20 + (5 - 20) * inter;
    const g = 85 + (35 - 85) * inter;
    const b = 115 + (55 - 115) * inter;
    p.stroke(r, g, b);
    p.line(0, y, width, y);
  }
}

/** Revived from fish.js/jellyfish.js/crystal.js; note reactions land in T6. */
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
  ];

  private fish: Fish[] = [];
  private jellyfish: Jellyfish[] = [];
  private crystals: CrystalShaft[] = [];
  private frame = 0;

  setup(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const fishCount = Number(ctx.params.fishCount ?? DEFAULT_FISH_COUNT);
    const jellyfishCount = Number(ctx.params.jellyfishCount ?? DEFAULT_JELLYFISH_COUNT);

    this.fish = Array.from({ length: fishCount }, () => spawnFish(bounds));
    this.jellyfish = Array.from({ length: jellyfishCount }, () => spawnJellyfish(bounds));
    this.crystals = spawnCrystalPool();
    this.frame = 0;
  }

  update(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    this.frame += 1;

    for (const fish of this.fish) updateFish(fish, this.frame, bounds);
    for (const jelly of this.jellyfish) updateJellyfish(jelly, this.frame, bounds);
    for (const crystal of this.crystals) updateCrystal(crystal, bounds);
  }

  draw(ctx: SceneContext): void {
    const { p } = ctx;
    const bounds = boundsOf(ctx);

    p.push();
    drawWaterBackground(p, bounds);

    for (const crystal of this.crystals) drawCrystal(p, crystal);
    for (const jelly of this.jellyfish) drawJellyfish(p, jelly, this.frame);
    for (const fish of this.fish) drawFish(p, fish);

    p.pop();
  }

  onNoteOn(_event: NoteEvent, _ctx: SceneContext): void {
    // Note reactions land in T6.
  }

  onNoteOff(_event: NoteEvent, _ctx: SceneContext): void {
    // Note reactions land in T6.
  }

  teardown(): void {
    this.fish = [];
    this.jellyfish = [];
    this.crystals = [];
  }
}
