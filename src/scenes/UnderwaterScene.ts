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

const FISH_COLORS: Record<FishPattern, RgbColor> = {
  traveling: [50, 190, 210],
  circling: [50, 120, 220],
  wandering: [60, 200, 150],
};
const FISH_PATTERNS = Object.keys(FISH_COLORS) as FishPattern[];

const JELLYFISH_COLORS: RgbColor[] = [
  [130, 200, 235],
  [215, 135, 225],
  [130, 225, 190],
];

const FISH_BOOST_SPEED_SCALE = 2;
const FISH_BOOST_SIZE_SCALE = 0.25;
/** How far a fish's outline reaches from its centre at any heading, in fish sizes, before boost. */
const FISH_REACH = 2;
/** Band above the floor and below the ceiling in which a wandering fish starts turning back, px. */
const FISH_WALL_ZONE = 70;
/** Steepest a wandering fish pitches when turning back from a wall, radians. */
const FISH_WALL_PITCH = 0.9;
const FISH_WALL_TURN = 0.05;
/** Per-frame easing of a wandering fish's pitch back toward level: fish do not swim vertically. */
const FISH_LEVELING = 0.008;

const FISH_MIN_SIZE = 10;
const FISH_MAX_SIZE = 18;
/** Fastest a fish's pace can drive its tail, so a boosted fast fish doesn't strobe. */
const FISH_MAX_BEAT_PACE = 3;
const FISH_HALF_LENGTH = 0.85; // in fish sizes
const FISH_TAIL_LENGTH = 0.8; // in fish sizes
const FISH_TAIL_SPREAD = 0.55; // in fish sizes
const FISH_WAG = 0.2; // in fish sizes, at the tail end of the body
const FISH_BODY_SEGMENTS = 12;
const FISH_GLOW = [3.2, 2.6, 2.1];
const FISH_TAIL_RAYS = [-0.75, -0.3, 0.3, 0.75];
// Body points the dorsal and anal fins run along, nose = 0.
const FISH_DORSAL = { from: 3, to: 9, height: 0.7 };
const FISH_ANAL = { from: 7, to: 10, height: 0.45 };

// Body half-depth from nose to the narrow base of the tail: a blunt head, deepest
// at the shoulder, then a long taper.
const FISH_PROFILE = Array.from({ length: FISH_BODY_SEGMENTS + 1 }, (_, i) => {
  const t = i / FISH_BODY_SEGMENTS;
  return Math.max(Math.pow(Math.sin(PI * Math.pow(t, 0.62)), 0.8), 0.14 * t);
});
// The swimming bend of the fish being drawn, reused so drawing allocates nothing.
const fishSpine = new Float32Array(FISH_BODY_SEGMENTS + 1);

const JELLYFISH_MIN_SIZE = 18;
const JELLYFISH_MAX_SIZE = 34;
const JELLYFISH_BOOST_PULSE_SCALE = 3;
const JELLYFISH_BOOST_SIZE_SCALE = 0.2;
/** Share of a pulse spent contracting: a quick squeeze, then a long, slow relaxation. */
const JELLYFISH_CONTRACTION_SHARE = 0.3;
const JELLYFISH_DRAG = 0.97;
const JELLYFISH_SINK = 0.006;
/** Distance above its target depth at which a jellyfish has fully rolled over to sink, px. */
const JELLYFISH_SINK_ZONE = 80;
const JELLYFISH_ROLL = 1.1;
const JELLYFISH_ROLL_EASING = 0.012;

const TENTACLE_LENGTH = 4.2; // in bell radii
const TENTACLE_POINTS = 8;
const TENTACLE_HANG = 0.4;
const TENTACLE_SWAY = 0.45;
const ARM_COUNT = 4;
const ARM_LENGTH = 2.2; // in bell radii
const ARM_POINTS = 8;
const ARM_FRILL = 0.11; // in bell radii
const ARM_SPREAD = 0.34; // anchor half-width, in bell radii

const JELLYFISH_GLOW = [3.4, 3, 2.6, 2.2, 1.9];

const BELL_SEGMENTS = 18;
const BELL_MARGIN_SEGMENTS = 16;
const BELL_MARGIN_ARCH = 0.2;
const BELL_SCALLOP = 0.05;
const BELL_SCALLOPS = 8;
const RADIAL_CANALS = [-0.8, -0.48, -0.16, 0.16, 0.48, 0.8];
const RADIAL_CANAL_SEGMENTS = 4;
const GONADS = [-0.45, -0.15, 0.15, 0.45];

// Unit dome from the right margin over the apex to the left, shared by every bell layer.
const DOME_COS = Array.from({ length: BELL_SEGMENTS + 1 }, (_, i) =>
  Math.cos((PI * i) / BELL_SEGMENTS),
);
const DOME_SIN = Array.from({ length: BELL_SEGMENTS + 1 }, (_, i) =>
  Math.sin((PI * i) / BELL_SEGMENTS),
);
const DOME_LIFT = DOME_SIN.map((s) => Math.pow(s, 0.85));

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

/**
 * Holds a creature's centre where its whole body clears the ceiling and the floor
 * (the band's top edge). On a canvas too short for that, it centres the creature.
 */
function clampVertical(y: number, above: number, below: number, visHeight: number): number {
  const min = above;
  const max = visHeight - below;
  if (min > max) return (min + max) / 2;
  return Math.min(Math.max(y, min), max);
}

interface Fish {
  x: number;
  y: number;
  size: number;
  speed: number;
  direction: number;
  /** Which way a traveling fish crosses the canvas: 1 rightward, -1 leftward. */
  heading: number;
  frequency: number;
  amplitude: number;
  pattern: FishPattern;
  color: RgbColor;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  /** Position along a traveling fish's bob or a circling fish's orbit. */
  phase: number;
  /** A wandering fish's current change of direction, radians per frame. */
  turnRate: number;
  /** Staggers when each wandering fish picks a new turn, so they don't all turn at once. */
  turnOffset: number;
  /** Position within the tail's beat, radians. */
  swimPhase: number;
  /** Radians of tail beat per frame at normal pace. */
  beatRate: number;
  /** Body half-depth, in fish sizes. */
  bodyDepth: number;
  /** Normalized velocity boost from a nearby note-on; decays toward 0 each frame. */
  boost: number;
}

/** The farthest a fish can paint from its centre at any heading, at full boost. */
function fishReach(size: number): number {
  return size * FISH_REACH * (1 + FISH_BOOST_SIZE_SCALE);
}

function spawnFish({ width, visHeight }: Bounds): Fish {
  const size = randomRange(FISH_MIN_SIZE, FISH_MAX_SIZE);
  const reach = fishReach(size);
  const x = randomRange(0, width);
  const y = clampVertical(randomRange(0, visHeight), reach, reach, visHeight);
  const direction = randomRange(0, TWO_PI);
  const pattern = randomPattern();
  return {
    x,
    y,
    size,
    speed: randomRange(1, 2.5),
    direction,
    heading: Math.cos(direction) < 0 ? -1 : 1,
    frequency: randomRange(0.5, 1.5),
    amplitude: randomRange(10, 30),
    pattern,
    color: FISH_COLORS[pattern],
    centerX: x,
    centerY: y,
    radiusX: randomRange(100, 250),
    radiusY: randomRange(80, 200),
    phase: randomRange(0, TWO_PI),
    turnRate: 0,
    turnOffset: Math.floor(randomRange(0, 180)),
    swimPhase: randomRange(0, TWO_PI),
    beatRate: randomRange(0.16, 0.26),
    bodyDepth: randomRange(0.3, 0.4),
    boost: 0,
  };
}

/**
 * Wall avoidance after Nature of Code's steering behaviors: within FISH_WALL_ZONE
 * of the ceiling or floor the fish pitches away, so it turns back rather than
 * reaching the band. Otherwise its pitch eases back toward level. Steers the pitch
 * rather than the heading vector, so a fish diving straight at a wall still turns.
 */
function steerFromWalls(fish: Fish, reach: number, visHeight: number): void {
  const ceiling = reach + FISH_WALL_ZONE;
  const floor = visHeight - reach - FISH_WALL_ZONE;
  let push = 0;
  if (fish.y < ceiling) push = (ceiling - fish.y) / FISH_WALL_ZONE;
  else if (fish.y > floor) push = (floor - fish.y) / FISH_WALL_ZONE;

  const cos = Math.cos(fish.direction);
  const pitch = Math.atan2(Math.sin(fish.direction), Math.abs(cos));
  const nextPitch =
    push === 0
      ? pitch * (1 - FISH_LEVELING)
      : pitch + (push * FISH_WALL_PITCH - pitch) * FISH_WALL_TURN;
  fish.direction = Math.atan2(Math.sin(nextPitch), Math.cos(nextPitch) * (cos < 0 ? -1 : 1));
}

function updateFish(
  fish: Fish,
  frame: number,
  { width, visHeight }: Bounds,
  speedScale: number,
): void {
  fish.boost *= BOOST_DECAY;
  const pace = speedScale * (1 + fish.boost * FISH_BOOST_SPEED_SCALE);
  fish.swimPhase += fish.beatRate * Math.min(pace, FISH_MAX_BEAT_PACE);
  const speed = fish.speed * pace;
  const reach = fishReach(fish.size);

  switch (fish.pattern) {
    case 'traveling': {
      const margin = reach + fish.amplitude;
      const phaseStep = 0.02 * fish.frequency * pace;
      const xVel = fish.heading * speed;
      fish.phase += phaseStep;
      fish.centerY = clampVertical(fish.centerY, margin, margin, visHeight);
      fish.x += xVel;
      fish.y = fish.centerY + Math.sin(fish.phase) * fish.amplitude;
      fish.direction = Math.atan2(Math.cos(fish.phase) * fish.amplitude * phaseStep, xVel);
      break;
    }
    case 'circling': {
      // The orbit is fitted to the area each frame, so it survives a resolution change.
      const radiusY = Math.min(fish.radiusY, Math.max(0, visHeight / 2 - reach));
      const margin = reach + radiusY;
      fish.phase += 0.015 * fish.frequency * pace;
      fish.centerY = clampVertical(fish.centerY, margin, margin, visHeight);
      fish.x = fish.centerX + Math.cos(fish.phase) * fish.radiusX;
      fish.y = fish.centerY + Math.sin(fish.phase) * radiusY;
      fish.direction = Math.atan2(
        Math.cos(fish.phase) * radiusY,
        -Math.sin(fish.phase) * fish.radiusX,
      );
      return;
    }
    case 'wandering': {
      if ((frame + fish.turnOffset) % 180 === 0) {
        fish.turnRate = randomRange(-PI / 4, PI / 4) / 180;
      }
      fish.direction += fish.turnRate * speedScale;
      steerFromWalls(fish, reach, visHeight);
      fish.x += speed * Math.cos(fish.direction);
      fish.y = clampVertical(fish.y + speed * Math.sin(fish.direction), reach, reach, visHeight);
      break;
    }
  }

  fish.x = wrapHorizontal(fish.x, reach, width);
}

/** x along the body at a segment, nose forward. */
function fishBodyX(i: number, halfLength: number): number {
  return halfLength * (1 - (2 * i) / FISH_BODY_SEGMENTS);
}

/**
 * Traces a strip of the bent body, between two fractions of its depth: -1 to 1 is
 * the whole body, narrower strips are its shading.
 */
function traceFishStrip(
  p: P5Like,
  halfLength: number,
  halfDepth: number,
  from: number,
  to: number,
): void {
  p.beginShape();
  for (let i = 0; i <= FISH_BODY_SEGMENTS; i++) {
    p.vertex(fishBodyX(i, halfLength), fishSpine[i] + FISH_PROFILE[i] * halfDepth * from);
  }
  for (let i = FISH_BODY_SEGMENTS; i >= 0; i--) {
    p.vertex(fishBodyX(i, halfLength), fishSpine[i] + FISH_PROFILE[i] * halfDepth * to);
  }
  p.endShape('close');
}

/** Traces a fin along the body's edge; `side` is -1 for the back and 1 for the belly. */
function traceFishFin(
  p: P5Like,
  fin: { from: number; to: number; height: number },
  halfLength: number,
  halfDepth: number,
  side: number,
): void {
  const span = fin.to - fin.from;
  p.beginShape();
  for (let i = fin.from; i <= fin.to; i++) {
    const base = fishSpine[i] + FISH_PROFILE[i] * halfDepth * side * 0.8;
    p.vertex(fishBodyX(i, halfLength), base);
  }
  for (let i = fin.to; i >= fin.from; i--) {
    const rise = Math.sin((PI * (i - fin.from)) / span) * fin.height * halfDepth;
    const edge = fishSpine[i] + (FISH_PROFILE[i] * halfDepth + rise) * side;
    p.vertex(fishBodyX(i, halfLength), edge);
  }
  p.endShape('close');
}

function drawFishTail(
  p: P5Like,
  size: number,
  halfLength: number,
  swimPhase: number,
  pale: RgbColor,
): void {
  const baseX = -halfLength * 0.96;
  const baseY = fishSpine[FISH_BODY_SEGMENTS];
  const tipX = baseX - size * FISH_TAIL_LENGTH;
  // The tail lags the body's bend, so the beat reads as passing down the fish.
  const sway = Math.sin(swimPhase - 4.4) * size * FISH_WAG * 1.3;
  const spread = size * FISH_TAIL_SPREAD;

  p.beginShape();
  p.vertex(baseX, baseY);
  p.vertex(baseX - size * FISH_TAIL_LENGTH * 0.6, baseY + sway * 0.6 - spread * 0.62);
  p.vertex(tipX, baseY + sway - spread);
  p.vertex(baseX - size * FISH_TAIL_LENGTH * 0.62, baseY + sway * 0.6);
  p.vertex(tipX, baseY + sway + spread);
  p.vertex(baseX - size * FISH_TAIL_LENGTH * 0.6, baseY + sway * 0.6 + spread * 0.62);
  p.endShape('close');

  p.stroke(pale[0], pale[1], pale[2], 70);
  p.strokeWeight(Math.max(0.4, size * 0.025));
  for (const ray of FISH_TAIL_RAYS) {
    const lobe = 0.62 + Math.abs(ray) * 0.34;
    p.line(
      baseX,
      baseY,
      baseX - size * FISH_TAIL_LENGTH * lobe,
      baseY + sway * lobe + ray * spread * lobe,
    );
  }
}

/**
 * Drawn back to front in the jellyfish's manner: a faint glow, translucent fins with
 * rays, then a body with a dark back, pale belly and pale rim, its details on top.
 * The swimming bend is a travelling wave down the spine that grows toward the tail,
 * after Nature of Code's oscillation chapter.
 */
function drawFish(p: P5Like, fish: Fish): void {
  const [r, g, b] = fish.color;
  const size = fish.size * (1 + fish.boost * FISH_BOOST_SIZE_SCALE);
  const halfLength = size * FISH_HALF_LENGTH;
  const halfDepth = size * fish.bodyDepth;
  // Heading leftward rotates the body past vertical; this keeps its back on top, easing
  // through zero when the fish points straight up or down, as if seen from behind.
  const roll = Math.max(Math.min(Math.cos(fish.direction) * 3, 1), -1);
  // As with the jellyfish, smaller reads as farther away: fainter, and lost in the water.
  const depth = 0.7 + (0.3 * (fish.size - FISH_MIN_SIZE)) / (FISH_MAX_SIZE - FISH_MIN_SIZE);
  const pale: RgbColor = [r + (255 - r) * 0.55, g + (255 - g) * 0.55, b + (255 - b) * 0.55];
  const backSide = roll < 0 ? 1 : -1;

  for (let i = 0; i <= FISH_BODY_SEGMENTS; i++) {
    const t = i / FISH_BODY_SEGMENTS;
    fishSpine[i] = size * FISH_WAG * t * t * Math.sin(fish.swimPhase - t * 3.5);
  }

  p.push();
  p.translate(fish.x, fish.y);
  p.rotate(fish.direction);

  p.noStroke();
  for (const spread of FISH_GLOW) {
    p.fill(r, g, b, (4 + 12 * fish.boost) * depth);
    p.ellipse(-size * 0.1, 0, size * spread, size * spread * 0.6);
  }

  p.fill(r, g, b, 105 * depth);
  drawFishTail(p, size, halfLength, fish.swimPhase, pale);

  p.fill(r, g, b, 95 * depth);
  p.stroke(pale[0], pale[1], pale[2], 110 * depth);
  p.strokeWeight(Math.max(0.4, size * 0.03));
  traceFishFin(p, FISH_DORSAL, halfLength, halfDepth, backSide);
  traceFishFin(p, FISH_ANAL, halfLength, halfDepth, -backSide);

  p.noStroke();
  p.fill(r, g, b, 225 * depth);
  traceFishStrip(p, halfLength, halfDepth, -1, 1);
  p.fill(r * 0.5, g * 0.55, b * 0.7, 175 * depth);
  traceFishStrip(p, halfLength, halfDepth, -roll, -roll * 0.15);
  p.fill(pale[0], pale[1], pale[2], 135 * depth);
  traceFishStrip(p, halfLength, halfDepth, roll, roll * 0.3);

  p.noFill();
  p.stroke(pale[0], pale[1], pale[2], 150 * depth);
  p.strokeWeight(Math.max(0.5, size * 0.045));
  traceFishStrip(p, halfLength, halfDepth, -1, 1);

  // Lateral line and gill cover.
  p.stroke(pale[0], pale[1], pale[2], 75 * depth);
  p.strokeWeight(Math.max(0.4, size * 0.025));
  p.beginShape();
  for (let i = 3; i <= FISH_BODY_SEGMENTS; i++) p.vertex(fishBodyX(i, halfLength), fishSpine[i]);
  p.endShape();
  const gillX = fishBodyX(3, halfLength);
  const gillY = halfDepth * FISH_PROFILE[3] * 0.62;
  p.line(gillX + size * 0.05, fishSpine[3] - gillY, gillX - size * 0.06, fishSpine[3]);
  p.line(gillX - size * 0.06, fishSpine[3], gillX + size * 0.05, fishSpine[3] + gillY);

  // Pectoral fin, flapping at half the tail's beat.
  const finX = fishBodyX(4, halfLength);
  const finY = fishSpine[4] + halfDepth * 0.22 * roll;
  const flap = 0.5 + 0.5 * Math.sin(fish.swimPhase * 0.5);
  p.noStroke();
  p.fill(pale[0], pale[1], pale[2], 95 * depth);
  p.triangle(
    finX,
    finY - size * 0.05,
    finX - size * 0.42,
    finY + (size * 0.1 + size * 0.2 * flap) * roll,
    finX - size * 0.08,
    finY + size * 0.1 * roll,
  );

  // A top-lit sheen, as on the bell.
  p.fill(255, 255, 255, 38 * depth);
  p.ellipse(halfLength * 0.2, -halfDepth * 0.45 * roll, halfLength * 0.8, halfDepth * 0.4);

  const eyeX = fishBodyX(1, halfLength) - size * 0.04;
  const eyeY = fishSpine[1] - halfDepth * 0.2 * roll;
  const eye = size * 0.2;
  p.fill(pale[0], pale[1], pale[2], 235 * depth);
  p.ellipse(eyeX, eyeY, eye, eye);
  p.fill(8, 18, 28, 245);
  p.ellipse(eyeX, eyeY, eye * 0.62, eye * 0.62);
  p.fill(255, 255, 255, 220);
  p.ellipse(eyeX + eye * 0.14, eyeY - eye * 0.14 * roll, eye * 0.2, eye * 0.2);

  p.pop();
}

interface Jellyfish {
  /** Centre of the bell's margin, the point the bell tilts about. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Relaxed bell radius. */
  size: number;
  /** Thrust per frame of contraction. */
  speed: number;
  /** Bell's lean from upright, radians; thrust drives along it. */
  tilt: number;
  /** The lean this jellyfish drifts around while it isn't sinking. */
  wander: number;
  /** Depth it is heading for; picking a new one is what keeps them spread through the water. */
  targetY: number;
  retargetIn: number;
  /** Position within one pulse: 0 starts the contraction, 1 ends the relaxation. */
  pulsePhase: number;
  pulseRate: number;
  swayPhase: number;
  tentacleCount: number;
  /** Tentacle points then oral arm points, as interleaved canvas-space x, y. */
  chain: Float32Array;
  color: RgbColor;
  /** Normalized velocity boost from a nearby note-on; decays toward 0 each frame. */
  boost: number;
}

/** How far a jellyfish can paint above its margin's centre: the bell tilted upright. */
function jellyfishReachAbove(size: number): number {
  return size * (1 + JELLYFISH_BOOST_SIZE_SCALE);
}

/** How far it can paint below: the widest bell tilted over, then a tentacle hanging straight. */
function jellyfishReachBelow(size: number): number {
  return size * (1 + JELLYFISH_BOOST_SIZE_SCALE) * 1.1 + size * TENTACLE_LENGTH;
}

function spawnJellyfish({ width, visHeight }: Bounds): Jellyfish {
  const size = randomRange(JELLYFISH_MIN_SIZE, JELLYFISH_MAX_SIZE);
  const above = jellyfishReachAbove(size);
  const below = jellyfishReachBelow(size);
  const x = randomRange(0, width);
  const y = clampVertical(randomRange(0, visHeight), above, below, visHeight);
  const tentacleCount = Math.floor(randomRange(12, 18));
  const jelly: Jellyfish = {
    x,
    y,
    vx: 0,
    vy: 0,
    size,
    speed: randomRange(0.05, 0.09),
    tilt: randomRange(-0.4, 0.4),
    wander: randomRange(-0.55, 0.55),
    targetY: clampVertical(randomRange(0, visHeight), above, below, visHeight),
    retargetIn: randomRange(300, 900),
    pulsePhase: Math.random(),
    pulseRate: randomRange(1 / 240, 1 / 150),
    swayPhase: randomRange(0, TWO_PI),
    tentacleCount,
    chain: new Float32Array((tentacleCount * TENTACLE_POINTS + ARM_COUNT * ARM_POINTS) * 2),
    color: JELLYFISH_COLORS[Math.floor(Math.random() * JELLYFISH_COLORS.length)],
    boost: 0,
  };
  // Start every chain hanging below the bell; the first update anchors them to the rim.
  for (let i = 0; i < jelly.chain.length; i += 2) {
    jelly.chain[i] = x;
    jelly.chain[i + 1] = y + i;
  }
  updateChains(jelly);
  return jelly;
}

/** 0 relaxed to 1 fully contracted, eased: a fast squeeze and then a slow release. */
function contractionOf(pulsePhase: number): number {
  const t =
    pulsePhase < JELLYFISH_CONTRACTION_SHARE
      ? pulsePhase / JELLYFISH_CONTRACTION_SHARE
      : (1 - pulsePhase) / (1 - JELLYFISH_CONTRACTION_SHARE);
  return t * t * (3 - 2 * t);
}

// The bell's silhouette through a pulse: a wide saucer relaxed, a tall narrow dome
// contracted, its margin tucking inward as it squeezes water out.
function bellRadius(jelly: Jellyfish, contraction: number): number {
  return jelly.size * (1 + jelly.boost * JELLYFISH_BOOST_SIZE_SCALE) * (1 - 0.22 * contraction);
}

function bellHeight(jelly: Jellyfish, contraction: number): number {
  return jelly.size * (1 + jelly.boost * JELLYFISH_BOOST_SIZE_SCALE) * (0.72 + 0.28 * contraction);
}

function bellTuck(contraction: number): number {
  return 0.1 + 0.28 * contraction;
}

/**
 * Follow-the-leader rope (no close match in the p5 examples or Nature of Code; the
 * nearest is its spring chains, without the per-point velocity): the first point is
 * pinned to the bell and each later one is pulled to a fixed distance from the point
 * ahead of it, so a chain trails the bell's motion, can never stretch, and hangs when
 * still. Its total length is therefore a hard limit on how far it reaches.
 */
function updateChain(
  chain: Float32Array,
  start: number,
  points: number,
  anchorX: number,
  anchorY: number,
  segment: number,
  sway: number,
): void {
  let px = anchorX;
  let py = anchorY;
  chain[start] = px;
  chain[start + 1] = py;
  for (let j = 1; j < points; j++) {
    const i = start + j * 2;
    const drift = (Math.sin(sway - j * 0.55) * TENTACLE_SWAY * j) / (points - 1);
    const dx = chain[i] + drift - px;
    const dy = chain[i + 1] + TENTACLE_HANG - py;
    const d = Math.hypot(dx, dy) || 1;
    px += (dx / d) * segment;
    py += (dy / d) * segment;
    chain[i] = px;
    chain[i + 1] = py;
  }
}

function updateChains(jelly: Jellyfish): void {
  const contraction = contractionOf(jelly.pulsePhase);
  const radius = bellRadius(jelly, contraction);
  const rim = radius * (1 - bellTuck(contraction));
  const cos = Math.cos(jelly.tilt);
  const sin = Math.sin(jelly.tilt);
  const { chain, size, swayPhase, tentacleCount, x, y } = jelly;

  // Tentacles fringe the whole margin, seen edge-on as a spread across the bell's width.
  const tentacleSegment = (size * TENTACLE_LENGTH) / (TENTACLE_POINTS - 1);
  for (let k = 0; k < tentacleCount; k++) {
    const across = (k / (tentacleCount - 1)) * 2 - 1;
    const anchorX = x + across * rim * cos;
    const anchorY = y + across * rim * sin;
    const start = k * TENTACLE_POINTS * 2;
    updateChain(chain, start, TENTACLE_POINTS, anchorX, anchorY, tentacleSegment, swayPhase + k);
  }

  // Oral arms leave from inside the bell, near its centre.
  const armSegment = (size * ARM_LENGTH) / (ARM_POINTS - 1);
  const armRise = -bellHeight(jelly, contraction) * 0.25;
  const armsStart = tentacleCount * TENTACLE_POINTS * 2;
  for (let a = 0; a < ARM_COUNT; a++) {
    const across = ((a / (ARM_COUNT - 1)) * 2 - 1) * radius * ARM_SPREAD;
    const anchorX = x + across * cos - armRise * sin;
    const anchorY = y + across * sin + armRise * cos;
    const start = armsStart + a * ARM_POINTS * 2;
    updateChain(chain, start, ARM_POINTS, anchorX, anchorY, armSegment, swayPhase * 0.7 + a * 2);
  }
}

/**
 * Pulse-driven swimming: thrust only during the contraction, along the bell's lean,
 * with drag and a slight sink between pulses. A jellyfish above its target depth
 * rolls onto its side and pulses weakly, so it sinks; below it, it rights itself
 * and climbs. Oscillation after Nature of Code's oscillation chapter, reshaped into
 * an asymmetric pulse.
 */
function updateJellyfish(jelly: Jellyfish, { width, visHeight }: Bounds, speedScale: number): void {
  jelly.boost *= BOOST_DECAY;
  const above = jellyfishReachAbove(jelly.size);
  const below = jellyfishReachBelow(jelly.size);

  jelly.pulsePhase +=
    jelly.pulseRate * speedScale * (1 + jelly.boost * JELLYFISH_BOOST_PULSE_SCALE);
  jelly.pulsePhase %= 1;
  jelly.swayPhase += 0.035 * speedScale;

  jelly.retargetIn -= speedScale;
  if (jelly.retargetIn <= 0) {
    jelly.retargetIn = randomRange(300, 900);
    jelly.wander = randomRange(-0.55, 0.55);
    jelly.targetY = randomRange(0, visHeight);
  }
  jelly.targetY = clampVertical(jelly.targetY, above, below, visHeight);

  const sinking = Math.min(Math.max((jelly.targetY - jelly.y) / JELLYFISH_SINK_ZONE, 0), 1);
  const rollSide = jelly.wander < 0 ? -1 : 1;
  const tiltGoal = jelly.wander + rollSide * sinking * JELLYFISH_ROLL;
  jelly.tilt += (tiltGoal - jelly.tilt) * JELLYFISH_ROLL_EASING * speedScale;

  if (jelly.pulsePhase < JELLYFISH_CONTRACTION_SHARE) {
    const thrust = jelly.speed * speedScale * (1 + jelly.boost) * (1 - 0.5 * sinking);
    jelly.vx += Math.sin(jelly.tilt) * thrust;
    jelly.vy -= Math.cos(jelly.tilt) * thrust;
  }
  jelly.vy += JELLYFISH_SINK * speedScale;
  jelly.vx *= JELLYFISH_DRAG;
  jelly.vy *= JELLYFISH_DRAG;

  const movedX = jelly.x + jelly.vx;
  const movedY = jelly.y + jelly.vy;
  jelly.y = clampVertical(movedY, above, below, visHeight);
  if (jelly.y !== movedY) jelly.vy = 0;

  // The tentacles are in canvas space: a wrap must carry them, or they'd whip across the canvas.
  jelly.x = wrapHorizontal(movedX, below, width);
  const wrapped = jelly.x - movedX;
  if (wrapped !== 0) {
    for (let i = 0; i < jelly.chain.length; i += 2) jelly.chain[i] += wrapped;
  }

  updateChains(jelly);
}

/** Traces the bell: over the dome, then back along an arched, scalloped margin. */
function traceBell(p: P5Like, radius: number, height: number, tuck: number, scallop: number): void {
  p.beginShape();
  for (let i = 0; i <= BELL_SEGMENTS; i++) {
    const shoulder = 1 - DOME_SIN[i];
    p.vertex(radius * DOME_COS[i] * (1 - tuck * shoulder * shoulder), -height * DOME_LIFT[i]);
  }
  const rim = radius * (1 - tuck);
  for (let i = 1; i < BELL_MARGIN_SEGMENTS; i++) {
    const across = (i / BELL_MARGIN_SEGMENTS) * 2 - 1;
    const arch = -height * BELL_MARGIN_ARCH * (1 - across * across);
    const lobe = Math.abs(Math.sin(((across + 1) / 2) * PI * BELL_SCALLOPS));
    p.vertex(rim * across, arch + lobe * scallop);
  }
  p.endShape('close');
}

function drawTentacles(p: P5Like, jelly: Jellyfish, depth: number, pale: RgbColor): void {
  const { chain, size, tentacleCount } = jelly;
  for (let j = 0; j < TENTACLE_POINTS - 1; j++) {
    const fade = 1 - j / (TENTACLE_POINTS - 1);
    p.stroke(pale[0], pale[1], pale[2], 110 * depth * fade);
    p.strokeWeight(Math.max(0.5, size * 0.035 * fade));
    for (let k = 0; k < tentacleCount; k++) {
      const i = (k * TENTACLE_POINTS + j) * 2;
      p.line(chain[i], chain[i + 1], chain[i + 2], chain[i + 3]);
    }
  }
}

/** Oral arms: a pair of ruffled edges either side of each chain, like a frilled ribbon. */
function drawArms(p: P5Like, jelly: Jellyfish, depth: number, pale: RgbColor): void {
  const { chain, size, swayPhase, tentacleCount } = jelly;
  const armsStart = tentacleCount * TENTACLE_POINTS * 2;
  const frill = size * ARM_FRILL;
  for (let edge = -1; edge <= 1; edge += 2) {
    for (let a = 0; a < ARM_COUNT; a++) {
      const start = armsStart + a * ARM_POINTS * 2;
      for (let j = 0; j < ARM_POINTS - 1; j++) {
        const i = start + j * 2;
        const dx = chain[i + 2] - chain[i];
        const dy = chain[i + 3] - chain[i + 1];
        const d = Math.hypot(dx, dy) || 1;
        const nx = -dy / d;
        const ny = dx / d;
        const taper = 1 - j / (ARM_POINTS - 1);
        const ruffleA = edge * frill * taper * (0.6 + 0.4 * Math.sin(j * 2.3 + swayPhase * 2 + a));
        const ruffleB =
          edge *
          frill *
          (taper - 1 / (ARM_POINTS - 1)) *
          (0.6 + 0.4 * Math.sin((j + 1) * 2.3 + swayPhase * 2 + a));
        p.stroke(pale[0], pale[1], pale[2], (55 + 95 * taper) * depth);
        p.strokeWeight(Math.max(0.6, size * 0.06 * taper));
        p.line(
          chain[i] + nx * ruffleA,
          chain[i + 1] + ny * ruffleA,
          chain[i + 2] + nx * ruffleB,
          chain[i + 3] + ny * ruffleB,
        );
      }
    }
  }
}

/** Lines from the apex to the margin, following the dome: the veins seen through the bell. */
function drawRadialCanals(p: P5Like, radius: number, height: number, tuck: number): void {
  for (const across of RADIAL_CANALS) {
    p.beginShape();
    for (let i = 0; i <= RADIAL_CANAL_SEGMENTS; i++) {
      const t = (i / RADIAL_CANAL_SEGMENTS) * (PI / 2);
      const down = i / RADIAL_CANAL_SEGMENTS;
      p.vertex(
        across * radius * Math.sin(t) * (1 - tuck * down * down),
        -height *
          Math.pow(Math.cos(t), 0.85) *
          (1 - BELL_MARGIN_ARCH * (1 - across * across) * down),
      );
    }
    p.endShape();
  }
}

/**
 * Modelled on a moon jelly seen side-on, drawn back to front: tentacles and oral arms,
 * the glow around the bell, the bell's translucent body, the darker cavity inside it,
 * the gonad rings and radial canals showing through, and a highlight on top.
 */
function drawJellyfish(p: P5Like, jelly: Jellyfish): void {
  const [r, g, b] = jelly.color;
  const contraction = contractionOf(jelly.pulsePhase);
  const radius = bellRadius(jelly, contraction);
  const height = bellHeight(jelly, contraction);
  const tuck = bellTuck(contraction);
  // The smaller a jellyfish, the farther away it reads: fainter, and lost in the water.
  const depth =
    0.65 + (0.35 * (jelly.size - JELLYFISH_MIN_SIZE)) / (JELLYFISH_MAX_SIZE - JELLYFISH_MIN_SIZE);
  const pale: RgbColor = [r + (255 - r) * 0.55, g + (255 - g) * 0.55, b + (255 - b) * 0.55];

  p.push();
  drawTentacles(p, jelly, depth, pale);
  drawArms(p, jelly, depth, pale);

  p.translate(jelly.x, jelly.y);
  p.rotate(jelly.tilt);

  p.noStroke();
  // Stacked faint discs read as a soft glow without a costly blur; a note brightens it.
  for (const spread of JELLYFISH_GLOW) {
    p.fill(r, g, b, (6 + 8 * jelly.boost) * depth);
    p.ellipse(0, -height * 0.45, radius * spread, height * spread);
  }

  p.fill(r, g, b, 78 * depth);
  p.stroke(pale[0], pale[1], pale[2], 165 * depth);
  p.strokeWeight(Math.max(0.8, jelly.size * 0.04));
  traceBell(p, radius, height, tuck, jelly.size * BELL_SCALLOP);

  p.noStroke();
  p.fill(r * 0.45, g * 0.5, b * 0.65, 70 * depth);
  traceBell(p, radius * 0.76, height * 0.74, tuck, 0);

  p.noFill();
  p.stroke(pale[0], pale[1], pale[2], 125 * depth);
  p.strokeWeight(Math.max(0.8, jelly.size * 0.05));
  for (const across of GONADS) {
    const foreshortened = 1 - Math.abs(across) * 0.7;
    p.ellipse(across * radius, -height * 0.58, radius * 0.34 * foreshortened, height * 0.3);
  }

  p.stroke(pale[0], pale[1], pale[2], 60 * depth);
  p.strokeWeight(Math.max(0.5, jelly.size * 0.02));
  drawRadialCanals(p, radius, height, tuck);

  p.noStroke();
  p.fill(255, 255, 255, 34 * depth);
  p.ellipse(-radius * 0.32, -height * 0.72, radius * 0.7, height * 0.3);

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
  p.strokeWeight(1);
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
    for (const jelly of this.jellyfish) updateJellyfish(jelly, bounds, speedScale);
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
    for (const jelly of this.jellyfish) drawJellyfish(p, jelly);
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
