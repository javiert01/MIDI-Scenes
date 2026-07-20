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
_Avoid_: Using it to mean the whole visualization. (A Crystal is *not* an Animation
— it is an Overlay, owned by the engine, not by any Scene.)

**Overlay**:
An engine-owned visual layer drawn independently of the Active Scene, present
regardless of which Scene runs (or whether none does). The Chroma Key band, the
Piano Preview, and the Crystals are Overlays. Unlike Scenes, Overlays are not
mutually exclusive — they coexist with any Scene and with No Scene.
_Avoid_: Scene (an Overlay is never selected from the Scene list), layer (too vague).

**Crystal**:
A note-reactive Overlay: a shaft that spawns at a pressed key's column, grows while
the key is held, then falls and fades — staying within the visualization area,
never entering the Chroma Key band. The engine owns every Crystal's state so they
appear on every Scene and on No Scene; a Scene may choose *where* in its own draw
order to render them (Underwater draws them behind its creatures), otherwise the
engine draws them on top.
_Avoid_: Animation (a Crystal is no longer scoped to one Scene), particle.

**Piano Preview**:
A reactive keyboard Overlay filling the Chroma Key band — a stand-in for the
piano-hands footage, so the composition can be judged before recording. Held keys
light up; white keys are labelled with note letters (and octave on each C). Shares
the keyboard geometry that positions Crystals, so each key sits below its Crystal's
column. Toggleable, default off; while shown it covers the green.
_Avoid_: Piano (it is a preview stand-in, not an instrument the user plays).

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

**Virtual Input**:
A coexisting source of synthetic note events, letting the user play notes without a
physical MIDI Device — for testing Scenes and Crystals. Two surfaces feed it: the
computer keyboard (keys mapped to notes) and clicking keys on the Piano Preview.
Unlike a Device it is not enumerated or hot-plug-tracked and never appears in the
Device list; it is always present, gated by a single enable toggle (default off).
Its note events flow into the same routing a Device's do, so Scenes, Crystals, and
the Piano Preview react identically no matter which source a note came from.
_Avoid_: Device (a Virtual Input is never listed or selected), Virtual Device,
Piano (the Piano Preview is a surface the Virtual Input is played *through*, not an
instrument).

**Chroma Key area**:
The green-filled bottom third of the canvas, kept for compositing piano-hands
footage under the visualization in a video editor. An Overlay. The Piano Preview,
when shown, fills this same band and covers the green.
_Avoid_: Green screen, mask.

**No Scene**:
A selectable "empty" state in the Scene list: no Active Scene draws, leaving only
the background and the Overlays (Crystals, Piano Preview, Chroma Key). Chosen when
composing a recording from the Overlays alone.
_Avoid_: Blank, off (it is a first-class choice, remembered like any Scene).
