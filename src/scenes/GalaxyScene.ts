import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';
import type { P5Like } from '@/engine/types';
import { keyColumnX } from '@/engine/keyboardGeometry';

type RgbColor = readonly [number, number, number];

/** The visualization area the galaxy fits inside — never the Chroma Key band. */
interface Bounds {
  width: number;
  visHeight: number;
}

const DEFAULT_STAR_COUNT = 1200;
const MIN_STAR_COUNT = 400;
const MAX_STAR_COUNT = 2000;
const DEFAULT_ROTATION_SPEED = 1;
const DEFAULT_TILT_DEG = 60;
const MAX_TILT_DEG = 75;
const DEFAULT_ARM_COUNT = '2';
const DEFAULT_CORE_COLOR = '#ffd9a0';
const DEFAULT_ARM_COLOR = '#9ec5ff';
const DEFAULT_NEBULA_COLOR = '#ff6fae';
const SPACE_COLOR: RgbColor = [5, 6, 14];
/** Field-star tints, as real stars spread by temperature: blue-white, white, warm. */
const FIELD_TINTS: RgbColor[] = [
  [170, 195, 255],
  [235, 238, 255],
  [255, 214, 170],
];
const FIELD_TINT_WEIGHTS = [0.35, 0.45, 0.2];

const TWO_PI = Math.PI * 2;

// Galaxy geometry. Lengths without a unit are in galaxy radii (R): the disc's
// in-plane radius, fitted to the visualization area every frame.
/** The disc's major axis sits a little off horizontal, like a photographed galaxy. */
const POSITION_ANGLE = -0.16;
const EDGE_PAD_PX = 6;
/** Room kept round the disc for a rim star's nebula, which may sit on the disc's edge. */
const NEBULA_MARGIN = 0.09;
const BULGE_SHARE = 0.2;
const BULGE_SIGMA = 0.11;
const BULGE_MAX = 0.34;
/** The bulge is a squashed sphere: its height is this share of its width. */
const BULGE_FLATTEN = 0.7;
const DISC_INNER = 0.1;
/** Spread of a disc star off its orbit, so arms read as clouds rather than threads. */
const DISC_JITTER = 0.015;
/** Pitch of the logarithmic spiral the arms trace, radians (~18°). */
const ARM_PITCH = 0.32;
/**
 * How close neighbouring orbits come to touching at an arm's crest, 0..1. Star
 * density there is 1 / (1 - ARM_CROWDING) times the average: 0.9 makes ~10x.
 */
const ARM_CROWDING = 0.9;

/** Orbit eccentricity giving `ARM_CROWDING` for `arms` arms; see the density-wave note below. */
function eccentricityFor(arms: number): number {
  return ARM_CROWDING / Math.sqrt(1 + (arms / Math.tan(ARM_PITCH)) ** 2);
}

/** Furthest a disc star's mean orbit sits, so its pinched orbit never leaves the disc. */
const DISC_OUTER = (1 - DISC_JITTER) / (1 + eccentricityFor(2));

// Orbital motion. The disc turns counter-clockwise on screen while its arms wind
// clockwise going out: trailing arms, as real spirals have.
const ROTATION_SENSE = -1;
/** Orbit rate at the disc's rim at Rotation Speed 1: one turn in 90 s. */
const RIM_OMEGA = TWO_PI / 90;
/** The arm pattern turns more slowly than its stars, so stars flow through the arms. */
const PATTERN_OMEGA = TWO_PI / 160;
/** Softens the flat rotation curve near the core so inner orbits stay readable. */
const CORE_SOFTENING = 0.15;
const BULGE_SPIN = 0.5;
/** A frame longer than this (a backgrounded tab) is not allowed to jump the galaxy. */
const MAX_FRAME_MS = 50;

// Drawing.
const TINT_LEVELS = 4;
const ALPHA_LEVELS = [60, 110, 170, 235];
const SIZE_LEVELS_PX = [1.4, 2.5];
const BIN_COUNT = TINT_LEVELS * ALPHA_LEVELS.length * SIZE_LEVELS_PX.length;
/** Share of stars that are bright giants, drawn at the larger size. */
const GIANT_SHARE = 0.07;
/** A dot is a round-capped stroke this long: a zero-length one may not draw at all. */
const DOT_NUDGE = 0.01;

// The background sky: a far layer of faint stars and a nearer one of brighter
// ones, each drifting slowly sideways at its own pace — a two-layer parallax, as
// the p5.js particle examples layer depth — plus a few bright beacon stars and
// the odd shooting star.
const FIELD_STAR_COUNT = 650;
const FIELD_NEAR_SHARE = 0.22;
const FIELD_ALPHA_LEVELS = [50, 100, 160, 225];
const FIELD_SIZES_PX = [1.2, 2];
/** Sideways drift of the far and near layers, px per second. */
const FIELD_DRIFT_PX_S = [1.5, 4];
const FIELD_BIN_COUNT = FIELD_TINTS.length * FIELD_ALPHA_LEVELS.length * FIELD_SIZES_PX.length;

const BEACON_COUNT = 10;
/** Half the length of a beacon's spikes at full twinkle, px; also its keep-out from the edges. */
const BEACON_SPIKE_PX = 9;
const BEACON_HALO_PX = 10;

/** One shooting star at most, every few seconds, crossing a sliver of the sky. */
const SHOOTING_GAP_MS = [4000, 10000];
const SHOOTING_LIFE_MS = 900;
/** How far a shooting star's head travels, as a share of the area's width. */
const SHOOTING_TRAVEL = 0.28;
const SHOOTING_TAIL = 0.07;
const SHOOTING_MAX_SLOPE = 0.35;
const SHOOTING_SEGMENTS = 6;

// Glows are stacks of faint ellipses. Many small alpha steps keep each layer's edge
// below what the eye picks out on a dark sky, so the stack reads as a smooth falloff.
const HAZE_LAYERS = Array.from({ length: 10 }, (_, i) => ({ reach: 1 - i * 0.085, alpha: 2 }));
// Radii stay under BULGE_MAX after the pulse, so the glow fits where the bulge does.
const CORE_GLOW_LAYERS = Array.from({ length: 32 }, (_, i) => {
  const t = i / 31;
  return { reach: 0.32 * Math.pow(1 - t, 2.2) + 0.012, alpha: 2.5 + 4 * t, whiten: 0.9 * t };
});
/** Soft blobs laid along each arm's crest, so an arm reads as a band of light. */
const ARM_GLOW_SAMPLES = 36;
const ARM_GLOW_INNER = 0.13;
// Wide layers only: a tight inner layer would show each sample as a separate bead.
const ARM_GLOW_LAYERS = [
  { reach: 1, alpha: 9 },
  { reach: 0.65, alpha: 12 },
];
/** Every this-many arm-glow samples, a faint pink star-forming knot sits on the arm. */
const ARM_KNOT_EVERY = 4;
const ARM_KNOT_ALPHA = 22;
const CORE_PULSE = 0.03;
const CORE_PULSE_PERIOD_MS = 7000;

// Star births (note-on).
const MAX_BIRTHS = 24;
/** Nearest the core a key's star is born, so the lowest key still lands on an arm. */
const BIRTH_INNER = 0.14;
const BIRTH_ATTACK_MS = 150;
/** After its key is released, a nebula fades out over this long. */
const BIRTH_FADE_MS = 3000;
const BIRTH_FLASH_MS = 350;
const BIRTH_BREATH_PERIOD_MS = 2400;
const NEBULA_BASE = 0.02;
const NEBULA_VELOCITY_SCALE = 0.04;
const NEBULA_BLOBS = 3;
/** Furthest a nebula blob's centre sits from its star, in nebula radii. */
const NEBULA_BLOB_SPREAD = 0.5;
const NEBULA_LAYERS = [
  { reach: 1, alpha: 24 },
  { reach: 0.7, alpha: 36 },
  { reach: 0.45, alpha: 52 },
];
const BIRTH_STAR_BASE_PX = 2.2;
const BIRTH_STAR_VELOCITY_PX = 2.6;
const BIRTH_FLASH_SCALE = 1.5;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** A standard normal sample (Box–Muller). */
function gaussian(): number {
  const u = Math.max(Math.random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * Math.random());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function boundsOf(ctx: SceneContext): Bounds {
  return { width: ctx.width, visHeight: ctx.height - ctx.chromaKeyHeight };
}

/** Parses a `#RRGGBB` hex color; falls back to `fallback` when malformed. */
function hexToRgb(hex: string, fallback: string): RgbColor {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hexToRgb(fallback, DEFAULT_CORE_COLOR);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function mix(a: RgbColor, b: RgbColor, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const WHITE: RgbColor = [255, 255, 255];

/** Grows or shrinks `items` in place to match `targetLength`, spawning new entries as needed. */
function resizePopulation<T>(items: T[], targetLength: number, spawn: () => T): void {
  while (items.length < targetLength) items.push(spawn());
  if (items.length > targetLength) items.length = targetLength;
}

/**
 * Orbit rate at mean radius `a`: a softened flat rotation curve, so inner stars
 * lap outer ones. Angular velocity as Nature of Code ch. 3 (Oscillation) sets
 * it — an angle advanced each frame and turned to x/y through polar coordinates.
 */
function omegaAt(a: number): number {
  return (RIM_OMEGA * (1 + CORE_SOFTENING)) / (a + CORE_SOFTENING);
}

/** Angle the arm spine reaches at mean radius `a`, in the pattern's own frame. */
function spiralPhase(a: number): number {
  return Math.log(a / DISC_INNER) / Math.tan(ARM_PITCH);
}

/** The galaxy's frame for one draw: its size, centre, tilt and arm shape. */
interface Frame {
  R: number;
  cx: number;
  cy: number;
  cosTilt: number;
  sinTilt: number;
  arms: number;
  eccentricity: number;
  /** Orbit phase (see orbitPhase) at which orbits crowd hardest: an arm's crest. */
  crestPhase: number;
  patternAngle: number;
}

const COS_PA = Math.cos(POSITION_ANGLE);
const SIN_PA = Math.sin(POSITION_ANGLE);

/** Fits the tilted disc, its bulge and a rim nebula's margin inside the visualization area. */
function fitRadius({ width, visHeight }: Bounds, cosTilt: number): number {
  const halfX = Math.hypot(COS_PA, cosTilt * SIN_PA);
  const halfY = Math.max(Math.hypot(SIN_PA, cosTilt * COS_PA), BULGE_MAX);
  const rx = (width / 2 - EDGE_PAD_PX) / (halfX + NEBULA_MARGIN);
  const ry = (visHeight / 2 - EDGE_PAD_PX) / (halfY + NEBULA_MARGIN);
  return Math.max(0, Math.min(rx, ry));
}

function frameOf(ctx: SceneContext, patternAngle: number): Frame {
  const bounds = boundsOf(ctx);
  const tiltDeg = clamp(Number(ctx.params.tilt ?? DEFAULT_TILT_DEG), 0, MAX_TILT_DEG);
  const tilt = (tiltDeg * Math.PI) / 180;
  const cosTilt = Math.cos(tilt);
  const arms = clamp(Math.round(Number(ctx.params.armCount ?? DEFAULT_ARM_COUNT)), 2, 4) || 2;
  return {
    R: fitRadius(bounds, cosTilt),
    cx: bounds.width / 2,
    cy: bounds.visHeight / 2,
    cosTilt,
    sinTilt: Math.sin(tilt),
    arms,
    eccentricity: eccentricityFor(arms),
    crestPhase: Math.PI + Math.atan(arms / Math.tan(ARM_PITCH)),
    patternAngle,
  };
}

/** Where `a`/`psi` stands against the arm pattern: 0..2π per arm. */
function orbitPhase(f: Frame, a: number, psi: number): number {
  return f.arms * (psi - f.patternAngle - spiralPhase(a));
}

/**
 * The density-wave galaxy. Every disc star circles at its own rate on an orbit
 * pinched into `arms` lobes, and the pinch's orientation turns with radius along a
 * logarithmic spiral. Neighbouring orbits bunch where the pinches line up, and
 * that crowding *is* the arm — so arms hold their shape while stars stream
 * through them, instead of winding up the way arms of fixed stars would.
 *
 * Neither reference covers this: it is the Lin–Shu density-wave picture, drawn
 * the way galaxy renderers draw it with offset ellipses, generalised to m lobes
 * as r = a·(1 + e·cos(m·(ψ − φ(a)))). Orbits crowd where dr/da is least,
 * 1 − e·√(1 + (m / tan pitch)²), which `eccentricityFor` holds at 1 − ARM_CROWDING.
 */
function orbitRadius(f: Frame, a: number, psi: number): number {
  return a * (1 + f.eccentricity * Math.cos(orbitPhase(f, a, psi)));
}

/** 1 on an arm's crest, 0 midway between arms. */
function armnessAt(f: Frame, a: number, psi: number): number {
  return 0.5 * (1 + Math.cos(orbitPhase(f, a, psi) - f.crestPhase));
}

/** A tilted, slightly rotated projection of an in-plane point (x, y, height z), in R. */
function projectX(f: Frame, x: number, y: number, z: number): number {
  const ty = y * f.cosTilt - z * f.sinTilt;
  return f.cx + f.R * (x * COS_PA - ty * SIN_PA);
}

function projectY(f: Frame, x: number, y: number, z: number): number {
  const ty = y * f.cosTilt - z * f.sinTilt;
  return f.cy + f.R * (x * SIN_PA + ty * COS_PA);
}

interface DiscStar {
  /** Mean orbit radius, R. */
  a: number;
  /** Mean orbit angle, radians; advances at omegaAt(a). */
  psi: number;
  jitter: number;
  /** Intrinsic brightness, 0..1. */
  base: number;
  giant: boolean;
}

/** Disc stars thin out toward the rim, as an exponential disc does, but never vanish. */
function spawnDiscStar(): DiscStar {
  const a = DISC_INNER + (DISC_OUTER - DISC_INNER) * Math.pow(Math.random(), 0.7);
  return {
    a,
    psi: randomRange(0, TWO_PI),
    jitter: randomRange(-DISC_JITTER, DISC_JITTER),
    base: randomRange(0.55, 1) * (1 - 0.35 * a),
    giant: Math.random() < GIANT_SHARE,
  };
}

interface BulgeStar {
  /** In-plane radius, R. */
  rad: number;
  ang: number;
  /** Height above the disc plane, R. */
  z: number;
  base: number;
  giant: boolean;
}

/** A Gaussian cloud of old stars, clipped to a sphere of BULGE_MAX so it never spills. */
function spawnBulgeStar(): BulgeStar {
  const rad = Math.abs(gaussian()) * BULGE_SIGMA;
  const z = gaussian() * BULGE_SIGMA * BULGE_FLATTEN;
  const scale = Math.min(1, BULGE_MAX / Math.max(Math.hypot(rad, z), 1e-9));
  const reach = Math.hypot(rad, z) * scale;
  return {
    rad: rad * scale,
    ang: randomRange(0, TWO_PI),
    z: z * scale,
    base: 0.55 + 0.45 * (1 - reach / BULGE_MAX),
    giant: Math.random() < GIANT_SHARE,
  };
}

interface FieldStar {
  /** Position as a share of the visualization area, so a resize keeps the sky. */
  fx: number;
  fy: number;
  phase: number;
  /** Twinkle rate, radians per ms. */
  rate: number;
  /** 0 = far layer (small, faint, slow), 1 = near layer. */
  layer: number;
  tint: number;
  /** Intrinsic brightness, 0..1. */
  base: number;
}

function pickTint(): number {
  let roll = Math.random();
  for (let i = 0; i < FIELD_TINT_WEIGHTS.length; i++) {
    roll -= FIELD_TINT_WEIGHTS[i];
    if (roll < 0) return i;
  }
  return FIELD_TINT_WEIGHTS.length - 1;
}

function spawnFieldStar(): FieldStar {
  const layer = Math.random() < FIELD_NEAR_SHARE ? 1 : 0;
  return {
    fx: Math.random(),
    fy: Math.random(),
    phase: randomRange(0, TWO_PI),
    rate: (TWO_PI * randomRange(0.15, 1.1)) / 1000,
    layer,
    tint: pickTint(),
    base: layer === 1 ? randomRange(0.6, 1) : randomRange(0.35, 0.8),
  };
}

/** A bright foreground star with a soft halo and spikes that swell as it twinkles. */
interface Beacon {
  fx: number;
  fy: number;
  phase: number;
  rate: number;
  tint: number;
}

function spawnBeacon(): Beacon {
  return {
    fx: Math.random(),
    fy: Math.random(),
    phase: randomRange(0, TWO_PI),
    rate: (TWO_PI * randomRange(0.15, 0.4)) / 1000,
    tint: pickTint(),
  };
}

interface ShootingStar {
  /** Start, as shares of the area's width and height. */
  fx: number;
  fy: number;
  /** Direction: ±1 horizontally, and a gentle downward slope. */
  dir: number;
  slope: number;
  bornAt: number;
}

function spawnShootingStar(elapsed: number): ShootingStar {
  const dir = Math.random() < 0.5 ? -1 : 1;
  return {
    fx: dir > 0 ? randomRange(0.05, 0.6) : randomRange(0.4, 0.95),
    fy: randomRange(0.04, 0.35),
    dir,
    slope: randomRange(0.08, SHOOTING_MAX_SLOPE),
    bornAt: elapsed,
  };
}

/** A young star lit by a key, wrapped in the nebula it was born from. */
interface StarBirth {
  note: number;
  a: number;
  psi: number;
  velocity: number;
  bornAt: number;
  /** Elapsed ms its key was released, or -1 while held. */
  releasedAt: number;
  /** Per blob: dx, dy in nebula radii, then its size in nebula radii. */
  blobs: Float32Array;
}

/** How strongly a birth's nebula glows now, 0..1; 0 once it has faded after release. */
function birthGlow(birth: StarBirth, elapsed: number): number {
  const attack = clamp((elapsed - birth.bornAt) / BIRTH_ATTACK_MS, 0, 1);
  if (birth.releasedAt < 0) {
    const breath = Math.sin(((elapsed - birth.bornAt) * TWO_PI) / BIRTH_BREATH_PERIOD_MS);
    return attack * (0.92 + 0.08 * breath);
  }
  return attack * clamp(1 - (elapsed - birth.releasedAt) / BIRTH_FADE_MS, 0, 1);
}

function birthFaded(birth: StarBirth, elapsed: number): boolean {
  return birth.releasedAt >= 0 && elapsed - birth.releasedAt >= BIRTH_FADE_MS;
}

function spawnBlobs(): Float32Array {
  const blobs = new Float32Array(NEBULA_BLOBS * 3);
  for (let i = 0; i < NEBULA_BLOBS; i++) {
    const angle = randomRange(0, TWO_PI);
    const dist = i === 0 ? 0 : randomRange(0.2, NEBULA_BLOB_SPREAD);
    blobs[i * 3] = Math.cos(angle) * dist;
    blobs[i * 3 + 1] = Math.sin(angle) * dist;
    blobs[i * 3 + 2] = i === 0 ? 1 : randomRange(0.55, 0.85);
  }
  return blobs;
}

/** Where an arm's crest sits at mean radius `a`, for arm `k`: its orbit angle. */
function crestAngle(f: Frame, a: number, k: number): number {
  return (f.crestPhase + TWO_PI * k) / f.arms + f.patternAngle + spiralPhase(a);
}

/**
 * Soft light along every arm's crest, brightest mid-arm and fading to both ends,
 * with a pink star-forming knot every few samples. Glow is stacked faint ellipses
 * (no blur filter, which would blow the frame budget), as Underwater's fish glow.
 */
function drawArmGlow(p: P5Like, f: Frame, palette: Palette): void {
  const [ar, ag, ab] = palette.arm;
  const [nr, ng, nb] = palette.nebula;
  p.noStroke();
  for (let k = 0; k < f.arms; k++) {
    for (let i = 0; i < ARM_GLOW_SAMPLES; i++) {
      const t = i / (ARM_GLOW_SAMPLES - 1);
      const a = ARM_GLOW_INNER + t * (DISC_OUTER - ARM_GLOW_INNER);
      const psi = crestAngle(f, a, k);
      const r = orbitRadius(f, a, psi);
      const x = projectX(f, r * Math.cos(psi), r * Math.sin(psi), 0);
      const y = projectY(f, r * Math.cos(psi), r * Math.sin(psi), 0);
      const fade = Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05))) * (1 - 0.35 * t);
      const size = f.R * (0.035 + 0.05 * a);
      for (const layer of ARM_GLOW_LAYERS) {
        p.fill(ar, ag, ab, layer.alpha * fade);
        const d = 2 * size * layer.reach;
        p.ellipse(x, y, d, d * f.cosTilt);
      }
      if (i % ARM_KNOT_EVERY === 2) {
        p.fill(nr, ng, nb, ARM_KNOT_ALPHA * fade);
        const d = size * 0.5;
        p.ellipse(x, y, d, d * f.cosTilt);
      }
    }
  }
}

/** Strokes the dots `order[start..end)` as one shape: one style, one pass. */
function strokeDots(
  p: P5Like,
  xs: Float32Array,
  ys: Float32Array,
  order: Uint16Array,
  start: number,
  end: number,
): void {
  p.beginShape();
  for (let i = start; i < end; i++) {
    const k = order[i];
    p.vertex(xs[k], ys[k], true);
    p.vertex(xs[k] + DOT_NUDGE, ys[k]);
  }
  p.endShape();
}

/** The galaxy's palette, re-derived only when a color param changes. */
interface Palette {
  key: string;
  core: RgbColor;
  arm: RgbColor;
  nebula: RgbColor;
  /** Star tints from core (0) to arm (TINT_LEVELS - 1). */
  tints: RgbColor[];
  haze: RgbColor;
  coreGlow: RgbColor[];
  youngStar: RgbColor;
}

function buildPalette(coreHex: string, armHex: string, nebulaHex: string): Palette {
  const core = hexToRgb(coreHex, DEFAULT_CORE_COLOR);
  const arm = hexToRgb(armHex, DEFAULT_ARM_COLOR);
  const nebula = hexToRgb(nebulaHex, DEFAULT_NEBULA_COLOR);
  return {
    key: `${coreHex}|${armHex}|${nebulaHex}`,
    core,
    arm,
    nebula,
    tints: Array.from({ length: TINT_LEVELS }, (_, i) => mix(core, arm, i / (TINT_LEVELS - 1))),
    haze: mix(arm, core, 0.5),
    coreGlow: CORE_GLOW_LAYERS.map((layer) => mix(core, WHITE, layer.whiten)),
    youngStar: mix(arm, WHITE, 0.6),
  };
}

function binOf(tint: number, alpha: number, giant: boolean): number {
  const t = clamp(Math.floor(tint * TINT_LEVELS), 0, TINT_LEVELS - 1);
  const al = clamp(Math.floor(alpha * ALPHA_LEVELS.length), 0, ALPHA_LEVELS.length - 1);
  return (t * ALPHA_LEVELS.length + al) * SIZE_LEVELS_PX.length + (giant ? 1 : 0);
}

/**
 * A tilted spiral galaxy: a warm bulge of old stars, blue-white density-wave arms
 * of young ones, and a twinkling field of foreground stars. Each key lights a new
 * star on an arm — low keys near the core, high keys out at the rim — in a pink
 * star-forming nebula that glows while the key is held and fades on release,
 * after which the star stays on as a member of the disc.
 */
export class GalaxyScene implements Scene {
  readonly id = 'galaxy';
  readonly label = 'Spiral Galaxy';
  readonly params: ParamSpec[] = [
    {
      key: 'starCount',
      label: 'Star Count',
      type: 'range',
      default: DEFAULT_STAR_COUNT,
      min: MIN_STAR_COUNT,
      max: MAX_STAR_COUNT,
      step: 100,
    },
    {
      key: 'armCount',
      label: 'Arms',
      type: 'select',
      default: DEFAULT_ARM_COUNT,
      options: [
        { value: '2', label: '2 (grand design)' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
      ],
    },
    {
      key: 'rotationSpeed',
      label: 'Rotation Speed',
      type: 'range',
      default: DEFAULT_ROTATION_SPEED,
      min: 0,
      max: 3,
      step: 0.25,
    },
    {
      key: 'tilt',
      label: 'Tilt',
      type: 'range',
      default: DEFAULT_TILT_DEG,
      min: 0,
      max: MAX_TILT_DEG,
      step: 5,
    },
    { key: 'coreColor', label: 'Core Color', type: 'color', default: DEFAULT_CORE_COLOR },
    { key: 'armColor', label: 'Arm Color', type: 'color', default: DEFAULT_ARM_COLOR },
    { key: 'nebulaColor', label: 'Nebula Color', type: 'color', default: DEFAULT_NEBULA_COLOR },
  ];

  private disc: DiscStar[] = [];
  private bulge: BulgeStar[] = [];
  private field: FieldStar[] = [];
  private beacons: Beacon[] = [];
  private shooting: ShootingStar | null = null;
  private nextShootingAt = 0;
  private births: StarBirth[] = [];
  private patternAngle = 0;
  private palette: Palette | null = null;

  // Per-frame scratch, sized once for the largest galaxy so drawing allocates nothing.
  private readonly xs = new Float32Array(MAX_STAR_COUNT);
  private readonly ys = new Float32Array(MAX_STAR_COUNT);
  private readonly bins = new Uint8Array(MAX_STAR_COUNT);
  private readonly order = new Uint16Array(MAX_STAR_COUNT);
  private readonly binStart = new Uint16Array(BIN_COUNT + 1);
  private readonly binFill = new Uint16Array(BIN_COUNT);

  setup(ctx: SceneContext): void {
    const { discCount, bulgeCount } = this.populationOf(ctx);
    this.disc = Array.from({ length: discCount }, spawnDiscStar);
    this.bulge = Array.from({ length: bulgeCount }, spawnBulgeStar);
    this.field = Array.from({ length: FIELD_STAR_COUNT }, spawnFieldStar);
    this.beacons = Array.from({ length: BEACON_COUNT }, spawnBeacon);
    this.shooting = null;
    this.nextShootingAt = randomRange(SHOOTING_GAP_MS[0], SHOOTING_GAP_MS[1]);
    this.births = [];
    this.patternAngle = 0;
    this.palette = null;
  }

  update(ctx: SceneContext): void {
    const { discCount, bulgeCount } = this.populationOf(ctx);
    resizePopulation(this.disc, discCount, spawnDiscStar);
    resizePopulation(this.bulge, bulgeCount, spawnBulgeStar);

    if (this.shooting && ctx.elapsed - this.shooting.bornAt >= SHOOTING_LIFE_MS) {
      this.shooting = null;
      this.nextShootingAt = ctx.elapsed + randomRange(SHOOTING_GAP_MS[0], SHOOTING_GAP_MS[1]);
    }
    if (!this.shooting && ctx.elapsed >= this.nextShootingAt) {
      this.shooting = spawnShootingStar(ctx.elapsed);
    }

    const speed = clamp(Number(ctx.params.rotationSpeed ?? DEFAULT_ROTATION_SPEED), 0, 3);
    const seconds = clamp(ctx.deltaTime, 0, MAX_FRAME_MS) / 1000;
    const turn = ROTATION_SENSE * speed * seconds;

    this.patternAngle = (this.patternAngle + PATTERN_OMEGA * turn) % TWO_PI;
    for (const star of this.disc) star.psi = (star.psi + omegaAt(star.a) * turn) % TWO_PI;
    for (const star of this.bulge) {
      star.ang = (star.ang + omegaAt(star.rad) * BULGE_SPIN * turn) % TWO_PI;
    }

    // Retire faded births in place: each one's star joins the disc for good.
    let kept = 0;
    for (const birth of this.births) {
      birth.psi = (birth.psi + omegaAt(birth.a) * turn) % TWO_PI;
      if (birthFaded(birth, ctx.elapsed)) this.settle(birth);
      else this.births[kept++] = birth;
    }
    this.births.length = kept;
  }

  draw(ctx: SceneContext): void {
    const { p } = ctx;
    const bounds = boundsOf(ctx);
    const f = frameOf(ctx, this.patternAngle);
    const palette = this.paletteOf(ctx);

    p.push();
    p.noStroke();
    p.fill(...SPACE_COLOR);
    p.rect(0, 0, bounds.width, bounds.visHeight);

    p.strokeCap('round');
    this.drawFieldStars(p, bounds, ctx.elapsed);
    this.drawBeacons(p, bounds, ctx.elapsed);
    this.drawShootingStar(p, bounds, ctx.elapsed);

    // The Crystals stand behind the galaxy: the disc is the subject, and its haze
    // is faint enough that a Crystal still shines through it.
    ctx.drawCrystals();

    this.drawGlow(p, f, palette, ctx.elapsed);
    drawArmGlow(p, f, palette);
    this.drawStars(p, f, palette);
    for (const birth of this.births) this.drawBirth(p, f, palette, birth, ctx.elapsed);
    p.pop();
  }

  onNoteOn(event: NoteEvent, ctx: SceneContext): void {
    const bounds = boundsOf(ctx);
    const f = frameOf(ctx, this.patternAngle);
    const keyX = keyColumnX(event.note, bounds.width);
    const share = bounds.width > 0 ? clamp(keyX / bounds.width, 0, 1) : 0;
    const a = BIRTH_INNER + share * (DISC_OUTER - BIRTH_INNER);

    // Of the arms' crests at this radius, take the one nearest the key's column.
    let psi = 0;
    let nearest = Infinity;
    for (let k = 0; k < f.arms; k++) {
      const candidate = crestAngle(f, a, k);
      const r = orbitRadius(f, a, candidate);
      const x = projectX(f, r * Math.cos(candidate), r * Math.sin(candidate), 0);
      if (Math.abs(x - keyX) < nearest) {
        nearest = Math.abs(x - keyX);
        psi = candidate;
      }
    }

    if (this.births.length >= MAX_BIRTHS) {
      const oldest = this.births.shift();
      if (oldest) this.settle(oldest);
    }
    this.births.push({
      note: event.note,
      a,
      psi: psi % TWO_PI,
      velocity: clamp(event.velocity, 0, 1),
      bornAt: ctx.elapsed,
      releasedAt: -1,
      blobs: spawnBlobs(),
    });
  }

  onNoteOff(event: NoteEvent, ctx: SceneContext): void {
    for (const birth of this.births) {
      if (birth.note === event.note && birth.releasedAt < 0) birth.releasedAt = ctx.elapsed;
    }
  }

  teardown(): void {
    this.disc = [];
    this.bulge = [];
    this.field = [];
    this.beacons = [];
    this.shooting = null;
    this.births = [];
    this.palette = null;
  }

  private populationOf(ctx: SceneContext): { discCount: number; bulgeCount: number } {
    const total = clamp(
      Math.round(Number(ctx.params.starCount ?? DEFAULT_STAR_COUNT)),
      MIN_STAR_COUNT,
      MAX_STAR_COUNT,
    );
    const bulgeCount = Math.round(total * BULGE_SHARE);
    return { discCount: total - bulgeCount, bulgeCount };
  }

  private paletteOf(ctx: SceneContext): Palette {
    const core = String(ctx.params.coreColor ?? DEFAULT_CORE_COLOR);
    const arm = String(ctx.params.armColor ?? DEFAULT_ARM_COLOR);
    const nebula = String(ctx.params.nebulaColor ?? DEFAULT_NEBULA_COLOR);
    if (!this.palette || this.palette.key !== `${core}|${arm}|${nebula}`) {
      this.palette = buildPalette(core, arm, nebula);
    }
    return this.palette;
  }

  /** A born star becomes an ordinary young disc star, taking a random one's place. */
  private settle(birth: StarBirth): void {
    if (this.disc.length === 0) return;
    const star = this.disc[Math.floor(Math.random() * this.disc.length)];
    star.a = birth.a;
    star.psi = birth.psi;
    star.jitter = 0;
    star.base = 0.95;
    star.giant = true;
  }

  /**
   * The two drifting layers, binned by tint × twinkle brightness × size so each
   * bin strokes as one shape. Near stars twinkle deeper than far ones.
   */
  private drawFieldStars(p: P5Like, { width, visHeight }: Bounds, elapsed: number): void {
    const seconds = elapsed / 1000;
    for (let bin = 0; bin < FIELD_BIN_COUNT; bin++) {
      const size = bin % FIELD_SIZES_PX.length;
      const alpha = Math.floor(bin / FIELD_SIZES_PX.length) % FIELD_ALPHA_LEVELS.length;
      const tint = Math.floor(bin / (FIELD_SIZES_PX.length * FIELD_ALPHA_LEVELS.length));
      let started = false;
      for (const star of this.field) {
        if (star.layer !== size || star.tint !== tint) continue;
        const twinkle = 0.5 + 0.5 * Math.sin(star.phase + elapsed * star.rate);
        const depth = star.layer === 1 ? 0.75 : 0.45;
        const brightness = star.base * (1 - depth + depth * twinkle);
        const level = Math.min(
          Math.floor(brightness * FIELD_ALPHA_LEVELS.length),
          FIELD_ALPHA_LEVELS.length - 1,
        );
        if (level !== alpha) continue;
        if (!started) {
          const [r, g, b] = FIELD_TINTS[tint];
          p.stroke(r, g, b, FIELD_ALPHA_LEVELS[alpha]);
          p.strokeWeight(FIELD_SIZES_PX[size]);
          p.beginShape();
          started = true;
        }
        const drift = seconds * FIELD_DRIFT_PX_S[star.layer];
        const x = (((star.fx * width + drift) % width) + width) % width;
        const y = 1 + star.fy * (visHeight - 3);
        p.vertex(x, y, true);
        p.vertex(x + DOT_NUDGE, y);
      }
      if (started) p.endShape();
    }
  }

  /** A few bright stars that slowly swell and ebb, their spikes growing as they brighten. */
  private drawBeacons(p: P5Like, { width, visHeight }: Bounds, elapsed: number): void {
    const keepOut = BEACON_SPIKE_PX + 2;
    if (visHeight <= 2 * keepOut || width <= 2 * keepOut) return;
    for (const beacon of this.beacons) {
      const x = keepOut + beacon.fx * (width - 2 * keepOut);
      const y = keepOut + beacon.fy * (visHeight - 2 * keepOut);
      const glow = 0.55 + 0.45 * Math.sin(beacon.phase + elapsed * beacon.rate);
      const [r, g, b] = FIELD_TINTS[beacon.tint];
      p.noStroke();
      p.fill(r, g, b, 26 * glow);
      p.ellipse(x, y, BEACON_HALO_PX * 2 * glow, BEACON_HALO_PX * 2 * glow);
      p.stroke(r, g, b, 120 * glow);
      p.strokeWeight(1);
      const spike = BEACON_SPIKE_PX * glow;
      p.line(x - spike, y, x + spike, y);
      p.line(x, y - spike, x, y + spike);
      p.stroke(255, 255, 255, 140 + 115 * glow);
      p.strokeWeight(2.2);
      p.line(x, y, x + DOT_NUDGE, y);
    }
  }

  /**
   * A short streak whose tail fades along its length, as the p5.js particle
   * examples fade a trail: a head moving at constant speed, older points dimmer.
   */
  private drawShootingStar(p: P5Like, { width, visHeight }: Bounds, elapsed: number): void {
    const star = this.shooting;
    if (!star) return;
    const t = clamp((elapsed - star.bornAt) / SHOOTING_LIFE_MS, 0, 1);
    const fade = Math.sin(Math.PI * t);
    const travel = SHOOTING_TRAVEL * width;
    const tail = SHOOTING_TAIL * width;
    const startX = star.fx * width;
    const startY = star.fy * visHeight;
    // Never past the floor, with room for half a stroke.
    const floor = visHeight - 2;
    p.strokeWeight(1.4);
    for (let i = 0; i < SHOOTING_SEGMENTS; i++) {
      const d0 = t * travel - (tail * i) / SHOOTING_SEGMENTS;
      const d1 = t * travel - (tail * (i + 1)) / SHOOTING_SEGMENTS;
      if (d0 <= 0) break;
      const from = Math.max(d1, 0);
      const x0 = startX + star.dir * d0;
      const y0 = startY + star.slope * d0;
      const x1 = startX + star.dir * from;
      const y1 = startY + star.slope * from;
      if (y0 > floor || y1 > floor) continue;
      p.stroke(235, 240, 255, 230 * fade * (1 - i / SHOOTING_SEGMENTS));
      p.line(x0, y0, x1, y1);
    }
  }

  /** Faint disc haze along the tilted disc, then the bulge's warm, gently pulsing core. */
  private drawGlow(p: P5Like, f: Frame, palette: Palette, elapsed: number): void {
    p.noStroke();
    p.push();
    p.translate(f.cx, f.cy);
    p.rotate(POSITION_ANGLE);
    const [hr, hg, hb] = palette.haze;
    for (const layer of HAZE_LAYERS) {
      p.fill(hr, hg, hb, layer.alpha);
      p.ellipse(0, 0, 2 * layer.reach * f.R, 2 * layer.reach * f.R * f.cosTilt);
    }
    const pulse = 1 + CORE_PULSE * Math.sin((elapsed * TWO_PI) / CORE_PULSE_PERIOD_MS);
    const squash = Math.hypot(f.cosTilt, BULGE_FLATTEN * f.sinTilt);
    for (let i = 0; i < CORE_GLOW_LAYERS.length; i++) {
      const [r, g, b] = palette.coreGlow[i];
      const d = 2 * CORE_GLOW_LAYERS[i].reach * f.R * pulse;
      p.fill(r, g, b, CORE_GLOW_LAYERS[i].alpha);
      p.ellipse(0, 0, d, d * squash);
    }
    p.pop();
  }

  /**
   * Projects every bulge and disc star, sorts them into style bins (tint ×
   * brightness × size) with a counting sort, and strokes each bin as one shape.
   */
  private drawStars(p: P5Like, f: Frame, palette: Palette): void {
    const { xs, ys, bins, order, binStart, binFill } = this;
    let n = 0;
    for (const star of this.bulge) {
      xs[n] = projectX(f, star.rad * Math.cos(star.ang), star.rad * Math.sin(star.ang), star.z);
      ys[n] = projectY(f, star.rad * Math.cos(star.ang), star.rad * Math.sin(star.ang), star.z);
      bins[n] = binOf(0, star.base, star.giant);
      n++;
    }
    for (const star of this.disc) {
      const r = orbitRadius(f, star.a, star.psi) + star.jitter;
      const x = r * Math.cos(star.psi);
      const y = r * Math.sin(star.psi);
      xs[n] = projectX(f, x, y, 0);
      ys[n] = projectY(f, x, y, 0);
      const armness = armnessAt(f, star.a, star.psi);
      // Inner disc stars are old and warm; out in the arms, young stars burn blue.
      const outward = clamp((star.a - DISC_INNER) / 0.4, 0, 1);
      bins[n] = binOf(
        outward * (0.25 + 0.75 * armness),
        star.base * (0.12 + 0.88 * armness * armness),
        star.giant,
      );
      n++;
    }

    binFill.fill(0);
    for (let i = 0; i < n; i++) binFill[bins[i]]++;
    binStart[0] = 0;
    for (let b = 0; b < BIN_COUNT; b++) {
      binStart[b + 1] = binStart[b] + binFill[b];
      binFill[b] = binStart[b];
    }
    for (let i = 0; i < n; i++) order[binFill[bins[i]]++] = i;

    const sizeScale = clamp(f.R / 450, 0.8, 1.6);
    p.noFill();
    for (let b = 0; b < BIN_COUNT; b++) {
      if (binStart[b + 1] === binStart[b]) continue;
      const size = b % SIZE_LEVELS_PX.length;
      const alpha = Math.floor(b / SIZE_LEVELS_PX.length) % ALPHA_LEVELS.length;
      const tint = Math.floor(b / (SIZE_LEVELS_PX.length * ALPHA_LEVELS.length));
      const [r, g, bl] = palette.tints[tint];
      p.stroke(r, g, bl, ALPHA_LEVELS[alpha]);
      p.strokeWeight(SIZE_LEVELS_PX[size] * sizeScale);
      strokeDots(p, xs, ys, order, binStart[b], binStart[b + 1]);
    }
  }

  /** The nebula's soft blobs, the young star's halo, then the star with its spikes. */
  private drawBirth(
    p: P5Like,
    f: Frame,
    palette: Palette,
    birth: StarBirth,
    elapsed: number,
  ): void {
    const glow = birthGlow(birth, elapsed);
    if (glow <= 0) return;
    const r = orbitRadius(f, birth.a, birth.psi);
    const x = projectX(f, r * Math.cos(birth.psi), r * Math.sin(birth.psi), 0);
    const y = projectY(f, r * Math.cos(birth.psi), r * Math.sin(birth.psi), 0);
    const radius = f.R * (NEBULA_BASE + NEBULA_VELOCITY_SCALE * birth.velocity);
    const squash = Math.max(f.cosTilt, 0.45);
    const strength = glow * (0.55 + 0.45 * birth.velocity);

    p.noStroke();
    const [nr, ng, nb] = palette.nebula;
    for (let i = 0; i < NEBULA_BLOBS; i++) {
      const bx = x + birth.blobs[i * 3] * radius;
      const by = y + birth.blobs[i * 3 + 1] * radius * squash;
      const size = birth.blobs[i * 3 + 2] * radius;
      for (const layer of NEBULA_LAYERS) {
        p.fill(nr, ng, nb, layer.alpha * strength);
        const d = 2 * size * layer.reach;
        p.ellipse(bx, by, d, d * squash);
      }
    }

    const [sr, sg, sb] = palette.youngStar;
    p.fill(sr, sg, sb, 90 * glow);
    p.ellipse(x, y, radius * 0.7, radius * 0.7);

    const flash = Math.exp(-(elapsed - birth.bornAt) / BIRTH_FLASH_MS);
    const starSize =
      (BIRTH_STAR_BASE_PX + BIRTH_STAR_VELOCITY_PX * birth.velocity) *
      (1 + BIRTH_FLASH_SCALE * flash);
    p.stroke(sr, sg, sb, 255 * Math.max(glow, 0.6));
    p.strokeWeight(Math.min(starSize, radius));
    p.line(x, y, x + DOT_NUDGE, y);

    const spike = radius * (0.6 + 0.6 * flash) * glow;
    p.stroke(sr, sg, sb, 150 * glow);
    p.strokeWeight(1);
    p.line(x - spike, y, x + spike, y);
    p.line(x, y - spike, x, y + spike);
  }
}
