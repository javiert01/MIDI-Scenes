import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';

interface Star {
  x: number;
  y: number;
  z: number;
  pz: number;
}

/** The visualization area a star streaks across — never the Chroma Key band. */
interface Bounds {
  width: number;
  visHeight: number;
}

const DEFAULT_STAR_COUNT = 200;
const DEFAULT_SPEED = 8;
const NOTE_BURST_MULTIPLIER = 3;
const NOTE_BURST_DURATION_MS = 250;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function boundsOf(ctx: SceneContext): Bounds {
  return { width: ctx.width, visHeight: ctx.height - ctx.chromaKeyHeight };
}

function spawnStar({ width, visHeight }: Bounds): Star {
  const z = randomRange(1, width);
  return { x: randomRange(-width, width), y: randomRange(-visHeight, visHeight), z, pz: z };
}

/** Revived from spaceStar.js; reacts to note-on with a brief speed burst. */
export class StarfieldScene implements Scene {
  readonly id = 'starfield';
  readonly label = 'Starfield';
  readonly params: ParamSpec[] = [
    {
      key: 'starCount',
      label: 'Star Count',
      type: 'range',
      default: DEFAULT_STAR_COUNT,
      min: 50,
      max: 400,
      step: 10,
    },
    {
      key: 'speed',
      label: 'Speed',
      type: 'range',
      default: DEFAULT_SPEED,
      min: 1,
      max: 20,
      step: 1,
    },
  ];

  private stars: Star[] = [];
  private burstUntilElapsed = 0;
  private burstMultiplier = 1;

  setup(ctx: SceneContext): void {
    const count = Number(ctx.params.starCount ?? DEFAULT_STAR_COUNT);
    const bounds = boundsOf(ctx);
    this.stars = Array.from({ length: count }, () => spawnStar(bounds));
    this.burstUntilElapsed = 0;
    this.burstMultiplier = 1;
  }

  update(ctx: SceneContext): void {
    const speed = this.currentSpeed(ctx);
    const bounds = boundsOf(ctx);
    for (const star of this.stars) {
      star.pz = star.z;
      star.z -= speed;
      if (star.z < 1) {
        const fresh = spawnStar(bounds);
        star.x = fresh.x;
        star.y = fresh.y;
        star.z = bounds.width;
        star.pz = star.z;
      }
    }
  }

  draw(ctx: SceneContext): void {
    const { p } = ctx;
    const { width, visHeight } = boundsOf(ctx);
    const cx = width / 2;
    const cy = visHeight / 2;
    p.stroke(255);
    for (const star of this.stars) {
      const px = cx + (star.x / star.pz) * cx;
      const py = cy + (star.y / star.pz) * cy;
      let sx = cx + (star.x / star.z) * cx;
      let sy = cy + (star.y / star.z) * cy;
      const r = Math.max(0, 4 - (star.z / width) * 4);
      // A streak's cap reaches half its weight past its end, so the floor stands that far up.
      const floor = visHeight - r / 2;
      // A star accelerates away from the centre, so its previous point is the nearer one.
      if (py > floor) continue;
      if (sy > floor) {
        sx = px + ((sx - px) * (floor - py)) / (sy - py);
        sy = floor;
      }
      p.strokeWeight(r);
      p.line(px, py, sx, sy);
    }
  }

  onNoteOn(event: NoteEvent, ctx: SceneContext): void {
    this.burstMultiplier = 1 + event.velocity * (NOTE_BURST_MULTIPLIER - 1);
    this.burstUntilElapsed = ctx.elapsed + NOTE_BURST_DURATION_MS;
  }

  onNoteOff(): void {
    // v1 Starfield reacts to note-on only.
  }

  teardown(): void {
    this.stars = [];
  }

  private currentSpeed(ctx: SceneContext): number {
    const base = Number(ctx.params.speed ?? DEFAULT_SPEED);
    return ctx.elapsed < this.burstUntilElapsed ? base * this.burstMultiplier : base;
  }
}
