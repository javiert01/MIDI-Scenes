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
Piano Preview, and the Crystals are Overlays. Overlays coexist with any Scene and
with No Scene; they are independent of each other too, except that the Piano Preview
and the Chroma Key green share the Keyboard band and so are mutually exclusive.
_Avoid_: Scene (an Overlay is never selected from the Scene list), layer (too vague).

**Crystal**:
A note-reactive Overlay: a luminous glass rod that spawns at a pressed key's column,
grows while the key is held, then falls and dissolves into Dust — staying within the
visualization area, never entering the Chroma Key band. Its coloured body is dim
enough for the Scene to show through, edged by a Rim and wrapped in a glow that
deliberately spills past its own column, so a chord blooms as one mass of light
rather than separate bars. The engine owns every Crystal's state so they appear on
every Scene and on No Scene; a Scene may choose *where* in its own draw order to
render them (Underwater draws them behind its creatures), otherwise the engine draws
them on top.
_Avoid_: Animation (a Crystal is no longer scoped to one Scene), particle (what a
Crystal sheds is Dust), bar (a Crystal is a rounded, glowing rod, not a flat block).

**Rim**:
The hot, near-white edge tracing a Crystal's outline — the Crystal's own colour
carried most of the way to white, and the brightest thing it shows.
_Avoid_: Edge, outline, border, stroke (a stroke is how a Rim is drawn, not what it
is), highlight.

**Dust**:
The fine, luminous flecks a Crystal sheds as it dissolves at the visualization
area's bottom edge, born from its Rim and carrying that colour, each rising along a
sine path and fading out mid-air. Part of the Crystals Overlay rather than an
Overlay in its own right — Dust appears, hides and dims with the Crystals, so it has
no control, no draw seam and no place in the render order of its own.
_Avoid_: Particle, mote, shard, spark.

**Piano Preview**:
A reactive keyboard Overlay filling the Keyboard band — a stand-in for the
piano-hands footage, so the composition can be judged before recording. Held keys
light up; white keys are labelled with note letters (and octave on each C). Shares
the keyboard geometry that positions Crystals, so each key sits below its Crystal's
column. One of the Keyboard band choices (the default); while shown it covers the green.
_Avoid_: Piano (it is a preview stand-in, not an instrument the user plays).

**Keyboard band**:
The shared band at the canvas bottom (the bottom third) that at most one Overlay
fills at a time: the Piano Preview, the Chroma Key green, or nothing. Because the
Piano Preview and the Chroma Key green occupy the same pixels, they are one
mutually-exclusive choice — `none` / `piano` / `chroma` — chosen from a single
sidebar selector, not two independent toggles. Defaults to the Piano Preview; a
legacy setup that had both on migrates to the Piano Preview.
_Avoid_: Chroma Key band (the band is not the green; the green is one thing that can fill it).

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

**Preview Synth**:
The engine-owned synthesizer that makes Virtual Input notes audible — a stand-in
instrument, the audible counterpart to the Piano Preview's visual stand-in. It
sounds notes from the Virtual Input *only* (its computer-keyboard surface and its
Piano Preview click surface); a real Device stays silent, being its own instrument.
Native Web Audio, polyphonic (one voice per held note), a warm-analog tone — a
detuned sawtooth unison plus a sub-octave sine through a resonant low-pass filter —
with a short release tail. Gated by its own **Sound** toggle (default on): audio sounds
only when the Virtual Input is enabled *and* Sound is on. Not an Overlay — it is
non-visual, so it draws nothing in the Keyboard band.
_Avoid_: Overlay (a Preview Synth renders no pixels), Piano (a synth tone, not a
real piano; it stands in like the Piano Preview does), Instrument (a real Device is
the instrument; this only sounds the synthetic Virtual Input).

**Chroma Key area**:
The green-filled bottom third of the canvas, kept for compositing piano-hands
footage under the visualization in a video editor. An Overlay filling the Keyboard
band, mutually exclusive with the Piano Preview (which fills the same band and
covers the green). Selected as the `chroma` Keyboard band choice.
_Avoid_: Green screen, mask.

**No Scene**:
A selectable "empty" state in the Scene list: no Active Scene draws, leaving only
the background and the Overlays (Crystals, Piano Preview, Chroma Key). Chosen when
composing a recording from the Overlays alone.
_Avoid_: Blank, off (it is a first-class choice, remembered like any Scene).
