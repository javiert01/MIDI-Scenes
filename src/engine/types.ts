/** The subset of a p5 instance the engine needs. Lets tests inject a stub. */
export interface P5Like {
  width: number;
  height: number;
  setup?: () => void;
  draw?: () => void;
  createCanvas(w: number, h: number): void;
  noStroke(): void;
  stroke(...args: number[]): void;
  strokeWeight(weight: number): void;
  background(...args: number[]): void;
  fill(...args: number[]): void;
  rect(x: number, y: number, w: number, h: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  ellipse(x: number, y: number, w: number, h: number): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  millis(): number;
  remove(): void;
}

export type P5Sketch = (p: P5Like) => void;

export type P5Factory = (sketch: P5Sketch, node: HTMLElement) => P5Like;
