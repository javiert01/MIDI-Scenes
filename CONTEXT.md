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
visualization area, never entering the Chroma Key band. A hold long enough to reach
the floor sheds Dust too, at the gentler of the two rates. Its coloured body is dim
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
sine path and fading out mid-air. The rate says what the note is doing: a released
shaft is eaten by the floor and streams Dust in proportion to the shaft going in,
while a held one — anchored, so never eaten — only boils a slow trickle off a tip
resting on the floor. Holding therefore reads as a trickle and ending as a stream.
Part of the Crystals Overlay rather than an Overlay in its own right — Dust appears,
hides and dims with the Crystals, so it has no control, no draw seam and no place in
the render order of its own.
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
the user can pick one from the sidebar. The pick is saved by name: while that Device
is away another stands in, and it takes over again as soon as it reconnects.
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

**Hold**:
One source keeping one note number down: the Device, the computer-keyboard surface,
or the Piano Preview click surface. A note is held while any Hold on it remains: its
first Hold spawns its Crystal and lights its key, and only its last release ends
them, so one source letting go never cuts a note another still holds. A source can
hold the same note twice (two computer keys landing on one note across an octave
shift), and a release from a source with no Hold on that note takes nobody's Hold.
What sounds keeps its own Holds, counting only the sources that sound, so a note can
be held on screen while silent.
_Avoid_: Press (a press is the event that starts a Hold), voice (a voice is what
sounds a note), touch.

**Preview Synth** _(being replaced by the Tone Player, ADR-0009)_:
The engine-owned synthesizer that makes Virtual Input notes audible today, with a
single warm-analog sound. The Tone Player replaces it, and its sound carries over as
the Warm Analog Tone. This entry goes once the Tone Player lands.
_Avoid_: Using it for the Tone Player, or for any Tone.

**Tone**:
One selectable sound that notes can be played with: a recognisable instrument such
as Grand Piano or Accordion, or a synthetic sound such as Warm Analog (the default,
carried over from the Preview Synth) or Villera Lead. One Tone sounds at a time, and
its character is fixed: the user picks a Tone, they don't tune it.
_Avoid_: Instrument (a real Device is the instrument), patch, preset, voice (a voice
is one sounding note, not a choice of sound).

**Genre**:
A label grouping Tones in the list (Classical, Rock, Cumbia). It only organises: it
has no sound of its own and brings no accompaniment.
_Avoid_: Style, pack, preset.

**Tone Player**:
The engine-owned player that sounds notes with the selected Tone. Virtual Input
notes sound through it, and a Device's notes do only when the user opts in, since a
Device is usually voiced elsewhere. A Device's sustain pedal and pitch bend shape
everything it sounds, but never the visuals. Not an Overlay: it draws nothing.
_Avoid_: Preview Synth (the stand-in it replaces), sampler (how it sounds a Tone, not
what it is), Overlay.

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
