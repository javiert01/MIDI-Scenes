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

/** Soft grey-white, like a snowy owl catching the light of the storm sky. */
const OWL_SILHOUETTE: RgbColor = [214, 216, 226];
const OWL_EYE: RgbColor = [255, 196, 80];

/** A note at least this hard makes the owl over that key drop its letter. */
const LETTER_DROP_VELOCITY = 0.7;
/** How long an owl flies empty-handed before it has a new letter to carry. */
const LETTER_RELOAD_MS = 6_000;
const MAX_FALLING_LETTERS = 6;

const CASTLE_SILHOUETTE: RgbColor = [24, 27, 42];

/** No window sits below this fraction of the visualization height. */
const WINDOW_FLOOR = 0.9;
const TOWER_WINDOW_HEIGHT = 0.022;
const HALL_WINDOW_HEIGHT = 0.045;
/** The smallest gap kept between two windows — fractions of the width and of the visualization height. */
const WINDOW_CLEARANCE_X = 0.008;
const WINDOW_CLEARANCE_Y = 0.015;

/**
 * Round towers with tall conical roofs: `cx`/`w` are fractions of the width,
 * `top` of the visualization height, and `roof` is the cone's height as a
 * multiple of the tower's width. The tallest, thinnest one is the
 * astronomy-style tower that anchors the skyline.
 */
const SPIRES = [
  { cx: 0.585, w: 0.012, top: 0.71, roof: 2.4 },
  { cx: 0.625, w: 0.016, top: 0.63, roof: 2.6 },
  { cx: 0.7, w: 0.018, top: 0.56, roof: 2.4 },
  { cx: 0.775, w: 0.022, top: 0.36, roof: 3 },
  { cx: 0.815, w: 0.02, top: 0.5, roof: 2.2 },
  { cx: 0.865, w: 0.016, top: 0.55, roof: 2.6 },
  { cx: 0.91, w: 0.026, top: 0.46, roof: 2 },
  { cx: 0.952, w: 0.014, top: 0.58, roof: 2.6 },
  { cx: 0.985, w: 0.018, top: 0.62, roof: 2 },
] as const;

/**
 * Long halls between the towers. A `peak` gives a gabled roof rising to that
 * height; `peak: 0` gives a flat, crenellated top instead. Each hall starts
 * where the last one ends and the last runs to the right edge, so the castle
 * stands as one block with no sky showing between its buildings.
 */
const HALLS = [
  { left: 0.555, right: 0.6, top: 0.72, peak: 0 },
  { left: 0.6, right: 0.7, top: 0.66, peak: 0.61 },
  { left: 0.7, right: 0.79, top: 0.6, peak: 0 },
  { left: 0.79, right: 0.9, top: 0.63, peak: 0.585 },
  { left: 0.9, right: 1, top: 0.65, peak: 0.62 },
] as const;

interface CastleWindow {
  /** Center x, as a fraction of the width. */
  x: number;
  /** Top edge, as a fraction of the visualization height. */
  y: number;
  /** Width as a fraction of the width; height as a fraction of the visualization height. */
  w: number;
  h: number;
  lit: boolean;
  /** Offsets this window's flicker noise so the lit windows don't pulse in unison. */
  seed: number;
}

/**
 * A column of small arched windows up each tower and a row of tall gothic
 * windows along each hall. Which ones are lit is fixed (hashed from the
 * index), so the castle looks the same every time the scene opens. Where a
 * tower window would crowd a hall window, the tower window is left out: the
 * tall hall windows carry that spot on their own.
 */
function buildCastleWindows(): CastleWindow[] {
  const hallWindows: CastleWindow[] = [];
  for (const hall of HALLS) {
    const y = hall.top + 0.025;
    if (y + HALL_WINDOW_HEIGHT > WINDOW_FLOOR) continue;
    const count = Math.max(1, Math.round((hall.right - hall.left) / 0.016));
    const step = (hall.right - hall.left) / count;
    for (let i = 0; i < count; i++) {
      hallWindows.push({
        x: hall.left + step * (i + 0.5),
        y,
        w: 0.0045,
        h: HALL_WINDOW_HEIGHT,
        lit: false,
        seed: 0,
      });
    }
  }

  const windows: CastleWindow[] = [];
  // Numbered in a fixed order (towers, then halls) and counted even when a
  // window is skipped, so dropping one never changes which others are lit.
  let n = 0;
  const add = (win: CastleWindow) => {
    win.lit = latticeValue(n) > 0.3;
    win.seed = n * 17.3;
    windows.push(win);
  };
  for (const spire of SPIRES) {
    for (let y = spire.top + 0.03; y + TOWER_WINDOW_HEIGHT < WINDOW_FLOOR; y += 0.065) {
      const win = {
        x: spire.cx,
        y,
        w: spire.w * 0.32,
        h: TOWER_WINDOW_HEIGHT,
        lit: false,
        seed: 0,
      };
      if (!hallWindows.some((hallWindow) => windowsCrowd(win, hallWindow))) add(win);
      n++;
    }
  }
  for (const hallWindow of hallWindows) {
    add(hallWindow);
    n++;
  }
  return windows;
}

/** Whether two windows overlap or sit closer than the clearance on both axes. */
function windowsCrowd(a: CastleWindow, b: CastleWindow): boolean {
  const xGap = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
  const yGap = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return xGap < WINDOW_CLEARANCE_X && yGap < WINDOW_CLEARANCE_Y;
}

const CASTLE_WINDOWS = buildCastleWindows();

/** Note-on brightening of the castle windows; decays toward 0 each frame. */
const CASTLE_GLOW_DECAY = 0.95;

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

/** On average, each candle releases one mote of golden dust this often. */
const DUST_INTERVAL_MS = 650;
const MAX_DUST = 70;
/** A note at least this hard bursts sparks from the candle under its key (same bar as the owl letters). */
const SPARK_VELOCITY = 0.7;
const SPARKS_PER_BURST = 12;
const MAX_SPARKS = 90;
/** Downward pull on sparks, px/frame², so they arc over and fall back. */
const SPARK_GRAVITY = 0.07;

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

/** The pale tone a cloud's lit top tends toward; lightning pushes the whole cloud toward it. */
const CLOUD_LIGHT: RgbColor = [214, 218, 232];

/**
 * A cel-shaded storm cloud in three flat layers, each drawn across every puff
 * before the next so the puffs merge into one shape: an underside warmed by
 * the horizon glow, a cool grey body, and a pale highlight along the top.
 * A lightning flash lifts the body and highlight toward white.
 */
function drawCloud(
  p: P5Like,
  cloud: Cloud,
  skyTop: RgbColor,
  horizon: RgbColor,
  flash: number,
): void {
  // Kept close to the sky's own tone so the clouds sit in it rather than on it.
  const warm = 0.3 * (1 - flash);
  p.fill(
    mix(mix(skyTop[0], horizon[0], warm), CLOUD_LIGHT[0], 0.12 + flash * 0.6),
    mix(mix(skyTop[1], horizon[1], warm), CLOUD_LIGHT[1], 0.12 + flash * 0.6),
    mix(mix(skyTop[2], horizon[2], warm), CLOUD_LIGHT[2], 0.12 + flash * 0.6),
  );
  for (const puff of cloud.puffs) {
    p.ellipse(cloud.x + puff.dx, cloud.y + puff.dy + puff.h * 0.1, puff.w, puff.h * 0.9);
  }
  fillMix(p, skyTop, CLOUD_LIGHT, 0.18 + flash * 0.6);
  for (const puff of cloud.puffs) {
    p.ellipse(cloud.x + puff.dx, cloud.y + puff.dy, puff.w, puff.h);
  }
  fillMix(p, skyTop, CLOUD_LIGHT, 0.36 + flash * 0.6);
  for (const puff of cloud.puffs) {
    p.ellipse(cloud.x + puff.dx, cloud.y + puff.dy - puff.h * 0.18, puff.w * 0.68, puff.h * 0.5);
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
  /** Whether it carries a letter in its talons; when not, it gets one back at `letterBackAt`. */
  hasLetter: boolean;
  /** When an owl that dropped its letter gets a new one, on the ctx.elapsed clock. */
  letterBackAt: number;
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
    hasLetter: true,
    letterBackAt: 0,
  };
}

/**
 * Steady horizontal travel with a gentle sine bob — simple harmonic motion per
 * Nature of Code ch. 3 (Oscillation), like Underwater's traveling fish but on
 * a fixed heading.
 */
function updateOwl(owl: Owl, { width }: Bounds, timeMs: number): void {
  if (!owl.hasLetter && timeMs >= owl.letterBackAt) owl.hasLetter = true;
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

  // The letter hangs from the talons; the body, drawn next, overlaps its top
  // edge so the owl looks like it is gripping it.
  if (owl.hasLetter) drawEnvelope(p, -dir * s * 0.1, s * 0.5, s * 0.6, 0);

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

  // A single amber eye glint — the side-on owl shows only one.
  p.fill(OWL_EYE[0], OWL_EYE[1], OWL_EYE[2]);
  p.ellipse(dir * s * 0.8, -s * 0.17, s * 0.13, s * 0.13);

  p.pop();
}

/** A cream envelope with its flap and a red wax seal, centered on (x, y), `w` wide, turned by `angle`. */
function drawEnvelope(p: P5Like, x: number, y: number, w: number, angle: number): void {
  const h = w * 0.65;
  p.push();
  p.translate(x, y);
  p.rotate(angle);
  p.fill(236, 226, 200);
  p.rect(-w / 2, -h / 2, w, h);
  p.fill(206, 192, 160);
  p.triangle(-w / 2, -h / 2, w / 2, -h / 2, 0, h * 0.12);
  p.fill(160, 32, 36);
  p.ellipse(0, h * 0.08, w * 0.2, w * 0.2);
  p.pop();
}

interface FallingLetter {
  x: number;
  y: number;
  size: number;
  /** Downward drift in px/frame; the flutter swings around this path. */
  fallSpeed: number;
  flutterPhase: number;
  flutterPeriodMs: number;
  /** The x the flutter sways around; it drifts on with the owl's heading. */
  originX: number;
  /** Horizontal drift in px/frame, a share of the owl's speed carried on after letting go. */
  drift: number;
}

/**
 * A dropped letter flutters down like a leaf: a slow, steady fall with a
 * sideways sine sway and a matching tilt — the oscillation of Nature of Code
 * ch. 3, with the tilt following the sway so it seems to rock on the air.
 */
function updateFallingLetter(letter: FallingLetter, timeMs: number): void {
  letter.y += letter.fallSpeed;
  letter.originX += letter.drift;
  const phase = (timeMs / letter.flutterPeriodMs) * TWO_PI + letter.flutterPhase;
  letter.x = letter.originX + Math.sin(phase) * letter.size * 1.2;
}

function drawFallingLetter(p: P5Like, letter: FallingLetter, timeMs: number): void {
  const phase = (timeMs / letter.flutterPeriodMs) * TWO_PI + letter.flutterPhase;
  drawEnvelope(p, letter.x, letter.y, letter.size, Math.cos(phase) * 0.6);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** `fill` with the color `t` of the way from `a` to `b` — no array allocated per frame. */
function fillMix(p: P5Like, a: RgbColor, b: RgbColor, t: number, alpha = 255): void {
  p.fill(mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t), alpha);
}

/**
 * A towered castle on the right of the horizon: long halls and cone-roofed
 * spires standing on the bottom edge, then their lit windows. It is opaque
 * and tinted toward the horizon glow, which reads as distance without the
 * double-painted seams a translucent fill would leave where shapes overlap.
 * Pure composition, so no prior-art reference applies beyond the window
 * flicker. Sits at the very back of the scene: only the sky gradient is
 * behind it.
 */
function drawCastle(
  p: P5Like,
  { width, visHeight }: Bounds,
  horizon: RgbColor,
  timeMs: number,
  glow: number,
): void {
  fillMix(p, CASTLE_SILHOUETTE, horizon, 0.14);
  const base = visHeight;
  for (const hall of HALLS) {
    const left = hall.left * width;
    const right = hall.right * width;
    const top = hall.top * visHeight;
    p.rect(left, top, right - left, base - top);
    if (hall.peak > 0) {
      p.triangle(left, top, right, top, (left + right) / 2, hall.peak * visHeight);
    } else {
      // Crenellations: a row of merlons along the flat top.
      const merlonCount = Math.max(2, Math.round((right - left) / 8));
      const step = (right - left) / merlonCount;
      const merlonHeight = Math.max(3, visHeight * 0.012);
      for (let i = 0; i < merlonCount; i++) {
        p.rect(left + i * step + step * 0.2, top - merlonHeight, step * 0.6, merlonHeight);
      }
    }
  }
  for (const spire of SPIRES) {
    const towerWidth = spire.w * width;
    const cx = spire.cx * width;
    const top = spire.top * visHeight;
    p.rect(cx - towerWidth / 2, top, towerWidth, base - top);
    p.triangle(
      cx - towerWidth * 0.65,
      top,
      cx + towerWidth * 0.65,
      top,
      cx,
      top - towerWidth * spire.roof,
    );
  }

  // Lit windows flicker on value noise like the candle flames (Nature of Code
  // §I.5), and each note brightens them all.
  const flickerT = timeMs * 0.0008;
  for (const win of CASTLE_WINDOWS) {
    if (!win.lit) continue;
    const brightness = Math.min(1.4, 0.65 + valueNoise(win.seed + flickerT) * 0.35 + glow * 0.6);
    const w = Math.max(2, win.w * width);
    const h = win.h * visHeight;
    const x = win.x * width;
    const y = win.y * visHeight;
    p.fill(255, 170, 80, 18 * brightness);
    p.ellipse(x, y + h / 2, w * 4, h * 1.8);
    p.fill(255, 190 + 40 * Math.min(1, glow), 110, Math.min(255, 170 * brightness));
    p.rect(x - w / 2, y, w, h, w / 2, w / 2, 0, 0);
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
/** The top of the candle body this frame, levitation bob included. */
function candleTopY(candle: Candle, timeMs: number): number {
  const bob = candle.levitates
    ? Math.sin((timeMs / candle.bobPeriodMs) * TWO_PI + candle.bobPhase) * candle.bobAmplitude
    : 0;
  return candle.baseY + bob;
}

function drawCandle(p: P5Like, candle: Candle, timeMs: number): void {
  const y = candleTopY(candle, timeMs);

  p.fill(232, 222, 196);
  p.rect(candle.x - candle.bodyWidth / 2, y, candle.bodyWidth, candle.bodyHeight);

  const t = timeMs * 0.004 + candle.seed;
  const flicker = valueNoise(t);
  const sway = (valueNoise(t + 57.3) - 0.5) * candle.bodyWidth * 0.35;
  const flameH = candle.bodyWidth * (1.6 + flicker * 0.7) * (1 + candle.flare * FLARE_HEIGHT_SCALE);
  const flameW = candle.bodyWidth * (0.75 + flicker * 0.2) * (1 + candle.flare * FLARE_WIDTH_SCALE);
  const flameX = candle.x + sway;
  const flameY = y - flameH * 0.5 - 2;

  // A halo of three flat rings, widest and faintest outermost — the same
  // stacked-ring glow as the moon. A flare brightens every ring.
  const boost = candle.flare * FLARE_GLOW_ALPHA_SCALE;
  p.fill(255, 190, 110, 9 + boost * 0.25);
  p.ellipse(flameX, flameY, flameW * 6.4, flameH * 3.6);
  p.fill(255, 185, 100, 16 + boost * 0.45);
  p.ellipse(flameX, flameY, flameW * 4.4, flameH * 2.6);
  p.fill(255, 180, 90, 28 + boost * 0.7);
  p.ellipse(flameX, flameY, flameW * 2.6, flameH * 1.8);
  p.fill(255, 165, 70, 220);
  p.ellipse(flameX, flameY, flameW, flameH);
  p.fill(255, 236, 170, 240);
  p.ellipse(flameX, flameY + flameH * 0.12, flameW * 0.5, flameH * 0.55);
}

/**
 * A speck of golden dust or a spark — the particle of the p5.js particle
 * system example: position, velocity, and a lifespan it fades out over.
 */
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining and total lifespan in ms; alpha follows their ratio. */
  life: number;
  maxLife: number;
  size: number;
  /** Dust sways on a sine as it rises; sparks don't. */
  swayPhase: number;
}

function spawnDust(candle: Candle, timeMs: number): Mote {
  const maxLife = randomRange(1800, 3200);
  return {
    x: candle.x + randomRange(-0.3, 0.3) * candle.bodyWidth,
    y: candleTopY(candle, timeMs) - candle.bodyWidth * 1.4,
    vx: 0,
    vy: -randomRange(0.25, 0.55),
    life: maxLife,
    maxLife,
    size: randomRange(1.4, 2.6),
    swayPhase: randomRange(0, TWO_PI),
  };
}

function spawnSpark(candle: Candle, timeMs: number, velocity: number): Mote {
  // Mostly upward, fanned out to either side, faster for harder notes.
  const angle = -Math.PI / 2 + randomRange(-1.1, 1.1);
  const speed = randomRange(1.6, 3.4) * (0.6 + velocity * 0.6);
  const maxLife = randomRange(650, 1100);
  return {
    x: candle.x,
    y: candleTopY(candle, timeMs) - candle.bodyWidth * 1.2,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: maxLife,
    maxLife,
    size: randomRange(2, 3.4),
    swayPhase: 0,
  };
}

/**
 * Moves every mote and drops the expired ones (swap-and-pop, so no new array
 * per frame). Dust drifts up with a sine sway (Nature of Code ch. 3); sparks
 * fly ballistically under gravity (Nature of Code ch. 2, Forces).
 */
function updateMotes(
  motes: Mote[],
  deltaMs: number,
  timeMs: number,
  gravity: number,
  sway: number,
): void {
  for (let i = motes.length - 1; i >= 0; i--) {
    const mote = motes[i];
    mote.life -= deltaMs;
    if (mote.life <= 0) {
      motes[i] = motes[motes.length - 1];
      motes.pop();
      continue;
    }
    mote.vy += gravity;
    mote.x += mote.vx + Math.sin(timeMs * 0.003 + mote.swayPhase) * sway;
    mote.y += mote.vy;
  }
}

/** Dust: soft gold specks that fade as they rise. */
function drawDust(p: P5Like, motes: Mote[]): void {
  for (const mote of motes) {
    // Fade in quickly, then out over the rest of the life.
    const t = mote.life / mote.maxLife;
    const alpha = Math.min(1, (1 - t) * 6) * t;
    p.fill(255, 214, 120, 210 * alpha);
    p.ellipse(mote.x, mote.y, mote.size, mote.size);
  }
}

/** Sparks: a warm glow with a bright core, fading over their short life. */
function drawSparks(p: P5Like, motes: Mote[]): void {
  for (const mote of motes) {
    const alpha = mote.life / mote.maxLife;
    p.fill(255, 190, 90, 90 * alpha);
    p.ellipse(mote.x, mote.y, mote.size * 2.6, mote.size * 2.6);
    p.fill(255, 244, 200, 255 * alpha);
    p.ellipse(mote.x, mote.y, mote.size, mote.size);
  }
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

interface Star {
  /** Fractions of the width and of the visualization height. */
  x: number;
  y: number;
  size: number;
  twinklePhase: number;
  /** Radians per ms. */
  twinkleSpeed: number;
}

/** How far down the sky stars reach, as a fraction of the visualization height. */
const STAR_BAND = 0.5;
const STAR_COUNT = 90;

/**
 * Fixed star positions, hashed from the index (no Math.random), packed toward
 * the top of the sky where it is darkest.
 */
const STARS: Star[] = Array.from({ length: STAR_COUNT }, (_, i) => ({
  x: latticeValue(i * 3 + 1),
  y: Math.pow(latticeValue(i * 3 + 2), 1.6) * STAR_BAND,
  size: 1.6 + latticeValue(i * 3 + 3) * 1.8,
  twinklePhase: latticeValue(i + 500) * TWO_PI,
  twinkleSpeed: 0.0008 + latticeValue(i + 900) * 0.0016,
}));

/**
 * Stars twinkle on a sine each (Nature of Code ch. 3, Oscillation) and fade
 * out toward the horizon, where the glow would drown them.
 */
function drawStars(p: P5Like, { width, visHeight }: Bounds, timeMs: number): void {
  for (const star of STARS) {
    const twinkle = 0.5 + 0.5 * Math.sin(timeMs * star.twinkleSpeed + star.twinklePhase);
    const fade = 1 - star.y / STAR_BAND;
    p.fill(250, 246, 230, 230 * fade * (0.35 + 0.65 * twinkle));
    p.ellipse(star.x * width, star.y * visHeight, star.size, star.size);
  }
}

/** The moon hangs high on the left, opposite the castle; fractions of the width and height. */
const MOON = { x: 0.2, y: 0.2, radius: 0.055 } as const;

/** A pale full moon with faint craters and a soft halo of stacked rings. */
function drawMoon(p: P5Like, { width, visHeight }: Bounds): void {
  const x = MOON.x * width;
  const y = MOON.y * visHeight;
  const d = MOON.radius * visHeight * 2;
  p.fill(236, 232, 214, 8);
  p.ellipse(x, y, d * 4.6, d * 4.6);
  p.fill(236, 232, 214, 12);
  p.ellipse(x, y, d * 3.1, d * 3.1);
  p.fill(236, 232, 214, 20);
  p.ellipse(x, y, d * 1.9, d * 1.9);
  p.fill(240, 236, 220);
  p.ellipse(x, y, d, d);
  p.fill(206, 202, 188, 150);
  p.ellipse(x - d * 0.16, y - d * 0.1, d * 0.26, d * 0.22);
  p.ellipse(x + d * 0.18, y + d * 0.14, d * 0.18, d * 0.16);
  p.ellipse(x + d * 0.06, y - d * 0.24, d * 0.12, d * 0.1);
}

/**
 * A forked bolt as flat [x0, y0, x1, y1, …] polylines: a jagged main channel
 * from the clouds toward the horizon, plus two branches splitting off it.
 * Built once per strike (rare), so the allocation stays out of the frame loop.
 */
function spawnBolt({ width, visHeight }: Bounds): number[][] {
  const steps = 12;
  let x = randomRange(0.15, 0.85) * width;
  let y = randomRange(0.06, 0.14) * visHeight;
  const stepY = (randomRange(0.6, 0.78) * visHeight - y) / steps;
  const main = [x, y];
  for (let i = 0; i < steps; i++) {
    x += randomRange(-1, 1) * width * 0.025;
    y += stepY * randomRange(0.7, 1.3);
    main.push(x, y);
  }
  const bolt = [main];
  for (let b = 0; b < 2; b++) {
    const k = 3 + Math.floor(Math.random() * (steps - 6));
    let bx = main[k * 2];
    let by = main[k * 2 + 1];
    const side = b === 0 ? -1 : 1;
    const branch = [bx, by];
    for (let j = 0; j < 5; j++) {
      bx += side * width * randomRange(0.01, 0.03);
      by += stepY * randomRange(0.5, 1);
      branch.push(bx, by);
    }
    bolt.push(branch);
  }
  return bolt;
}

/** The bolt as a wide faint glow under a thin bright core; branches are thinner. */
function drawBolt(p: P5Like, bolt: number[][], flash: number): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bolt.length; i++) {
      const path = bolt[i];
      const weight = i === 0 ? 1 : 0.6;
      if (pass === 0) {
        p.stroke(190, 205, 255, 70 * flash);
        p.strokeWeight(8 * weight);
      } else {
        p.stroke(246, 248, 255, 255 * flash);
        p.strokeWeight(2.4 * weight);
      }
      for (let j = 2; j < path.length; j += 2) {
        p.line(path[j - 2], path[j - 1], path[j], path[j + 1]);
      }
    }
  }
  p.noStroke();
  p.strokeWeight(1);
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
 * drifting on noise, silhouette owls flapping across, a towered castle on the
 * right, random lightning, and a row of levitating candles in the
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
  private castleGlow = 0;
  private fallingLetters: FallingLetter[] = [];
  /** The current strike's polylines; empty until the first flash. */
  private bolt: number[][] = [];
  private dust: Mote[] = [];
  private sparks: Mote[] = [];

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
    this.fallingLetters = [];
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
    for (const letter of this.fallingLetters) updateFallingLetter(letter, ctx.elapsed);
    // A letter is gone once its top edge passes the bottom of the scene.
    for (let i = this.fallingLetters.length - 1; i >= 0; i--) {
      const letter = this.fallingLetters[i];
      if (letter.y - letter.size > bounds.visHeight) this.fallingLetters.splice(i, 1);
    }
    for (const candle of this.candles) {
      updateCandle(candle);
      if (this.dust.length < MAX_DUST && Math.random() < ctx.deltaTime / DUST_INTERVAL_MS) {
        this.dust.push(spawnDust(candle, ctx.elapsed));
      }
    }
    updateMotes(this.dust, ctx.deltaTime, ctx.elapsed, 0, 0.25);
    updateMotes(this.sparks, ctx.deltaTime, ctx.elapsed, SPARK_GRAVITY, 0);
    this.castleGlow *= CASTLE_GLOW_DECAY;

    if (ctx.params.lightning === false) {
      // Keep the next flash ahead of the clock, or it would fall due while switched
      // off and fire the moment the toggle came back on.
      this.nextFlashAt = Math.max(this.nextFlashAt, ctx.elapsed + LIGHTNING_MIN_INTERVAL_MS);
    } else if (ctx.elapsed >= this.nextFlashAt) {
      this.flashStartedAt = ctx.elapsed;
      this.bolt = spawnBolt(bounds);
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
    // Stars and moon sit right on the sky; the bolt strikes behind the castle
    // and below the clouds it comes out of.
    drawStars(p, bounds, ctx.elapsed);
    drawMoon(p, bounds);
    const flash = this.flashIntensity(ctx.elapsed);
    if (flash > 0 && this.bolt.length > 0) drawBolt(p, this.bolt, flash);

    // The castle is the backdrop: everything that moves — clouds, owls,
    // crystals, candles — passes in front of it.
    if (ctx.params.castle !== false) {
      drawCastle(p, bounds, horizon, ctx.elapsed, this.castleGlow);
    }

    for (const cloud of this.clouds) drawCloud(p, cloud, skyTop, horizon, flash);
    for (const owl of this.owls) drawOwl(p, owl, ctx.elapsed);
    for (const letter of this.fallingLetters) drawFallingLetter(p, letter, ctx.elapsed);

    // Crystals sit behind the foreground candles — in the sky with the clouds
    // and owls — so the candle row stays the closest layer, like Underwater's
    // creatures.
    ctx.drawCrystals();

    p.noStroke();
    for (const candle of this.candles) drawCandle(p, candle, ctx.elapsed);
    drawDust(p, this.dust);
    drawSparks(p, this.sparks);

    // Full-scene flash on top: a hold at full strength then a fade, the same
    // fade-over-lifespan envelope as a p5.js particle example (cf. RainScene's
    // ripples), applied to a near-white overlay.
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
    // Every note also brightens the castle windows.
    this.castleGlow = Math.max(this.castleGlow, event.velocity);
    if (event.velocity >= LETTER_DROP_VELOCITY) this.dropLetter(x, ctx.elapsed);
    if (candle && event.velocity >= SPARK_VELOCITY) {
      for (let i = 0; i < SPARKS_PER_BURST && this.sparks.length < MAX_SPARKS; i++) {
        this.sparks.push(spawnSpark(candle, ctx.elapsed, event.velocity));
      }
    }
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
    this.castleGlow = 0;
    this.fallingLetters = [];
    this.bolt = [];
    this.dust = [];
    this.sparks = [];
  }

  /** The carrying owl nearest the key's column lets go of its letter. */
  private dropLetter(x: number, elapsed: number): void {
    if (this.fallingLetters.length >= MAX_FALLING_LETTERS) return;
    let owl: Owl | null = null;
    for (const candidate of this.owls) {
      if (!candidate.hasLetter) continue;
      if (!owl || Math.abs(candidate.x - x) < Math.abs(owl.x - x)) owl = candidate;
    }
    if (!owl) return;
    const startX = owl.x - owl.direction * owl.size * 0.1;
    const size = owl.size * 0.6;
    const flutterPhase = randomRange(0, TWO_PI);
    const flutterPeriodMs = randomRange(1400, 2200);
    // Start the sway at the letter's current spot, so it leaves the talons
    // without a jump.
    const sway = Math.sin((elapsed / flutterPeriodMs) * TWO_PI + flutterPhase) * size * 1.2;
    this.fallingLetters.push({
      x: startX,
      originX: startX - sway,
      drift: owl.speed * owl.direction * 0.4,
      y: owl.y + owl.size * 0.5,
      size,
      fallSpeed: randomRange(0.7, 1.1),
      flutterPhase,
      flutterPeriodMs,
    });
    owl.hasLetter = false;
    owl.letterBackAt = elapsed + LETTER_RELOAD_MS;
  }

  private flashIntensity(elapsed: number): number {
    const age = elapsed - this.flashStartedAt;
    if (age < 0) return 0;
    if (age < LIGHTNING_HOLD_MS) return 1;
    const fade = 1 - (age - LIGHTNING_HOLD_MS) / LIGHTNING_FADE_MS;
    return fade > 0 ? fade : 0;
  }
}
