# Engine-owned Overlays: Crystals, Piano Preview, and Scene-controlled crystal placement

The visualization needs elements that survive Scene switches: Crystals that react
to notes on *every* Scene (not just Underwater), and a Piano Preview standing in
for the piano-hands footage so a recording's composition can be judged in advance.
Neither is a Scene — both must coexist with whatever Scene runs, including No
Scene. We call such an engine-owned, Scene-independent visual layer an **Overlay**
(see `CONTEXT.md`). The pre-existing Chroma Key band is retroactively an Overlay.

## Decision

The `VisualizerEngine` owns Overlay state and lifecycle. Scenes stay ignorant of
Overlays except for one deliberate seam: **crystal placement**.

### Crystals

- The engine owns the Crystal pool: a note-on spawns a Crystal at the pressed
  key's column, it grows while held, then falls and deactivates at the
  visualization area's bottom edge (never entering the Chroma Key band).
- The engine dispatches note-on/note-off to the Crystal layer *and* to the Active
  Scene, independently — so Crystals react even on No Scene.
- **Rendering is delegated to the Active Scene when it opts in.** `SceneContext`
  exposes the current crystals plus a `drawCrystals()` helper. A Scene calls it
  wherever it wants in its own draw order (Underwater: after the water, before the
  creatures — so Crystals read as *behind* the fish). If the Scene does not draw
  them, and on No Scene, the engine draws them itself, on top of the Scene.
- Opacity is a single global value the sidebar controls; both the engine default
  and `drawCrystals()` honor it.
- UnderwaterScene loses its private Crystal pool (it keeps its fish/jellyfish
  note-boost). The key→column geometry that both Crystals and the Piano Preview
  need moves out of UnderwaterScene into a shared module.

### Piano Preview

- An engine Overlay filling the Chroma Key band, drawn last (topmost), covering the
  green while shown. Its own sidebar toggle, persisted, default off.
- Reactive: the engine feeds it note-on/note-off; held keys light up in their
  Crystal's half-color and clear on release.
- Uses the shared keyboard geometry, so each key sits below its Crystal's column.
  White keys are labelled with note letters; each C also shows its octave.

### No Scene

- A selectable entry in the Scene list representing "no Active Scene draws." First
  load still defaults to a real Scene; the choice is remembered like any Scene.

### Render order (per frame)

```
gray background
Active Scene update + draw        (Scene may call ctx.drawCrystals() internally)
engine-default Crystals           (only if the Scene did not draw them; No Scene included)
Piano Preview                     (if shown — fills band, covers green + Scene bleed)
  else Chroma Key green fill      (if Chroma Key shown)
```

## Consequences

- Extends the ADR-0003 Scene contract: `SceneContext` gains crystal access + a
  `drawCrystals()` helper. The `Scene` method set is unchanged — placement is
  opt-in via `ctx`, so existing Scenes keep working (they simply get engine-drawn
  Crystals on top).
- New persisted fields (Piano Preview toggle, Crystal toggle, Crystal opacity) join
  `PersistedStateV1`; absent fields fall back to defaults, so no version bump.
- Overlays are engine concerns, so the sidebar grows Crystal and Piano Preview
  controls alongside the existing Chroma Key toggle.
