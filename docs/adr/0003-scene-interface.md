# Scene interface: `SceneContext`, `NoteEvent`, `ParamSpec`, lifecycle contract

Every visualization implements a fixed `Scene` interface so the `VisualizerEngine`
can register, switch, and drive any Scene uniformly through the Scene Registry,
without special-casing. This pins the exact contract (types live in
`src/engine/scene.ts`).

```ts
type ParamType = 'range' | 'toggle' | 'color' | 'select'
interface ParamSpec {
  key: string
  label: string
  type: ParamType
  default: number | boolean | string
  min?: number; max?: number; step?: number   // range
  options?: { value: string; label: string }[] // select
}

interface NoteEvent {
  note: number      // 0..127
  name: string       // e.g. 'C4'
  velocity: number  // normalized 0..1 (0 on note-off)
  raw: number        // original 0..127 velocity
  channel: number
}

interface SceneContext {
  p: P5Like          // the shared p5 instance
  width: number
  height: number
  chromaKeyHeight: number
  params: Record<string, number | boolean | string>
  elapsed: number     // ms since this Scene's setup()
  deltaTime: number   // ms since last frame
}

interface Scene {
  readonly id: string
  readonly label: string
  readonly params: ParamSpec[]
  setup(ctx: SceneContext): void
  update(ctx: SceneContext): void
  draw(ctx: SceneContext): void
  onNoteOn(event: NoteEvent, ctx: SceneContext): void
  onNoteOff(event: NoteEvent, ctx: SceneContext): void
  teardown(): void
}
```

## Lifecycle contract

- `setup(ctx)` runs once when a Scene becomes the Active Scene (registration
  itself does not call it). A Scene allocates its own state here.
- `update(ctx)` then `draw(ctx)` run every frame while the Scene is active — the
  engine calls both in that order from the single p5 `draw` loop.
- `teardown()` runs once when a Scene stops being active (switched away from, or
  the engine is destroyed). A Scene frees its own resources here; it receives no
  `ctx` since there is nothing left to render into.
- `onNoteOn` / `onNoteOff` run only for the Active Scene, only for the currently
  selected MIDI Device (wired in a later ticket). Note→element mapping is a Scene's
  own concern — the engine has no knowledge of pianos, creatures, or stars.
- Scenes never read p5 globals, `frameCount`, or window size directly — every
  lifecycle method receives current dimensions and timing via `ctx`.

## Scene Registry

A `SceneRegistry` (`src/engine/SceneRegistry.ts`) holds the catalog of Scenes by
`id`. The `VisualizerEngine` owns one registry instance, built from the Scenes
passed in at construction; the sidebar reads `engine.scenes` to list them and
calls `engine.selectScene(id)` to switch. Exactly one Active Scene runs at a time.
Switching calls the outgoing Scene's `teardown()` then the incoming Scene's
`setup(ctx)` — the single, long-lived p5 instance (ADR-0002) is never recreated.

## Consequences

- Adding a Scene is a registration (construct it, add to the list passed to the
  engine), not UI surgery — the sidebar and engine drive any Scene the same way.
- `ctx.params` is seeded from each Scene's declared `ParamSpec[]` defaults at
  registration; auto-generating sidebar controls from that schema is a later
  ticket (T7) — this ADR only pins the shape.
- MIDI dispatch to `onNoteOn`/`onNoteOff` is wired in a later ticket (T3); the
  Starfield Scene implements both now so the interface is exercised uniformly,
  but nothing calls them yet.
