import type { NoteEvent, ParamSpec, Scene, SceneContext } from '@/engine/scene';

interface Star {
  x: number;
  y: number;
  z: number;
  pz: number;
}

const DEFAULT_STAR_COUNT = 200;
const DEFAULT_SPEED = 8;
const NOTE_BURST_MULTIPLIER = 3;
const NOTE_BURST_DURATION_MS = 250;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function spawnStar(width: number, height: number): Star {
  const z = randomRange(1, width);
  return { x: randomRange(-width, width), y: randomRange(-height, height), z, pz: z };
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
    this.stars = Array.from({ length: count }, () => spawnStar(ctx.width, ctx.height));
    this.burstUntilElapsed = 0;
    this.burstMultiplier = 1;
  }

  update(ctx: SceneContext): void {
    const speed = this.currentSpeed(ctx);
    for (const star of this.stars) {
      star.pz = star.z;
      star.z -= speed;
      if (star.z < 1) {
        const fresh = spawnStar(ctx.width, ctx.height);
        star.x = fresh.x;
        star.y = fresh.y;
        star.z = ctx.width;
        star.pz = star.z;
      }
    }
  }

  draw(ctx: SceneContext): void {
    const { p, width, height } = ctx;
    const cx = width / 2;
    const cy = height / 2;
    p.stroke(255);
    for (const star of this.stars) {
      const sx = cx + (star.x / star.z) * cx;
      const sy = cy + (star.y / star.z) * cy;
      const px = cx + (star.x / star.pz) * cx;
      const py = cy + (star.y / star.pz) * cy;
      const r = Math.max(0, 4 - (star.z / width) * 4);
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
