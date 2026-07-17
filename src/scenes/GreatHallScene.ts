import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';
import { keyColumnX } from '@/engine/keyboardGeometry';

type RgbColor = readonly [number, number, number];

/** The visualization area a Scene's elements move and wrap within — never the Chroma Key band. */
interface Bounds {
  width: number;
  visHeight: number;
}

const DEFAULT_CANDLE_COUNT = 8;
const DEFAULT_CLOUD_COUNT = 4;
const DEFAULT_OWL_COUNT = 2;
const DEFAULT_SKY_TOP_COLOR = '#46536a';
const DEFAULT_HORIZON_COLOR = '#d1913c';

const MAX_CANDLES = 16;
const MAX_CLOUDS = 6;
const MAX_OWLS = 3;

/** Light against the storm sky so the owls pop against the darker castle behind them. */
const OWL_SILHOUETTE: RgbColor = [158, 163, 182];

const CASTLE_SILHOUETTE: RgbColor = [24, 27, 42];
/** Slightly translucent so the sky glows through, placing the castle in the far distance. */
const CASTLE_ALPHA = 165;

/**
 * The castle's towers as fractions of the canvas: one tall central tower with
 * a smaller one touching it on each side, filling the right quarter of the
 * width flush to the right edge. The towers sit flush against each other —
 * no gaps, and no overlaps that would double-paint the translucent fill.
 */
const CASTLE_TOWERS = [
  { left: 0.8, width: 0.05, top: 0.46 },
  { left: 0.85, width: 0.09, top: 0.26 },
  { left: 0.94, width: 0.06, top: 0.46 },
] as const;

const LIGHTNING_MIN_INTERVAL_MS = 8_000;
const LIGHTNING_MAX_INTERVAL_MS = 20_000;
/** How long the flash holds at full strength — roughly 2–3 frames at 60fps. */
const LIGHTNING_HOLD_MS = 50;
const LIGHTNING_FADE_MS = 300;
const LIGHTNING_MAX_ALPHA = 80;

const FLARE_DECAY = 0.94;
const FLARE_HEIGHT_SCALE = 0.9;
const FLARE_WIDTH_SCALE = 0.3;
const FLARE_GLOW_ALPHA_SCALE = 90;

const GRADIENT_SHIFT_PERIOD_MS = 90_000;
const GRADIENT_SHIFT_AMOUNT = 0.12;

const TWO_PI = Math.PI * 2;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function boundsOf(ctx: SceneContext): Bounds {
  return { width: ctx.width, visHeight: ctx.height - ctx.chromaKeyHeight };
}

/** Parses a `#RRGGBB` hex color; falls back to `fallback` when malformed. */
function hexToRgb(hex: string, fallback: RgbColor): RgbColor {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return fallback;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

const SKY_TOP_FALLBACK = hexToRgb(DEFAULT_SKY_TOP_COLOR, [70, 83, 106]);
const HORIZON_FALLBACK = hexToRgb(DEFAULT_HORIZON_COLOR, [209, 145, 60]);

/** Wraps a horizontal position that has drifted past the canvas edge back to the opposite edge. */
function wrapHorizontal(x: number, margin: number, width: number): number {
  if (x < -margin) return width + margin;
  if (x > width + margin) return -margin;
  return x;
}

/**
 * 1D value noise standing in for p5's noise() (P5Like exposes no noise):
 * smooth-interpolated hashed lattice values, per the Perlin-noise intro of
 * The Nature of Code (§I.5). Drives the cloud drift and the flame flicker.
 */
function valueNoise(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return latticeValue(i) * (1 - u) + latticeValue(i + 1) * u;
}

/** Deterministic pseudo-random lattice value in [0, 1) for integer inputs. */
function latticeValue(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface CloudPuff {
  dx: number;
  dy: number;
  w: number;
  h: number;
}

interface Cloud {
  x: number;
  y: number;
  /** Baseline drift in px/frame; noise wobbles around it so no two clouds move alike. */
  speed: number;
  /** Offsets this cloud's noise samples so each cloud drifts independently. */
  seed: number;
  width: number;
  puffs: CloudPuff[];
}

function spawnCloud({ width, visHeight }: Bounds): Cloud {
  const scale = randomRange(0.7, 1.3);
  const cloudWidth = 220 * scale;
  const puffCount = 6;
  const puffs: CloudPuff[] = [];
  for (let i = 0; i < puffCount; i++) {
    const spread = (i / (puffCount - 1) - 0.5) * cloudWidth;
    const edgeFalloff = 1 - Math.abs(spread) / (cloudWidth * 1.6);
    puffs.push({
      dx: spread + randomRange(-15, 15) * scale,
      dy: randomRange(-18, 18) * scale * edgeFalloff,
      w: randomRange(90, 150) * scale * edgeFalloff,
      h: randomRange(45, 70) * scale,
    });
  }
  return {
    x: randomRange(0, width),
    y: randomRange(visHeight * 0.08, visHeight * 0.4),
    speed: randomRange(0.15, 0.45),
    seed: randomRange(0, 1000),
    width: cloudWidth,
    puffs,
  };
}

/**
 * Noise-driven horizontal drift — smooth wobble around a per-cloud base speed,
 * the noise-mapped motion of The Nature of Code §I.5.
 */
function updateCloud(cloud: Cloud, { width }: Bounds, timeMs: number): void {
  const wobble = (valueNoise(cloud.seed + timeMs * 0.0002) - 0.5) * 0.8;
  cloud.x += cloud.speed + wobble;
  cloud.x = wrapHorizontal(cloud.x, cloud.width, width);
}

function drawCloud(p: P5Like, cloud: Cloud): void {
  p.fill(190, 196, 210, 34);
  for (const puff of cloud.puffs) {
    p.ellipse(cloud.x + puff.dx, cloud.y + puff.dy, puff.w, puff.h);
  }
}

interface Owl {
  x: number;
  y: number;
  /** Flight altitude at rest; the sine bob oscillates around it. */
  baseY: number;
  size: number;
  /** Horizontal speed in px/frame. */
  speed: number;
  /** +1 flies rightward, -1 leftward; also mirrors the silhouette. */
  direction: 1 | -1;
  bobPhase: number;
  bobPeriodMs: number;
  bobAmplitude: number;
  flapPeriodMs: number;
}

function spawnOwl({ width, visHeight }: Bounds): Owl {
  const size = randomRange(26, 40);
  const bobAmplitude = randomRange(12, 26);
  // The wing tip swings up to ~1.3×size above the body; keep the whole bob
  // envelope inside the visualization area's upper half.
  const minY = bobAmplitude + size * 1.5;
  const baseY = randomRange(Math.max(minY, visHeight * 0.18), visHeight * 0.5);
  return {
    x: randomRange(0, width),
    y: baseY,
    baseY,
    size,
    speed: randomRange(0.8, 1.6),
    direction: Math.random() < 0.5 ? -1 : 1,
    bobPhase: randomRange(0, TWO_PI),
    bobPeriodMs: randomRange(2500, 4500),
    bobAmplitude,
    flapPeriodMs: randomRange(500, 900),
  };
}

/**
 * Steady horizontal travel with a gentle sine bob — simple harmonic motion per
 * Nature of Code ch. 3 (Oscillation), like Underwater's traveling fish but on
 * a fixed heading.
 */
function updateOwl(owl: Owl, { width }: Bounds, timeMs: number): void {
  owl.x += owl.speed * owl.direction;
  owl.x = wrapHorizontal(owl.x, owl.size * 2, width);
  owl.y =
    owl.baseY + Math.sin((timeMs / owl.bobPeriodMs) * TWO_PI + owl.bobPhase) * owl.bobAmplitude;
}

/**
 * A silhouette owl: ellipse body/head plus two triangle wings whose tips swing
 * on a sine — the sine-driven angular flap of Nature of Code ch. 3
 * (Oscillation), driven by ctx.elapsed since Scenes never read frameCount.
 */
function drawOwl(p: P5Like, owl: Owl, timeMs: number): void {
  const s = owl.size;
  const dir = owl.direction;
  const flap = Math.sin((timeMs / owl.flapPeriodMs) * TWO_PI + owl.bobPhase);
  const [r, g, b] = OWL_SILHOUETTE;

  p.push();
  p.translate(owl.x, owl.y);
  p.fill(r, g, b, 235);

  // Far wing leads the near one slightly so the flap reads as two wings.
  const farTipY = -flap * s * 1.1 - s * 0.15;
  p.triangle(dir * s * 0.25, -s * 0.1, -dir * s * 0.35, -s * 0.15, -dir * s * 0.85, farTipY);

  p.ellipse(-dir * s * 0.15, 0, s * 1.4, s * 0.75); // body
  p.triangle(-dir * s * 0.6, s * 0.05, -dir * s * 1.15, s * 0.3, -dir * s * 0.6, s * 0.3); // tail
  p.ellipse(dir * s * 0.65, -s * 0.15, s * 0.6, s * 0.55); // head
  // Ear tufts, the owl's signature against the sky.
  p.triangle(dir * s * 0.5, -s * 0.38, dir * s * 0.42, -s * 0.62, dir * s * 0.6, -s * 0.42);
  p.triangle(dir * s * 0.8, -s * 0.38, dir * s * 0.88, -s * 0.62, dir * s * 0.7, -s * 0.42);

  const nearTipY = -flap * s * 0.9 + s * 0.1;
  p.triangle(dir * s * 0.3, 0, -dir * s * 0.3, s * 0.05, -dir * s * 0.7, nearTipY);

  p.pop();
}

/**
 * A static castle silhouette on the right quarter — a tall central tower with
 * a smaller one flush against each side. Pure composition, no motion math, so
 * no prior-art reference applies. Sits at the very back of the scene: only
 * the sky gradient is behind it, and everything else draws over it.
 */
function drawCastle(p: P5Like, { width, visHeight }: Bounds): void {
  const [r, g, b] = CASTLE_SILHOUETTE;
  p.fill(r, g, b, CASTLE_ALPHA);

  for (const tower of CASTLE_TOWERS) {
    const left = width * tower.left;
    const towerWidth = width * tower.width;
    const top = visHeight * tower.top;
    p.rect(left, top, towerWidth, visHeight - top);
    const spireHeight = Math.min(towerWidth * 0.9, top);
    p.triangle(left, top, left + towerWidth, top, left + towerWidth / 2, top - spireHeight);
  }
}

interface Candle {
  x: number;
  /** Top of the candle body at rest; the levitation bob oscillates around it. */
  baseY: number;
  bodyWidth: number;
  bodyHeight: number;
  levitates: boolean;
  bobPhase: number;
  bobPeriodMs: number;
  bobAmplitude: number;
  /** Offsets this candle's flicker noise so no two flames jitter in sync. */
  seed: number;
  /** Normalized note-on flare; decays toward 0 each frame. */
  flare: number;
}

function spawnCandle(index: number, count: number, { width, visHeight }: Bounds): Candle {
  const slot = width / count;
  const bodyHeight = randomRange(34, 56);
  const bobAmplitude = randomRange(4, 9);
  return {
    x: slot * (index + 0.5) + randomRange(-slot * 0.15, slot * 0.15),
    baseY: visHeight - bodyHeight - bobAmplitude - randomRange(4, 14),
    bodyWidth: randomRange(8, 12),
    bodyHeight,
    levitates: index % 3 === 0,
    bobPhase: randomRange(0, TWO_PI),
    bobPeriodMs: randomRange(3000, 6000),
    bobAmplitude,
    seed: randomRange(0, 1000),
    flare: 0,
  };
}

function updateCandle(candle: Candle): void {
  candle.flare *= FLARE_DECAY;
}

/**
 * The flame is a stack of ellipses whose size and x-sway jitter with value
 * noise (Nature of Code §I.5) — that reads as flicker without particles. The
 * levitation bob is simple harmonic motion per Nature of Code ch. 3
 * (Oscillation).
 */
function drawCandle(p: P5Like, candle: Candle, timeMs: number): void {
  const bob = candle.levitates
    ? Math.sin((timeMs / candle.bobPeriodMs) * TWO_PI + candle.bobPhase) * candle.bobAmplitude
    : 0;
  const y = candle.baseY + bob;

  p.fill(232, 222, 196);
  p.rect(candle.x - candle.bodyWidth / 2, y, candle.bodyWidth, candle.bodyHeight);

  const t = timeMs * 0.004 + candle.seed;
  const flicker = valueNoise(t);
  const sway = (valueNoise(t + 57.3) - 0.5) * candle.bodyWidth * 0.35;
  const flameH = candle.bodyWidth * (1.6 + flicker * 0.7) * (1 + candle.flare * FLARE_HEIGHT_SCALE);
  const flameW = candle.bodyWidth * (0.75 + flicker * 0.2) * (1 + candle.flare * FLARE_WIDTH_SCALE);
  const flameX = candle.x + sway;
  const flameY = y - flameH * 0.5 - 2;

  p.fill(255, 180, 90, 36 + candle.flare * FLARE_GLOW_ALPHA_SCALE);
  p.ellipse(flameX, flameY, flameW * 3.2, flameH * 2.2);
  p.fill(255, 165, 70, 220);
  p.ellipse(flameX, flameY, flameW, flameH);
  p.fill(255, 236, 170, 240);
  p.ellipse(flameX, flameY + flameH * 0.12, flameW * 0.5, flameH * 0.55);
}

/** Finds the candle whose column is nearest `x`; note→candle mapping is the Scene's own concern. */
function nearestCandle(x: number, candles: Candle[]): Candle | null {
  let nearest: Candle | null = null;
  let nearestDistance = Infinity;
  for (const candle of candles) {
    const d = Math.abs(candle.x - x);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = candle;
    }
  }
  return nearest;
}

/**
 * Per-row lerp gradient like Underwater's water background, storm blue-grey
 * into warm gold at the horizon. A slow sine bends the blend curve so the
 * gold creeps up and down almost imperceptibly over ~90s.
 */
function drawSkyGradient(
  p: P5Like,
  { width, visHeight }: Bounds,
  top: RgbColor,
  horizon: RgbColor,
  timeMs: number,
): void {
  const [r0, g0, b0] = top;
  const [r1, g1, b1] = horizon;
  const exponent =
    1 + Math.sin((timeMs / GRADIENT_SHIFT_PERIOD_MS) * TWO_PI) * GRADIENT_SHIFT_AMOUNT;
  for (let y = 0; y < visHeight; y++) {
    const inter = Math.pow(y / visHeight, exponent);
    p.stroke(r0 + (r1 - r0) * inter, g0 + (g1 - g0) * inter, b0 + (b1 - b0) * inter);
    p.line(0, y, width, y);
  }
}

/**
 * The Great Hall's enchanted ceiling: a slowly shifting storm sky, clouds
 * drifting on noise, silhouette owls flapping across, a translucent castle on
 * the right, random lightning, and a row of levitating candles in the
 * foreground. Notes flare the candle at the key's column.
 */
export class GreatHallScene implements Scene {
  readonly id = 'greatHall';
  readonly label = 'Great Hall';
  readonly params: ParamSpec[] = [
    {
      key: 'candleCount',
      label: 'Candle Count',
      type: 'range',
      default: DEFAULT_CANDLE_COUNT,
      min: 3,
      max: MAX_CANDLES,
      step: 1,
    },
    {
      key: 'cloudCount',
      label: 'Cloud Count',
      type: 'range',
      default: DEFAULT_CLOUD_COUNT,
      min: 2,
      max: MAX_CLOUDS,
      step: 1,
    },
    {
      key: 'owlCount',
      label: 'Owl Count',
      type: 'range',
      default: DEFAULT_OWL_COUNT,
      min: 0,
      max: MAX_OWLS,
      step: 1,
    },
    {
      key: 'skyTopColor',
      label: 'Sky Top',
      type: 'color',
      default: DEFAULT_SKY_TOP_COLOR,
    },
    {
      key: 'horizonColor',
      label: 'Horizon Glow',
      type: 'color',
      default: DEFAULT_HORIZON_COLOR,
    },
    {
      key: 'lightning',
      label: 'Lightning',
      type: 'toggle',
      default: true,
    },
    {
      key: 'castle',
      label: 'Castle',
      type: 'toggle',
      default: true,
    },
  ];

  private clouds: Cloud[] = [];
  private owls: Owl[] = [];
  private candles: Candle[] = [];
  private nextFlashAt = 0;
  private flashStartedAt = -Infinity;

  setup(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const candleCount = Number(ctx.params.candleCount ?? DEFAULT_CANDLE_COUNT);
    const cloudCount = Number(ctx.params.cloudCount ?? DEFAULT_CLOUD_COUNT);
    const owlCount = Number(ctx.params.owlCount ?? DEFAULT_OWL_COUNT);

    this.clouds = Array.from({ length: cloudCount }, () => spawnCloud(bounds));
    this.owls = Array.from({ length: owlCount }, () => spawnOwl(bounds));
    this.candles = Array.from({ length: candleCount }, (_, i) =>
      spawnCandle(i, candleCount, bounds),
    );
    this.flashStartedAt = -Infinity;
    this.nextFlashAt =
      ctx.elapsed + randomRange(LIGHTNING_MIN_INTERVAL_MS, LIGHTNING_MAX_INTERVAL_MS);
  }

  update(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const candleCount = Number(ctx.params.candleCount ?? DEFAULT_CANDLE_COUNT);
    const cloudCount = Number(ctx.params.cloudCount ?? DEFAULT_CLOUD_COUNT);

    // Candles are evenly spaced across the key columns, so a count change
    // relays out the whole row (only reallocates on the param change itself).
    if (this.candles.length !== candleCount) {
      this.candles = Array.from({ length: candleCount }, (_, i) =>
        spawnCandle(i, candleCount, bounds),
      );
    }
    while (this.clouds.length < cloudCount) this.clouds.push(spawnCloud(bounds));
    if (this.clouds.length > cloudCount) this.clouds.length = cloudCount;

    const owlCount = Number(ctx.params.owlCount ?? DEFAULT_OWL_COUNT);
    while (this.owls.length < owlCount) this.owls.push(spawnOwl(bounds));
    if (this.owls.length > owlCount) this.owls.length = owlCount;

    for (const cloud of this.clouds) updateCloud(cloud, bounds, ctx.elapsed);
    for (const owl of this.owls) updateOwl(owl, bounds, ctx.elapsed);
    for (const candle of this.candles) updateCandle(candle);

    if (ctx.params.lightning !== false && ctx.elapsed >= this.nextFlashAt) {
      this.flashStartedAt = ctx.elapsed;
      this.nextFlashAt =
        ctx.elapsed + randomRange(LIGHTNING_MIN_INTERVAL_MS, LIGHTNING_MAX_INTERVAL_MS);
    }
  }

  draw(ctx: SceneContext): void {
    const { p } = ctx;
    const bounds = boundsOf(ctx);
    const skyTop = hexToRgb(
      String(ctx.params.skyTopColor ?? DEFAULT_SKY_TOP_COLOR),
      SKY_TOP_FALLBACK,
    );
    const horizon = hexToRgb(
      String(ctx.params.horizonColor ?? DEFAULT_HORIZON_COLOR),
      HORIZON_FALLBACK,
    );

    p.push();
    drawSkyGradient(p, bounds, skyTop, horizon, ctx.elapsed);

    p.noStroke();
    // The castle is the backdrop: everything that moves — clouds, owls,
    // crystals, candles — passes in front of it.
    if (ctx.params.castle !== false) drawCastle(p, bounds);

    for (const cloud of this.clouds) drawCloud(p, cloud);
    for (const owl of this.owls) drawOwl(p, owl, ctx.elapsed);

    // Crystals sit behind the foreground candles — in the sky with the clouds
    // and owls — so the candle row stays the closest layer, like Underwater's
    // creatures.
    ctx.drawCrystals();

    p.noStroke();
    for (const candle of this.candles) drawCandle(p, candle, ctx.elapsed);

    // Full-scene flash on top: a hold at full strength then a fade, the same
    // fade-over-lifespan envelope as a p5.js particle example (cf. RainScene's
    // ripples), applied to a near-white overlay.
    const flash = this.flashIntensity(ctx.elapsed);
    if (flash > 0) {
      p.fill(235, 240, 255, flash * LIGHTNING_MAX_ALPHA);
      p.rect(0, 0, bounds.width, bounds.visHeight);
    }
    p.pop();
  }

  onNoteOn(event: NoteEvent, ctx: SceneContext): void {
    // Crystals are spawned by the engine; the Scene flares the candle at the
    // pressed key's column, scaled by velocity.
    const x = keyColumnX(event.note, ctx.width);
    const candle = nearestCandle(x, this.candles);
    if (candle) candle.flare = Math.max(candle.flare, event.velocity);
  }

  onNoteOff(): void {
    // Crystals fall on release inside the engine; the flare just decays.
  }

  teardown(): void {
    this.clouds = [];
    this.owls = [];
    this.candles = [];
    this.nextFlashAt = 0;
    this.flashStartedAt = -Infinity;
  }

  private flashIntensity(elapsed: number): number {
    const age = elapsed - this.flashStartedAt;
    if (age < 0) return 0;
    if (age < LIGHTNING_HOLD_MS) return 1;
    const fade = 1 - (age - LIGHTNING_HOLD_MS) / LIGHTNING_FADE_MS;
    return fade > 0 ? fade : 0;
  }
}
