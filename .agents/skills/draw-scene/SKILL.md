---
name: draw-scene
description: Construct a new Scene for the MIDI Visualizer's VisualizerEngine. Use when the user wants to add, create, draw, or design a new Scene or visualization (e.g. "let's make a forest scene", "add a new visualization").
---

# Draw Scene

A Scene is never freehanded straight into code — it's elicited, grounded in prior art, then built
against a fixed contract. All requirements, the type contract, and the elicitation questions live
in [docs/agents/scene-authoring.md](../../../docs/agents/scene-authoring.md) — that file is the
single source of truth; this skill sequences the steps that consult it.

## Step 1 — Elicit the concept

Before writing any code, work through the **Questions to ask before building** section of
`docs/agents/scene-authoring.md` with the user: concept, elements, population ranges, movement,
color/theme params, other params, note-on/note-off reactions, background rendering, idle behavior.

Completion criterion: every question in that section has a concrete answer (not "we'll figure it
out later"). If the user has already answered some in the current conversation, don't re-ask —
just confirm the remainder.

## Step 2 — Ground the motion in prior art

Read the **Reference implementations** section of `docs/agents/scene-authoring.md`. Match the
scene's concept to a chapter/example in [p5.js examples](https://p5js.org/examples/) or
[The Nature of Code](https://natureofcode.com/), and decide how its structure adapts to this
repo's `Scene` interface.

Completion criterion: you can name the specific reference each element's motion is based on, or
you've stated explicitly that no close match exists — never proceed to Step 3 having silently
freehanded the motion.

## Step 3 — Implement against the contract

Read `docs/adr/0003-scene-interface.md` for the exact `Scene`/`ParamSpec`/`SceneContext` types,
and open `src/scenes/UnderwaterScene.ts` and `src/scenes/StarfieldScene.ts` as worked examples —
same file structure (spawn/update/draw helpers per element kind, a scene class wiring the
lifecycle), same reference-credit comment style.

Build the scene, then register it in `src/scenes/index.ts`. Check it against every item in the
**Requirements** section of `docs/agents/scene-authoring.md` (bounds, interface conformance,
bounded customization, performance budget, note reactivity, Crystals draw-order, clean teardown)
one by one — treat any unchecked item as unfinished, not a follow-up.

Completion criterion: all seven Requirements hold, the scene is registered, and the reference
credit from Step 2 is a short comment near the relevant function(s).

## Step 4 — Verify

Run the project's type check and test suite. If the scene has motion/behavior tests, follow the
patterns in `UnderwaterScene.test.ts`. Manually reason through the performance budget at each
range param's `max` value — flag it if a max setting couldn't plausibly hold 60fps.

Completion criterion: type check and tests pass, and the performance budget has been checked at
max params, not just at defaults.
