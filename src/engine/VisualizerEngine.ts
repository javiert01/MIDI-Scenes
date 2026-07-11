import p5 from 'p5';
import type { P5Factory, P5Like } from './types';

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 800;
const CHROMA_KEY_RATIO = 1 / 3;

const BACKGROUND_GRAY = 10;
const CHROMA_KEY_GREEN: [number, number, number] = [0, 177, 64];

export const defaultP5Factory: P5Factory = (sketch, node) =>
  new p5(sketch, node) as unknown as P5Like;

export interface VisualizerEngineOptions {
  width?: number;
  height?: number;
  chromaKeyRatio?: number;
  createP5?: P5Factory;
}

/**
 * Framework-agnostic core that owns the single p5 instance. Created once at
 * startup; Scene switching (later tickets) never tears down this instance.
 */
export class VisualizerEngine {
  readonly width: number;
  readonly height: number;
  readonly visualizationHeight: number;
  readonly chromaKeyHeight: number;

  private readonly p: P5Like;

  constructor(container: HTMLElement, options: VisualizerEngineOptions = {}) {
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.chromaKeyHeight = this.height * (options.chromaKeyRatio ?? CHROMA_KEY_RATIO);
    this.visualizationHeight = this.height - this.chromaKeyHeight;

    const createP5 = options.createP5 ?? defaultP5Factory;
    this.p = createP5((p) => {
      p.setup = () => {
        p.createCanvas(this.width, this.height);
      };
      p.draw = () => {
        this.renderFrame(p);
      };
    }, container);
  }

  /** Stops the draw loop and removes the p5 canvas. Call on unmount. */
  destroy(): void {
    this.p.remove();
  }

  private renderFrame(p: P5Like): void {
    p.background(BACKGROUND_GRAY);
    p.noStroke();
    p.fill(...CHROMA_KEY_GREEN);
    p.rect(0, this.visualizationHeight, this.width, this.chromaKeyHeight);
  }
}
