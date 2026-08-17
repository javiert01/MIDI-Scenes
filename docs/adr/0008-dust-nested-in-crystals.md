# Dust is nested inside the Crystals Overlay, not an Overlay of its own

A Crystal now dissolves into **Dust** (see `CONTEXT.md`) when it reaches the
visualization area's bottom edge — luminous flecks that rise on a sine path and
fade out mid-air. Dust is engine-owned and Scene-independent, which is exactly the
definition of an Overlay under ADR-0004, so the obvious move would be to make it a
fourth Overlay beside the Crystals, the Piano Preview, and the Chroma Key band. We
deliberately do not.

## Decision

- **`CrystalField` owns a private `DustField`.** Dust lives in its own module
  (`crystalDust.ts`, unit-tested in isolation like `previewSynth.ts` /
  `virtualKeyboard.ts`), but nothing outside `CrystalField` holds a reference to
  it. The engine keeps its single handle — `crystals.update() / draw() / reset()`.

- **No new seams.** `SceneContext` gains no `drawDust()`, the ADR-0004 render order
  is unchanged, `PersistedStateV1` gains no field, and the sidebar gains no control.
  Every existing Scene keeps working untouched.

- **Dust inherits everything from its parent.** The Crystals visibility toggle, the
  global Crystals opacity, `reset()` on resolution change, and — the one that
  actually matters — the Scene-chosen z-order. Underwater calls
  `ctx.drawCrystals()` after the water and before its creatures; Dust renders in
  that same call, so it sits behind the fish exactly as the shafts do, with no
  second placement decision for a Scene to get wrong.

- **Emission is driven from consumption.** `CrystalField` already computes how much
  of a shaft is clipped away at the floor each frame; that figure drives the
  emission rate directly. The two systems are coupled at birth, so an interface
  between them would be ceremony around a number one of them already has.
  _(Amended — see below. Consumption is now one of two emission rules, and the
  figure crossing the boundary is a fleck count rather than a height.)_

This is the surprising part worth recording: a future reader who knows ADR-0004
will look at an engine-owned, Scene-independent visual layer with no toggle, no
persisted state and no render slot, and reasonably conclude it was an oversight. It
was not.

## Considered options

- **Dust as a peer Overlay**, with its own visibility toggle, opacity, persisted
  fields and `ctx.drawDust()` seam. The symmetric choice, consistent with ADR-0004,
  and the only one that allows independent z-order — Dust drifting in *front* of
  Underwater's fish while the shafts stay behind them. Rejected: Dust has no meaning
  apart from the Crystal that sheds it, so a control that hides Dust while Crystals
  still fall describes a state nobody wants; and the independent z-order is a
  hypothetical we would pay for on every Scene, in the sidebar and in persisted
  state, up front.

- **Dust inline in `crystals.ts`.** Fewest moving parts. Rejected: it makes one file
  two systems, and a fleck's own physics — sine path, lifespan, pool recycling —
  could then only be tested through the shaft lifecycle rather than directly.

## Consequences

- Dust can never be toggled or dimmed independently of the Crystals. Promoting it to
  a peer Overlay later means adding the seam, the persisted fields, the sidebar rows
  and an ADR-0004 amendment — real work, chosen knowingly.
- The Crystals Overlay's draw cost rises from one `rect` per crystal to roughly four
  draw calls per crystal plus two per airborne Dust fleck, all inside the same
  `drawCrystals()` call a Scene already places. The fleck pool is fixed-size and
  recycles its oldest entries, so that cost has a ceiling regardless of playing
  density.
- `CrystalField`'s floor-clipping stays the single enforcement point for the
  ADR-0004 band invariant: Dust is clipped by the same `visHeight` clamp, so
  "nothing this Overlay draws has `y + h > visHeight`" remains one rule with one
  test.

## Amendment: the boundary carries flecks, not height

Held shafts now shed Dust too (a slow trickle once the tip rests on the floor, so a
sustained chord reads as "still holding" against a released shaft's full stream).
That breaks the assumption under "Emission is driven from consumption": a held shaft
is anchored at the top and grows downward, so the floor never consumes it and there
is no height figure to drive anything with. Its rate is per-frame instead.

So the nesting decision stands unchanged — `DustField` is still private to
`CrystalField`, still has no seam, control or render slot of its own — but the
number crossing between them moves up a level:

- **`DustField.emit` takes a fleck count**, not pixels consumed. It banks the
  fraction and sheds whole flecks; it holds no opinion on what a shaft is worth.
- **Both rate rules live in `crystals.ts`** — `FLECKS_PER_PIXEL_CONSUMED` for a
  falling shaft, `HELD_TRICKLE_FLECKS_PER_FRAME` for a held one. That is where the
  shaft states are known, so it is where "how much Dust is this worth" belongs.

The original wording rejected "an interface between them" as ceremony around a
number one side already had. With two rules answering to different quantities,
there is no longer a single such number, and the fleck count is the one unit both
rules land on — so this is that same argument reaching a different answer under new
facts, not a reversal of it. `DustField` is thinner as a result, which is the trade
accepted here: it is closer to a fraction bank over a fleck pool, and the judgement
about what playing looks like sits wholly with the Crystals.
