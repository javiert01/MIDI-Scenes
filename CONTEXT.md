# MIDI Visualizer

A browser app that turns live MIDI-keyboard playing into real-time visuals on an
HTML canvas. This glossary pins down the vocabulary the code and conversations use.

## Language

**Scene**:
A self-contained, switchable visualization — its own background, elements, and
response to MIDI (e.g. the underwater world of fish, jellyfish, and crystals). The
unit the user picks from the sidebar. Implements a fixed interface
(`setup / update / draw / onNoteOn / onNoteOff / teardown`).
_Avoid_: Animation, mode, theme, effect.

**Animation**:
The motion of a single element *within* a Scene (a fish's swim path, a jellyfish's
pulse). A Scene composes many animations. Not a synonym for Scene.
_Avoid_: Using it to mean the whole visualization.

**Scene Registry**:
The catalog of all available Scenes that the sidebar lists and the engine switches
between. Exactly one Scene is active at a time.

**VisualizerEngine**:
The framework-agnostic core that owns the single p5 instance, the Scene Registry,
and MIDI routing. Exposes an imperative API (select Scene, set parameters, select
device) plus a subscribe channel. Knows nothing about React.
_Avoid_: App, controller, manager.

**Active Scene**:
The one Scene the engine is currently running and drawing. Switching Scenes swaps
which Scene the render loop calls — the canvas itself is never torn down.

**Device**:
A connected MIDI input (a keyboard/controller), enumerated and hot-plug-tracked so
the user can pick one from the sidebar.
_Avoid_: Controller (ambiguous with UI/code controllers), input, instrument.

**Chroma Key area**:
The green-filled bottom third of the canvas, kept for compositing piano-hands
footage under the visualization in a video editor.
_Avoid_: Green screen, mask.
