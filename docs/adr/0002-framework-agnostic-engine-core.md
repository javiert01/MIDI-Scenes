# Framework-agnostic VisualizerEngine core; single persistent p5 instance

The React UI and the p5 render loop are decoupled through a plain-TypeScript
`VisualizerEngine` that owns the p5 instance, the Scene Registry, and MIDI routing.
React calls the engine imperatively and reflects its state via a subscribe channel;
it never renders into the canvas. Scene switching swaps the Active Scene on a *single,
long-lived* p5 instance rather than destroying/recreating a p5 instance per Scene.

## Consequences

- React re-renders can't reach the render loop, so UI updates can't jank the 60fps draw.
- The engine (MIDI parsing, Scene Registry, switching) is unit-testable headlessly — the
  reason Vitest is worth having.
- The canvas is never torn down on switch (no flicker); MIDI is wired once, not per Scene.
- Every visualization must be refactored to the `Scene` interface
  (`setup / update / draw / onNoteOn / onNoteOff / teardown`) and stop relying on p5
  global-mode functions and globals.
