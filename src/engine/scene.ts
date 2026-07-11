import type { P5Like } from './types';

export type ParamType = 'range' | 'toggle' | 'color' | 'select';

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: ParamOption[];
}

export type ParamValue = number | boolean | string;

export interface NoteEvent {
  note: number;
  name: string;
  velocity: number;
  raw: number;
  channel: number;
}

export interface SceneContext {
  p: P5Like;
  width: number;
  height: number;
  chromaKeyHeight: number;
  params: Record<string, ParamValue>;
  elapsed: number;
  deltaTime: number;
}

export interface Scene {
  readonly id: string;
  readonly label: string;
  readonly params: ParamSpec[];
  setup(ctx: SceneContext): void;
  update(ctx: SceneContext): void;
  draw(ctx: SceneContext): void;
  onNoteOn(event: NoteEvent, ctx: SceneContext): void;
  onNoteOff(event: NoteEvent, ctx: SceneContext): void;
  teardown(): void;
}
