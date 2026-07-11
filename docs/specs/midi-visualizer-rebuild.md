# Spec: MIDI Visualizer rebuild (v1)

> Staged locally because `gh` is not authenticated. Once authenticated, publish
> this body as a GitHub issue in `javiert01/MIDI-Scenes` and apply the
> `ready-for-agent` label. See "Publishing" at the end of this file.

## Problem Statement

I play a MIDI keyboard and want my playing to drive live visuals I can record and
composite piano-hands footage under. Today the visualizer is a static `index.html`
that loads p5.js and eleven global-scope scripts from a CDN. Only one visualization
(the underwater world) actually works; everything else is dormant or dead. There is
no way to switch between visualizations, pick which MIDI keyboard to use, tune a
visualization's look, or reliably reproduce a setup after a reload. The p5 global
mode, dead `package.json` scripts, a missing `style.css`, and no build tooling make
it impossible to grow into a real app.

## Solution

Rebuild the visualizer as a real web app: a **VisualizerEngine** (framework-agnostic
TypeScript) owns one long-lived p5.js instance in instance mode, the **Scene
Registry**, and MIDI routing; a thin React sidebar drives it imperatively and never
renders into the canvas. Each visualization becomes a **Scene** implementing a fixed
interface, so the engine can swap the **Active Scene** on the single canvas without
tearing it down. From the sidebar I can switch Scenes, pick my **Device**, tune each
Scene's parameters with auto-generated controls, toggle the **Chroma Key area**, go
fullscreen for capture, and see live MIDI activity. My whole setup is remembered
across reloads. v1 ships two Scenes — a fully ported Underwater Scene and a minimal
Starfield Scene that proves switching works.

Architecture and tooling are already fixed and are NOT re-opened here:
- `CONTEXT.md` — domain glossary (Scene, Animation, Scene Registry, VisualizerEngine,
  Active Scene, Device, Chroma Key area).
- ADR-0001 — Vite + React + TypeScript, p5.js in instance mode (via npm), WEBMIDI.js;
  strict TS for app/MIDI code, relaxed for sketch files; Vitest, ESLint + Prettier,
  `@/` path aliases.
- ADR-0002 — framework-agnostic VisualizerEngine owning a single persistent p5
  instance; React is a thin skin reflecting engine state via a subscribe channel.
- ADR-0003 (to be written as part of this work) — the exact Scene interface pinned
  below.

## User Stories

### Setup, scaffold & migration
1. As a developer, I want a Vite + React + TypeScript project with p5.js (instance
   mode), WEBMIDI.js, Vitest, ESLint + Prettier and `@/` path aliases installed via
   npm, so that the app has a real build/test/lint pipeline.
2. As a developer, I want the dead `package.json` scripts (the nonexistent
   `api/index.js` + webpack references) removed and replaced with working
   `dev`/`build`/`test`/`lint` scripts, so that the tooling reflects reality.
3. As a developer, I want the CDN `<script>` tags and p5 global mode removed, so that
   all code is bundled and module-scoped.
4. As a developer, I want `example.js` (a leftover OAuth serverless handler) and
   `star.js` (an empty stub whose `show()` is commented out) deleted, so that dead
   code doesn't confuse the rebuild.
5. As a developer, I want `firework.js`, `spring.js`, `particle.js`, and
   `spaceStar.js`'s original global-mode forms treated as reference material only,
   so that I port from them deliberately rather than loading them.

### VisualizerEngine core
6. As a developer, I want a `VisualizerEngine` that owns exactly one p5 instance
   created once at startup, so that Scene switches never tear down the canvas.
7. As a developer, I want the engine to expose an imperative API (select Scene, set a
   param, select Device, toggle chroma key, set resolution, serialize/restore state)
   plus a subscribe channel, so that React can drive it and reflect its state without
   touching the render loop.
8. As a developer, I want the engine's p5 instance to be injectable/stubbable, so
   that scene switching, params, MIDI routing, and persistence are unit-testable
   headlessly.
9. As a developer, I want the engine to run a per-frame loop that calls the Active
   Scene's `update(ctx)` then `draw(ctx)`, so that animation state and rendering stay
   cleanly separated.

### Scene Registry & switching
10. As a user, I want a list of all available Scenes in the sidebar, so that I can see
    what I can switch to.
11. As a user, I want exactly one Active Scene at a time, so that the canvas shows a
    single coherent visualization.
12. As a user, I want switching Scenes to be instant and flicker-free (canvas never
    torn down), so that it looks smooth on a recording.
13. As a developer, I want the engine to call the outgoing Scene's `teardown()` and the
    incoming Scene's `setup(ctx)` on switch, so that Scenes can allocate/free their own
    resources.
14. As a developer, I want Scenes registered in a Scene Registry the sidebar reads, so
    that adding a Scene is a registration, not UI surgery.

### Scene interface
15. As a developer, I want every Scene to implement `setup / update / draw / onNoteOn /
    onNoteOff / teardown`, so that the engine can drive any Scene uniformly.
16. As a developer, I want each lifecycle method to receive a `SceneContext`
    (`{ p, width, height, chromaKeyHeight, params, elapsed, deltaTime }`), so that
    Scenes never rely on p5 globals and always read current canvas dimensions.
17. As a developer, I want each Scene to expose a static declarative `params` schema
    (`ParamSpec[]`), so that the sidebar auto-builds controls and the engine can
    validate and persist values with no per-Scene UI code.
18. As a developer, I want a `ParamSpec` to support `range`, `toggle`, `color`, and
    `select` types with `key`, `label`, `default`, and the type's bounds
    (`min`/`max`/`step` or `options`), so that common visualization knobs are covered.
19. As a developer, I want current param values delivered to Scenes via `ctx.params`,
    so that a Scene reads a value the same way regardless of who set it.

### MIDI layer & routing
20. As a user, I want the app to enumerate my connected MIDI inputs as Devices, so
    that I can choose which keyboard drives the visuals.
21. As a user, I want to pick a single active Device from the sidebar, so that only my
    intended keyboard affects the visuals.
22. As a user, I want the app to auto-select the first available Device on startup when
    none is remembered, so that it "just works" when I only have one keyboard.
23. As a user, I want hot-plugging handled — if my Device is connected after load I can
    pick it, and if the active Device is unplugged the app falls back gracefully — so
    that I'm not forced to reload.
24. As a developer, I want the engine to normalize raw MIDI messages into a
    scene-agnostic `NoteEvent` (`{ note, name, velocity 0..1, raw 0..127, channel }`),
    so that Scenes never parse MIDI bytes.
25. As a developer, I want note-on with velocity 0 treated as note-off, so that
    keyboards that send it behave correctly.
26. As a developer, I want the engine to call `activeScene.onNoteOn(event, ctx)` /
    `onNoteOff(event, ctx)` only for the selected Device, so that routing is
    deterministic.
27. As a developer, I want each Scene to own its own note→element mapping, so that
    "nearest creature" is an internal detail of the Underwater Scene and other Scenes
    can map notes however they like.

### Underwater Scene (full port)
28. As a user, I want the underwater world (gradient water background, fish, jellyfish,
    crystals) ported to a Scene, so that my existing visualization keeps working.
29. As a user, I want a played note to spawn a crystal at that note's piano-key position
    and briefly boost the nearest creature, so that the visualization still reacts to my
    playing as it does today.
30. As a developer, I want the Underwater Scene to internalize the piano-key note→x/y
    position model (base note id 36, the white/black key layout) and the
    nearest-creature logic, so that this Underwater-specific behavior lives in the Scene,
    not the engine.
31. As a user, I want to tune the Underwater Scene (e.g. fish count, jellyfish count,
    creature speed, water color) from auto-generated sidebar controls, so that I can
    change its look without editing code.
32. As a developer, I want fish/jellyfish/crystal motion refactored off p5 globals
    (`frameCount`, `width`, `height`, `random`, drawing calls) to use the injected p5
    instance and `ctx`, so that the Scene works in instance mode.

### Starfield Scene (revived from spaceStar)
33. As a user, I want a second, minimal Starfield Scene, so that I can switch Scenes and
    confirm switching works.
34. As a user, I want played notes to visibly affect the Starfield (e.g. speed/burst on
    note-on), so that it's a real reactive Scene, not a static screen.
35. As a developer, I want the Starfield ported from `spaceStar.js` with its commented-out
    `show()` restored and refactored to the Scene interface, so that reviving it is cheap.

### Sidebar UI
36. As a user, I want a Scene switcher, so that I can change visualizations.
37. As a user, I want a MIDI Device picker, so that I can choose my keyboard.
38. As a user, I want auto-generated parameter controls for the Active Scene, so that I
    can tune it live.
39. As a user, I want a Chroma Key toggle, so that I can show/hide the green bottom third
    when compositing vs. previewing.
40. As a user, I want a fullscreen / present mode that hides the sidebar and shows only
    the canvas, so that I can record a clean frame.
41. As a user, I want a MIDI activity indicator (connection status + incoming notes), so
    that I can confirm my keyboard is wired without playing blind.
42. As a developer, I want the sidebar to reflect engine state via the subscribe channel
    and call the engine imperatively, so that UI re-renders never jank the 60fps draw.

### Canvas & Chroma Key area
43. As a user, I want the canvas to render at a fixed internal resolution (default
    1600×800, with a 1920×1080 preset), so that my captured pixels are predictable for
    compositing.
44. As a user, I want the canvas scaled with CSS to fit my window, so that a fixed-
    resolution buffer still fills the screen.
45. As a user, I want the viz/chroma split to stay ratio-based (top ⅔ visualization,
    bottom ⅓ Chroma Key area) at any resolution, so that the layout is consistent.
46. As a developer, I want resolution changes to flow to Scenes via `ctx`
    (`width/height/chromaKeyHeight`), so that Scenes re-layout without special-casing.
47. As a user, I want fullscreen to scale the same fixed buffer, so that fullscreen and
    windowed produce the same composition.

### Persistence
48. As a user, I want my active Scene, each Scene's param values, my selected Device (by
    name), the resolution preset, and the Chroma Key toggle remembered across reloads,
    so that I don't rebuild my setup every time.
49. As a user, I want a remembered Device that's absent on reload to fall back to the
    first available Device (keeping my other settings), so that an unplugged keyboard
    doesn't wipe my setup.
50. As a developer, I want persisted state stored under a single versioned localStorage
    key (`midiviz.v1`), so that future schema changes can be migrated or safely ignored.

### Documentation
51. As a developer, I want ADR-0003 written to pin the exact Scene interface
    (`SceneContext`, `NoteEvent`, `ParamSpec`, lifecycle contract), so that the contract
    every Scene depends on is recorded, not just implied.

## Implementation Decisions

### Modules built/modified
- **VisualizerEngine** (new, plain TS): owns the single p5 instance (created once,
  instance mode), the Scene Registry, the per-frame loop, MIDI routing, param state,
  and session serialize/restore. Exposes an imperative API + a subscribe channel.
  Framework-agnostic (no React import). The p5 instance is injectable so the engine is
  headless-testable.
- **MIDI layer** (new, inside/around the engine, WEBMIDI.js): enumerates Devices,
  tracks hot-plug, binds only the selected Device, and normalizes raw messages into
  `NoteEvent`s. Handles note-on/note-off only for v1.
- **Scene Registry** (new): catalog the sidebar lists and the engine switches between;
  exactly one Active Scene at a time.
- **Underwater Scene** (ported): fish, jellyfish, crystals, gradient water background,
  Chroma Key area; internalizes the piano-key note→position model and nearest-creature
  routing. Refactored off p5 globals to the injected p5 + `ctx`.
- **Starfield Scene** (revived from `spaceStar.js`): minimal reactive Scene; exists to
  exercise switching.
- **React sidebar** (new): Scene switcher, Device picker, auto-generated param controls,
  Chroma Key toggle, fullscreen/present mode, MIDI activity indicator. Thin skin over
  the engine.
- **Persistence adapter** (new, thin): reads/writes the engine's serialized state to
  `localStorage['midiviz.v1']` at the bootstrap/React boundary.

### Interfaces (the contract — ADR-0003)
```
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
  name: string      // e.g. 'C4'
  velocity: number  // normalized 0..1 (0 on note-off)
  raw: number       // original 0..127 velocity
  channel: number
}

interface SceneContext {
  p: p5            // the shared instance
  width: number
  height: number
  chromaKeyHeight: number
  params: Record<string, number | boolean | string>
  elapsed: number    // ms since scene setup
  deltaTime: number  // ms since last frame
}

interface Scene {
  readonly id: string
  readonly label: string
  // static/declared:
  params: ParamSpec[]
  // lifecycle:
  setup(ctx: SceneContext): void
  update(ctx: SceneContext): void
  draw(ctx: SceneContext): void
  onNoteOn(e: NoteEvent, ctx: SceneContext): void
  onNoteOff(e: NoteEvent, ctx: SceneContext): void
  teardown(): void
}
```

### Architectural decisions
- Single persistent p5 instance; Scene switch = swap which Scene the loop calls +
  `teardown()`/`setup()`. Canvas is never recreated.
- Engine normalizes MIDI; Scenes own note→element mapping. The engine has no knowledge
  of pianos, creatures, or stars.
- One active Device: engine binds message handlers to the selected Device only;
  auto-selects first available when none is remembered; on unplug of the active Device
  falls back to the first available (or none).
- Fixed internal render resolution (1600×800 default, 1920×1080 preset), CSS-scaled;
  viz/chroma split computed as ratios of height and delivered via `ctx`.
- Param values are validated/clamped against the Active Scene's `ParamSpec[]` before
  being applied and persisted.
- TypeScript strict for engine/MIDI/UI; relaxed for Scene sketch code (per ADR-0001).

### Persistence contract
- Single versioned key `midiviz.v1`, shape:
  `{ activeScene, params: { [sceneId]: { [key]: value } }, deviceName, resolution, chromaVisible }`.
- Restore applies remembered values, clamping params to current schemas and dropping
  unknown keys; a missing Device name falls back to first available.

## Testing Decisions

- **What makes a good test here:** exercise external behavior through the
  `VisualizerEngine` public API — never assert private fields or p5 draw calls.
  Rendering correctness (how a fish looks) is not unit-tested; it's verified by running
  the app.
- **Single seam — the `VisualizerEngine` public API**, tested headlessly with a stubbed/
  injected p5 and fake Scenes acting as spies. Coverage:
  - Scene Registry / switching: selecting a Scene makes it the Active Scene, calls the
    incoming `setup` and outgoing `teardown`, and never recreates p5.
  - Param schema: setting a param validates/clamps against `ParamSpec[]`; values reach
    `ctx.params`; invalid keys/values are rejected.
  - MIDI normalization + dispatch: feeding raw MIDI byte arrays produces the expected
    `NoteEvent` on the fake Scene's `onNoteOn`/`onNoteOff` (note→name, velocity 0..1,
    note-on-velocity-0 → note-off).
  - Device routing: only the selected Device's messages dispatch; unplug of the active
    Device triggers fallback.
  - Persistence: `serialize()` → `restore()` round-trips state; missing Device falls
    back; params clamp to current schemas.
- **Not unit-tested (verified manually via the running app / `/verify`):** Scene
  rendering output, the React sidebar chrome, fullscreen behavior, and CSS scaling.
- **Prior art:** none yet in this repo (fresh Vitest setup); establish these as the
  reference pattern for future Scene/engine tests.

## Out of Scope

- Additional MIDI messages: CC/knobs, pitch bend, sustain pedal (CC64), aftertouch.
- Porting `firework.js` / `spring.js` (and their `particle.js` dependency) — deferred
  behind the proven Scene interface as a later ticket.
- Param presets (named save/load per Scene) — deferred.
- Free-form user-entered canvas width/height — only the fixed-resolution presets ship.
- Fully responsive/window-driven canvas sizing.
- Release-velocity handling on note-off (v1 `NoteEvent.velocity` is 0 on note-off).
- Multiple simultaneous active Devices.
- Electron/Tauri packaging (rejected in ADR-0001).
- Audio synthesis / p5.sound — the app visualizes MIDI, it does not make sound.

## Further Notes

- Suggested ticket boundaries (for `/to-tickets`): scaffold Vite/React/TS + tooling →
  VisualizerEngine core (with injected p5) → MIDI layer (WEBMIDI.js, Device selection,
  `NoteEvent` normalization) → Scene Registry + Scene interface + ADR-0003 → port
  Underwater Scene → revive Starfield Scene → sidebar UI (switcher, Device picker,
  param controls, chroma toggle, fullscreen, activity indicator) → persistence.
- The current `piano.js` layout (`OCTAVE = 7`, base id 36, 35 white / 25 black keys)
  should be preserved inside the Underwater Scene as its note→position source.
- Web MIDI requires a secure context (localhost is fine for `vite dev`); Chrome is the
  target browser (ADR-0001).

## Publishing

`gh` was not authenticated when this spec was written. To publish:

```
gh auth login          # or set GH_TOKEN
gh issue create --repo javiert01/MIDI-Scenes \
  --title "Spec: MIDI Visualizer rebuild (v1)" \
  --body-file docs/specs/midi-visualizer-rebuild.md \
  --label ready-for-agent
```
(Trim this "Publishing" section from the issue body, or leave it — harmless.)
