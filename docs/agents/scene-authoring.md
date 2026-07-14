# Scene Authoring

Requirements and questions for constructing a new Scene (see `docs/adr/0003-scene-interface.md`
for the `Scene`/`ParamSpec`/`SceneContext` types, and `CONTEXT.md` for the Scene/Overlay/Crystal
glossary). Use `src/scenes/UnderwaterScene.ts` and `src/scenes/StarfieldScene.ts` as reference
implementations.

## Requirements

1. **Bounds** — all drawing stays within `{ width, height: ctx.height - ctx.chromaKeyHeight }`
   (the `boundsOf` pattern in `UnderwaterScene.ts`). Never draw into the Chroma Key band.
2. **Interface conformance** — implement `Scene` in full (`id`, `label`, `params`,
   `setup/update/draw/onNoteOn/onNoteOff/teardown`) and register it in `src/scenes/index.ts`. No
   lifecycle method may read p5 globals, `frameCount`, or window size directly — only `ctx`.
3. **Bounded customization** — every tunable is a `ParamSpec` (`range | toggle | color | select`)
   with a concrete `default`/`min`/`max`/`step`. No open-ended customization (no free-form
   scripting, no unbounded counts) since the sidebar auto-generates controls straight from this
   schema.
4. **Performance budget** — element counts and per-frame work must hold 60fps at the param's
   `max`. Concretely: cap population `max` (Underwater caps fish at 40, jellyfish at 20), avoid
   per-frame allocations in `update`/`draw`, avoid expensive p5 filters (blur/shadow).
5. **Note reactivity** — `onNoteOn`/`onNoteOff` must do *something* observable (spawn,
   boost-nearest, recolor, etc.) using `event.velocity` (normalized) and
   `keyPosition(event.note, ...)` for column-mapping. A scene that ignores notes entirely isn't a
   Scene, it's a screensaver.
6. **Crystals draw-order** — since Crystals are an engine-owned Overlay, the scene must explicitly
   decide where `ctx.drawCrystals()` sits in its own draw order (behind elements, like Underwater,
   or let it default to on-top).
7. **Clean teardown** — `teardown()` clears all scene-owned arrays/state; nothing leaks across a
   scene switch.

## Reference implementations

Before implementing a scene's elements, match the idea to prior art rather than inventing motion
math from scratch:

- **[p5.js examples](https://p5js.org/examples/)** — for canvas-level techniques: particle
  systems, noise fields, shaders, image/pixel manipulation, simple physics.
- **[The Nature of Code](https://natureofcode.com/)** — for organic motion/behavior: steering
  behaviors, flocking/boids, oscillation, springs, cellular automata, fractals, forces.

Pick whichever site's chapter/example matches the scene's concept (e.g. a school of fish →
flocking/steering behaviors in Nature of Code; a starfield/particle burst → p5.js particle-system
examples) and adapt its structure to this repo's `Scene` interface — same `update`/`draw` split,
same `ctx`-driven bounds and timing, no p5 globals. Note which reference(s) a scene's motion is
based on in a short comment near the relevant function(s), the same way `UnderwaterScene.ts`
credits its prior form (`fish.js`/`jellyfish.js`).

If neither reference has a close match, say so explicitly rather than silently freehanding the
motion — it's a signal the scene's concept may need to be simplified or reframed.

## Questions to ask before building

- **Concept**: one-line description of the world/theme (e.g. "underwater world of fish and
  jellyfish").
- **Elements**: what kinds of objects populate it, and how many *kinds* (Underwater: fish +
  jellyfish; Starfield: stars only)?
- **Population range**: default/min/max count per element kind (this is the main
  performance-bounded knob).
- **Movement**: does each element kind need multiple motion patterns (like fish's
  traveling/circling/wandering), or one consistent behavior?
- **Color/theme param(s)**: what's exposed as a `color` param — background only, or per-element
  too?
- **Other range/toggle/select params**: speed scale? size variance? pattern mix? anything
  scene-specific?
- **Note-on reaction**: spawn new element at the key's column, boost the nearest existing element,
  recolor, trigger a burst — pick one (or combine)?
- **Note-off reaction**: does anything happen, or (like Underwater) is release a no-op because
  Crystals already handle the visual feedback?
- **Background rendering**: static fill, gradient (like Underwater's per-row lerp), or something
  animated/particle-based?
- **Idle behavior**: should the scene look alive with no notes playing (ambient drift), or fully
  static until played?
