import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';
import { keyPosition } from '@/engine/keyboardGeometry';

type RgbColor = readonly [number, number, number];

/** The visualization area a Scene's elements move and wrap within — never the Chroma Key band. */
interface Bounds {
  width: number;
  visHeight: number;
}

const TWO_PI = Math.PI * 2;
/** One 60fps frame; motion is tuned per frame and scaled by the real frame time. */
const FRAME_MS = 1000 / 60;
/** Longest frame the motion integrates, so a stalled tab doesn't teleport the snow. */
const MAX_FRAME_MS = 50;

const DEFAULT_SNOW_COUNT = 250;
const DEFAULT_TREE_COUNT = 9;
const DEFAULT_STAR_COUNT = 80;
const DEFAULT_SNOW_SPEED = 1;
const DEFAULT_WIND = 1;
const DEFAULT_SKY_TOP = '#060a22';
const DEFAULT_SKY_HORIZON = '#2a3d74';
const DEFAULT_SNOW_COLOR = '#ffffff';
const DEFAULT_LIGHT_PALETTE = 'classic';
/** The Fairy Lights option that leaves the trees bare. */
const LIGHTS_OFF = 'off';

const MAX_STARS = 200;
const MAX_FLURRY = 150;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function boundsOf(ctx: SceneContext): Bounds {
  return { width: ctx.width, visHeight: ctx.height - ctx.chromaKeyHeight };
}

/** Parses a `#RRGGBB` hex color; falls back to `fallback` when malformed. */
function hexToRgb(hex: string, fallback: string): RgbColor {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hexToRgb(fallback, fallback);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** Sets the fill to `a` blended `t` of the way toward `b` — no color allocation per call. */
function fillMix(p: P5Like, a: RgbColor, b: RgbColor, t: number, alpha = 255): void {
  p.fill(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, alpha);
}

/** Grows or shrinks `items` in place to match `targetLength`, spawning new entries as needed. */
function resizePopulation<T>(items: T[], targetLength: number, spawn: () => T): void {
  while (items.length < targetLength) items.push(spawn());
  if (items.length > targetLength) items.length = targetLength;
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

/** Deterministic pseudo-random lattice value in [0, 1) for integer inputs. */
function latticeValue(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 1D value noise standing in for p5's noise() (P5Like exposes no noise):
 * smooth-interpolated hashed lattice values, per the Perlin-noise intro of
 * The Nature of Code (§I.5). Drives the wind.
 */
function valueNoise(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return latticeValue(i) * (1 - u) + latticeValue(i + 1) * u;
}

/** How fast the wind wanders through its noise, in lattice cells per ms. */
const WIND_NOISE_RATE = 0.00012;
/** Sideways push of a full-strength gust on the nearest flakes, px/frame. */
const WIND_MAX_PUSH = 1.6;

/** The wind right now, in -1..1: a slow noise walk, so gusts build and die away. */
function windAt(timeMs: number): number {
  return valueNoise(timeMs * WIND_NOISE_RATE) * 2 - 1;
}

// ---------------------------------------------------------------------------
// Snowy ground: two rolling snowbanks the trees stand on.
// ---------------------------------------------------------------------------

interface Hill {
  /** Mean height above the bottom edge, as a fraction of the visualization height. */
  base: number;
  /** How far the crest rolls above and below `base`, same unit. */
  amp: number;
  freqA: number;
  phaseA: number;
  freqB: number;
  phaseB: number;
}

const BACK_HILL: Hill = {
  base: 0.14,
  amp: 0.028,
  freqA: 5.2,
  phaseA: 0.6,
  freqB: 11.5,
  phaseB: 2.1,
};
const FRONT_HILL: Hill = {
  base: 0.075,
  amp: 0.02,
  freqA: 3.7,
  phaseA: 3.4,
  freqB: 8.9,
  phaseB: 0.9,
};

/** Spacing of the vertices tracing a snowbank's crest, px. */
const HILL_STEP = 24;

/** The y of a snowbank's crest at `xFrac` (0..1 across the width): two summed sines. */
function hillY(hill: Hill, xFrac: number, visHeight: number): number {
  const roll =
    0.6 * Math.sin(xFrac * hill.freqA + hill.phaseA) +
    0.4 * Math.sin(xFrac * hill.freqB + hill.phaseB);
  return visHeight * (1 - hill.base - hill.amp * roll);
}

function drawHill(p: P5Like, hill: Hill, { width, visHeight }: Bounds): void {
  p.beginShape();
  p.vertex(0, visHeight);
  for (let x = 0; x < width; x += HILL_STEP) p.vertex(x, hillY(hill, x / width, visHeight));
  p.vertex(width, hillY(hill, 1, visHeight));
  p.vertex(width, visHeight);
  p.endShape('close');
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

/**
 * A vertical gradient from the top color down to the horizon color, banded like
 * Underwater's water background: consecutive rows that round to the same 8-bit
 * color are painted as one rect.
 */
function drawSkyGradient(
  p: P5Like,
  { width, visHeight }: Bounds,
  top: RgbColor,
  horizon: RgbColor,
): void {
  let bandTop = 0;
  let bandColor = -1;
  const rows = Math.ceil(visHeight);
  for (let y = 0; y <= rows; y++) {
    let color = -1;
    if (y < rows) {
      const inter = y / visHeight;
      color =
        (Math.round(top[0] + (horizon[0] - top[0]) * inter) << 16) |
        (Math.round(top[1] + (horizon[1] - top[1]) * inter) << 8) |
        Math.round(top[2] + (horizon[2] - top[2]) * inter);
    }
    if (color === bandColor) continue;
    if (bandColor >= 0) {
      p.fill(bandColor >> 16, (bandColor >> 8) & 0xff, bandColor & 0xff);
      // The area's height is rarely whole: the last band stops at its edge.
      p.rect(0, bandTop, width, Math.min(y, visHeight) - bandTop);
    }
    bandTop = y;
    bandColor = color;
  }
}

interface Star {
  x: number;
  y: number;
  size: number;
  twinklePhase: number;
  twinkleSpeed: number;
}

/** How far down the sky stars reach, as a fraction of the visualization height. */
const STAR_BAND = 0.62;

/**
 * Fixed star positions, hashed from the index (no Math.random), packed toward
 * the top of the sky where it is darkest. The Star Count param shows the first N.
 */
const STARS: Star[] = Array.from({ length: MAX_STARS }, (_, i) => ({
  x: latticeValue(i * 3 + 1),
  y: Math.pow(latticeValue(i * 3 + 2), 1.5) * STAR_BAND,
  size: 1.4 + latticeValue(i * 3 + 3) * 1.8,
  twinklePhase: latticeValue(i + 500) * TWO_PI,
  twinkleSpeed: 0.0008 + latticeValue(i + 900) * 0.0018,
}));

/**
 * Stars twinkle on a sine each (Nature of Code ch. 3, Oscillation) and fade
 * out toward the horizon, where the glow would drown them.
 */
function drawStars(p: P5Like, { width, visHeight }: Bounds, count: number, timeMs: number): void {
  const shown = Math.min(count, STARS.length);
  for (let i = 0; i < shown; i++) {
    const star = STARS[i];
    const twinkle = 0.5 + 0.5 * Math.sin(timeMs * star.twinkleSpeed + star.twinklePhase);
    const fade = 1 - star.y / STAR_BAND;
    p.fill(250, 246, 230, 230 * fade * (0.3 + 0.7 * twinkle));
    p.ellipse(star.x * width, star.y * visHeight, star.size, star.size);
  }
}

// ---------------------------------------------------------------------------
// Snowflakes
// ---------------------------------------------------------------------------

/** Depth layers the flakes are drawn in, far to near, so each layer sets its fill once. */
const FLAKE_LAYERS = 3;
const FLAKE_LAYER_ALPHA = [120, 185, 245] as const;

interface Snowflake {
  x: number;
  y: number;
  /** 0 (far: small, slow, faint) .. 1 (near: big, fast, bright). */
  depth: number;
  layer: number;
  size: number;
  fallSpeed: number;
  swayPhase: number;
  swaySpeed: number;
  swayAmp: number;
}

function resetSnowflake(flake: Snowflake, { width, visHeight }: Bounds, atTop: boolean): void {
  const depth = Math.random();
  flake.x = randomRange(0, width);
  flake.y = atTop ? -randomRange(4, 40) : randomRange(-visHeight * 0.1, visHeight);
  flake.depth = depth;
  flake.layer = Math.min(FLAKE_LAYERS - 1, Math.floor(depth * FLAKE_LAYERS));
  flake.size = 1.4 + depth * 3.4 + randomRange(0, 0.8);
  flake.fallSpeed = 0.5 + depth * 1.5 + randomRange(0, 0.4);
  flake.swayPhase = randomRange(0, TWO_PI);
  flake.swaySpeed = randomRange(0.015, 0.045);
  flake.swayAmp = randomRange(0.15, 0.6);
}

/**
 * Ambient snow, after the p5.js "Snowflakes" particle-system example: each
 * flake falls at its own speed while a per-flake sine sways it sideways, and is
 * recycled at the top once it lands. Size and speed scale with depth for
 * parallax, and a shared noise-driven wind (Nature of Code §I.5) pushes the
 * near flakes harder than the far ones.
 */
function spawnSnowflake(bounds: Bounds): Snowflake {
  const flake: Snowflake = {
    x: 0,
    y: 0,
    depth: 0,
    layer: 0,
    size: 0,
    fallSpeed: 0,
    swayPhase: 0,
    swaySpeed: 0,
    swayAmp: 0,
  };
  resetSnowflake(flake, bounds, false);
  return flake;
}

function updateSnowflake(
  flake: Snowflake,
  bounds: Bounds,
  frames: number,
  speedScale: number,
  windPush: number,
): void {
  const { width, visHeight } = bounds;
  flake.swayPhase += flake.swaySpeed * frames;
  flake.y += flake.fallSpeed * speedScale * frames;
  flake.x +=
    (Math.sin(flake.swayPhase) * flake.swayAmp + windPush * (0.35 + 0.65 * flake.depth)) * frames;

  if (flake.x < -flake.size) flake.x = width + flake.size;
  else if (flake.x > width + flake.size) flake.x = -flake.size;

  // Far flakes settle on the back snowbank, near ones on the front one.
  const hill = flake.depth < 0.5 ? BACK_HILL : FRONT_HILL;
  if (flake.y > hillY(hill, flake.x / width, visHeight)) resetSnowflake(flake, bounds, true);
}

function drawSnowflakes(p: P5Like, flakes: Snowflake[], color: RgbColor): void {
  for (let layer = 0; layer < FLAKE_LAYERS; layer++) {
    p.fill(color[0], color[1], color[2], FLAKE_LAYER_ALPHA[layer]);
    for (const flake of flakes) {
      if (flake.layer === layer) p.ellipse(flake.x, flake.y, flake.size, flake.size);
    }
  }
}

// ---------------------------------------------------------------------------
// Flurry: the puff of snow a note shakes loose.
// ---------------------------------------------------------------------------

const FLURRY_MIN_FLAKES = 4;
const FLURRY_VELOCITY_FLAKES = 14;
const FLURRY_GRAVITY = 0.045;
const FLURRY_DRAG = 0.975;
const FLURRY_LIFE_MS = 2600;

interface FlurryFlake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  ageMs: number;
  lifeMs: number;
}

/**
 * One flake of a note's flurry — a Nature of Code ch. 4 particle: thrown up and
 * outward from an emitter point, pulled back by gravity, slowed by drag, and
 * faded out over its lifespan.
 */
function spawnFlurryFlake(x: number, y: number, velocity: number): FlurryFlake {
  const angle = randomRange(-Math.PI * 0.95, -Math.PI * 0.05);
  const speed = randomRange(0.8, 2.2) * (1 + velocity * 1.8);
  return {
    x: x + randomRange(-6, 6),
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: randomRange(2.2, 4.2) + velocity * 2.2,
    ageMs: 0,
    lifeMs: FLURRY_LIFE_MS * randomRange(0.6, 1),
  };
}

function updateFlurryFlake(
  flake: FlurryFlake,
  frames: number,
  deltaMs: number,
  windPush: number,
): void {
  flake.vy += FLURRY_GRAVITY * frames;
  const drag = Math.pow(FLURRY_DRAG, frames);
  flake.vx *= drag;
  flake.vy *= drag;
  flake.x += (flake.vx + windPush * 0.5) * frames;
  flake.y += flake.vy * frames;
  flake.ageMs += deltaMs;
}

function drawFlurry(p: P5Like, flakes: FlurryFlake[], color: RgbColor): void {
  for (const flake of flakes) {
    const fade = 1 - flake.ageMs / flake.lifeMs;
    p.fill(color[0], color[1], color[2], 255 * fade);
    p.ellipse(flake.x, flake.y, flake.size, flake.size);
  }
}

// ---------------------------------------------------------------------------
// Snowy pines and their fairy lights
// ---------------------------------------------------------------------------

/** Tiers of boughs stacked up a pine; each is a triangle overlapping the one below. */
const TREE_TIERS = 4;
/** How far up the foliage each tier starts, and how tall each tier is (fractions of foliage). */
const TIER_STEP = 0.22;
const TIER_HEIGHT = 0.34;
/** Fairy lights strung along each tier, bottom to top. */
const TIER_LIGHTS = [4, 3, 2, 1] as const;
/** The trunk's share of a tree's height. */
const TRUNK_RATIO = 0.1;
const TRUNK_COLOR: RgbColor = [58, 42, 38];

/** How long a note's glow takes to die away. */
const GLOW_FADE_MS = 1500;
/** Peak lean of a tree shaken by a full-velocity note, radians. */
const SHAKE_ANGLE = 0.055;
/** Angular rate of the shake, radians per ms. */
const SHAKE_RATE = 0.013;

type LightPalette = readonly RgbColor[];

const LIGHT_PALETTES: Record<string, LightPalette> = {
  classic: [
    [255, 72, 64],
    [72, 210, 110],
    [255, 204, 72],
    [88, 150, 255],
  ],
  warm: [
    [255, 222, 160],
    [255, 236, 196],
  ],
  redGreen: [
    [255, 64, 60],
    [60, 214, 104],
  ],
};

interface Tree {
  /** Horizontal position, 0..1 across the width. */
  xFrac: number;
  /** Total height (trunk + foliage), as a fraction of the visualization height. */
  heightFrac: number;
  /** Half the foliage's base width over its height. */
  spread: number;
  /** True for the nearer row, standing on the front snowbank. */
  front: boolean;
  /** Seeds this tree's fairy-light colors and phases. */
  seed: number;
  /** 0..1, set by a note and fading back to 0. */
  glow: number;
  /** ctx.elapsed when the tree was last struck; the shake oscillates from here. */
  struckAtMs: number;
}

/**
 * `count` pines spread evenly across the width with a little jitter, alternating
 * between the back and the front snowbank. Back trees come first so the array
 * is already in draw order within each row.
 */
function buildTrees(count: number): Tree[] {
  const trees: Tree[] = [];
  for (let i = 0; i < count; i++) {
    const front = i % 2 === 1;
    trees.push({
      xFrac: (i + 0.5 + randomRange(-0.28, 0.28)) / count,
      heightFrac: front ? randomRange(0.3, 0.42) : randomRange(0.2, 0.29),
      spread: randomRange(0.26, 0.34),
      front,
      seed: Math.floor(Math.random() * 10000),
      glow: 0,
      struckAtMs: 0,
    });
  }
  return trees;
}

function treeX(tree: Tree, width: number): number {
  return tree.xFrac * width;
}

/**
 * A tiered pine drawn around its base at the origin. The lit side takes the
 * snow color, the right half of each tier a cooler shade, and back-row trees
 * haze toward the horizon color. A struck tree brightens, shows a soft halo
 * (stacked translucent ellipses, no blur filter) and rocks on a damped sine
 * (Nature of Code ch. 3, Oscillation).
 */
function drawTree(
  p: P5Like,
  tree: Tree,
  bounds: Bounds,
  snow: RgbColor,
  haze: RgbColor,
  /** Null when the fairy lights are switched off. */
  palette: LightPalette | null,
  timeMs: number,
): void {
  const { width, visHeight } = bounds;
  const x = treeX(tree, width);
  const baseY = hillY(tree.front ? FRONT_HILL : BACK_HILL, tree.xFrac, visHeight);
  const height = tree.heightFrac * visHeight;
  const trunkH = height * TRUNK_RATIO;
  const foliageH = height - trunkH;
  const halfW = foliageH * tree.spread;
  const glow = tree.glow;
  const hazeMix = (tree.front ? 0.12 : 0.45) * (1 - glow);

  p.push();
  p.translate(x, baseY);
  if (glow > 0) p.rotate(SHAKE_ANGLE * glow * Math.sin((timeMs - tree.struckAtMs) * SHAKE_RATE));

  if (glow > 0) {
    const cy = -height * 0.5;
    p.fill(snow[0], snow[1], snow[2], 14 * glow);
    p.ellipse(0, cy, halfW * 3.4, height * 1.1);
    p.fill(snow[0], snow[1], snow[2], 22 * glow);
    p.ellipse(0, cy, halfW * 2.4, height * 0.85);
  }

  fillMix(p, TRUNK_COLOR, haze, hazeMix);
  p.rect(-halfW * 0.09, -trunkH - 2, halfW * 0.18, trunkH + 2);

  for (let tier = 0; tier < TREE_TIERS; tier++) {
    const bottom = -trunkH - foliageH * tier * TIER_STEP;
    const top = bottom - foliageH * TIER_HEIGHT;
    const w = halfW * (1 - tier * TIER_STEP);
    fillMix(p, snow, haze, hazeMix);
    p.triangle(-w, bottom, w, bottom, 0, top);
    fillMix(p, snow, haze, Math.min(1, hazeMix + 0.3 * (1 - glow)));
    p.triangle(0, bottom, w, bottom, 0, top);
  }

  if (!palette) {
    p.pop();
    return;
  }

  let light = 0;
  for (let tier = 0; tier < TREE_TIERS; tier++) {
    const w = halfW * (1 - tier * TIER_STEP);
    const tierBottom = -trunkH - foliageH * tier * TIER_STEP;
    const n = TIER_LIGHTS[tier];
    for (let k = 0; k < n; k++, light++) {
      const hash = tree.seed + light * 7;
      // Spread across the tier like a garland, sagging toward the middle.
      const u = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;
      const lx = u * w * 0.74 + (latticeValue(hash + 1) - 0.5) * w * 0.12;
      const ly = tierBottom - foliageH * (0.035 + 0.035 * u * u);
      const color = palette[Math.floor(latticeValue(hash + 2) * palette.length) % palette.length];
      const pulse =
        0.5 + 0.5 * Math.sin(timeMs * (0.0016 + latticeValue(hash + 3) * 0.0022) + hash);
      const brightness = Math.min(1, 0.6 + 0.4 * pulse + glow * 0.6);
      const size = Math.max(3, height * 0.034) * (1 + glow * 0.7);
      p.fill(color[0], color[1], color[2], 90 * brightness);
      p.ellipse(lx, ly, size * 2.6, size * 2.6);
      p.fill(color[0], color[1], color[2], 255 * brightness);
      p.ellipse(lx, ly, size, size);
    }
  }

  p.pop();
}

/**
 * A snowfall on a Christmas night: a starry gradient sky, snow drifting down
 * on the wind, and snowy pines strung with fairy lights on rolling snowbanks.
 * A note shakes a flurry loose at its key's column and lights up the nearest
 * tree.
 */
export class SnowfallScene implements Scene {
  readonly id = 'snowfall';
  readonly label = 'Snowfall';
  readonly params: ParamSpec[] = [
    {
      key: 'snowCount',
      label: 'Snow Density',
      type: 'range',
      default: DEFAULT_SNOW_COUNT,
      min: 50,
      max: 600,
      step: 10,
    },
    {
      key: 'treeCount',
      label: 'Tree Count',
      type: 'range',
      default: DEFAULT_TREE_COUNT,
      min: 3,
      max: 16,
      step: 1,
    },
    {
      key: 'starCount',
      label: 'Star Count',
      type: 'range',
      default: DEFAULT_STAR_COUNT,
      min: 0,
      max: MAX_STARS,
      step: 10,
    },
    {
      key: 'snowSpeed',
      label: 'Snow Speed',
      type: 'range',
      default: DEFAULT_SNOW_SPEED,
      min: 0.25,
      max: 3,
      step: 0.25,
    },
    {
      key: 'wind',
      label: 'Wind',
      type: 'range',
      default: DEFAULT_WIND,
      min: 0,
      max: 2,
      step: 0.1,
    },
    { key: 'skyTop', label: 'Sky Color', type: 'color', default: DEFAULT_SKY_TOP },
    { key: 'skyHorizon', label: 'Horizon Color', type: 'color', default: DEFAULT_SKY_HORIZON },
    { key: 'snowColor', label: 'Snow Color', type: 'color', default: DEFAULT_SNOW_COLOR },
    {
      key: 'lightPalette',
      label: 'Fairy Lights',
      type: 'select',
      default: DEFAULT_LIGHT_PALETTE,
      options: [
        { value: 'classic', label: 'Classic Multicolor' },
        { value: 'warm', label: 'Warm White' },
        { value: 'redGreen', label: 'Red & Green' },
        { value: LIGHTS_OFF, label: 'Off' },
      ],
    },
  ];

  private flakes: Snowflake[] = [];
  private flurry: FlurryFlake[] = [];
  private trees: Tree[] = [];

  setup(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const snowCount = Number(ctx.params.snowCount ?? DEFAULT_SNOW_COUNT);
    this.flakes = Array.from({ length: snowCount }, () => spawnSnowflake(bounds));
    this.flurry = [];
    this.trees = buildTrees(Number(ctx.params.treeCount ?? DEFAULT_TREE_COUNT));
  }

  update(ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const deltaMs = Math.min(Math.max(ctx.deltaTime, 0), MAX_FRAME_MS);
    const frames = deltaMs / FRAME_MS;
    const speedScale = Number(ctx.params.snowSpeed ?? DEFAULT_SNOW_SPEED);
    const windPush = windAt(ctx.elapsed) * WIND_MAX_PUSH * Number(ctx.params.wind ?? DEFAULT_WIND);

    const snowCount = Number(ctx.params.snowCount ?? DEFAULT_SNOW_COUNT);
    resizePopulation(this.flakes, snowCount, () => spawnSnowflake(bounds));
    for (const flake of this.flakes) updateSnowflake(flake, bounds, frames, speedScale, windPush);

    for (const flake of this.flurry) updateFlurryFlake(flake, frames, deltaMs, windPush);
    removeInPlace(this.flurry, (flake) => flake.ageMs >= flake.lifeMs);

    // An even spread depends on the count, so a new count replants the row.
    const treeCount = Number(ctx.params.treeCount ?? DEFAULT_TREE_COUNT);
    if (this.trees.length !== treeCount) this.trees = buildTrees(treeCount);
    for (const tree of this.trees) {
      if (tree.glow > 0) tree.glow = Math.max(0, tree.glow - deltaMs / GLOW_FADE_MS);
    }
  }

  draw(ctx: SceneContext): void {
    const { p } = ctx;
    const bounds = boundsOf(ctx);
    const skyTop = hexToRgb(String(ctx.params.skyTop ?? DEFAULT_SKY_TOP), DEFAULT_SKY_TOP);
    const horizon = hexToRgb(
      String(ctx.params.skyHorizon ?? DEFAULT_SKY_HORIZON),
      DEFAULT_SKY_HORIZON,
    );
    const snow = hexToRgb(String(ctx.params.snowColor ?? DEFAULT_SNOW_COLOR), DEFAULT_SNOW_COLOR);
    const paletteKey = String(ctx.params.lightPalette ?? DEFAULT_LIGHT_PALETTE);
    const palette =
      paletteKey === LIGHTS_OFF
        ? null
        : (LIGHT_PALETTES[paletteKey] ?? LIGHT_PALETTES[DEFAULT_LIGHT_PALETTE]);
    const starCount = Number(ctx.params.starCount ?? DEFAULT_STAR_COUNT);

    p.push();
    p.noStroke();
    drawSkyGradient(p, bounds, skyTop, horizon);
    drawStars(p, bounds, starCount, ctx.elapsed);

    fillMix(p, snow, horizon, 0.5);
    drawHill(p, BACK_HILL, bounds);
    for (const tree of this.trees) {
      if (!tree.front) drawTree(p, tree, bounds, snow, horizon, palette, ctx.elapsed);
    }
    fillMix(p, snow, horizon, 0.14);
    drawHill(p, FRONT_HILL, bounds);
    for (const tree of this.trees) {
      if (tree.front) drawTree(p, tree, bounds, snow, horizon, palette, ctx.elapsed);
    }

    // Crystals sit in front of the landscape but behind the snow, so the
    // snowfall and each note's flurry drift across them.
    ctx.drawCrystals();

    p.noStroke();
    drawSnowflakes(p, this.flakes, snow);
    drawFlurry(p, this.flurry, snow);
    p.pop();
  }

  onNoteOn(event: NoteEvent, ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const { x } = keyPosition(event.note, bounds.width, bounds.visHeight);

    let nearest: Tree | null = null;
    let nearestDist = Infinity;
    for (const tree of this.trees) {
      const dist = Math.abs(treeX(tree, bounds.width) - x);
      if (dist < nearestDist) {
        nearest = tree;
        nearestDist = dist;
      }
    }

    // The flurry leaves from the crown of the struck tree, at the key's column.
    let emitY = hillY(FRONT_HILL, x / bounds.width, bounds.visHeight);
    if (nearest) {
      // A tree already rocking keeps its rhythm; only a still one starts a new shake.
      if (nearest.glow <= 0) nearest.struckAtMs = ctx.elapsed;
      nearest.glow = Math.max(nearest.glow, 0.4 + 0.6 * event.velocity);
      const hill = nearest.front ? FRONT_HILL : BACK_HILL;
      emitY =
        hillY(hill, nearest.xFrac, bounds.visHeight) - nearest.heightFrac * bounds.visHeight * 0.7;
    }

    const count = Math.round(FLURRY_MIN_FLAKES + event.velocity * FLURRY_VELOCITY_FLAKES);
    for (let i = 0; i < count; i++) {
      pushBounded(this.flurry, spawnFlurryFlake(x, emitY, event.velocity), MAX_FLURRY);
    }
  }

  onNoteOff(): void {
    // Crystals fall on release inside the engine; the Scene has nothing to do.
  }

  teardown(): void {
    this.flakes = [];
    this.flurry = [];
    this.trees = [];
  }
}
