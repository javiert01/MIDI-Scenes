# MIDI Visualizer

Play your MIDI keyboard, watch it come alive on screen. A browser app that turns
live playing into real-time visuals — underwater fish and jellyfish, a
starfield, glowing crystals rising from each key you press — with a layout
built for recording alongside piano-hands footage.

## Features

- **Scenes** — switchable visualizations you pick from the sidebar:
  - **Underwater**: fish and jellyfish that dart, glow, and pulse with your
    playing's velocity and position on the keyboard
  - **Starfield**: a reactive starfield
  - **Rain**: falling rain and ripples, with a new drop at each key you press
  - **Great Hall**: candles, clouds, and owls, where each note flares the
    candle nearest its key
  - **No Scene**: just the background and Overlays, for a minimal composition
- **Crystals** — a luminous glass rod grows from the column under whichever key
  you're holding, on every Scene, then falls and dissolves into rising Dust
  when you let go (purple on the left half of the keyboard and orange on the
  right, or colors of your choice)
- **Keyboard band** — the bottom of the canvas shows one of:
  - **Piano Preview** (the default): an on-screen keyboard that lights up as
    you play, letting you judge a recording's composition before you actually
    record your hands
  - **Chroma Key**: a green strip, ready to key out in your video editor and
    replace with piano-hands footage
  - **None**: nothing in the band
- **Virtual Input** — play without a MIDI keyboard, using your computer keyboard
  or by clicking keys on the Piano Preview, with an optional synth so you can
  hear the notes
- **Present Mode** — hide the sidebar for a clean, fullscreen view when
  recording or performing
- Every setting (Scene, sidebar toggles, resolution, MIDI device) is
  remembered across reloads

## Getting started

You'll need a modern browser with Web MIDI support (Chrome, Edge, or Opera —
see [Browser support](#browser-support) below). A MIDI keyboard or controller is
optional, since the Virtual Input can play notes without one.

```bash
npm install
npm run dev
```

Open the printed local URL, grant MIDI access when prompted, and start
playing.

## Using it

The card at the top of the sidebar always shows whether a MIDI keyboard is
connected, and says so when one is plugged in or unplugged. The sections below it
start open, and each shows its current value even when collapsed:

- **Scene** switches the active visualization and tunes its options
- **Crystals** sets their visibility, opacity, and left and right colors
- **Keyboard band** chooses Piano Preview, Chroma Key, or None
- **Input** covers both ways of playing:
  - **MIDI keyboards** lets you pick which connected keyboard the app listens to.
    Your pick is remembered and takes over again whenever it reconnects
  - **Virtual Input** turns on playing without a MIDI keyboard: `A S D F G H J K`
    are white keys, `W E T Y U` are black keys, and `Z` / `X` shift the octave. Its
    **Sound** toggle controls the synth, which only sounds Virtual Input notes
- **Canvas size** switches the canvas between preset sizes for recording
- **Present** hides the sidebar; press Escape or use the exit button to bring it
  back

Changes save automatically in your browser, and the sidebar's footer confirms each
one. **Reset** restores a Scene's options or the Crystals, and **Reset all** restores
every setting except your saved MIDI keyboard.

### Recording with piano-hands footage

1. Set the **Keyboard band** to **Piano Preview** to check your framing before
   you record for real
2. Switch the **Keyboard band** to **Chroma Key**, then record the app in Present
   Mode (screen capture) and your hands separately
3. In your video editor, chroma-key out the green band and composite your
   hands footage into it

## Browser support

A MIDI keyboard needs Web MIDI, so **Chrome, Edge, and Opera** work out of the
box. Firefox and Safari don't support it natively.

## Development

```bash
npm run dev      # start the dev server
npm test         # run the test suite
npm run lint     # lint + format check
npm run build    # typecheck and build for production
npm run perf     # performance workbench: frame cost, draw calls, bundle size
```

Every pull request runs the [performance workbench](perf/README.md) in CI. It
fails when a change pushes a frame over budget, makes a Scene slower than the
branch it targets, or makes a Scene draw more than its recorded baseline. If a
Scene is meant to get heavier, re-record the baseline with `npm run perf:update`.

Sampled Tones' MP3s and `regions.json` files are built offline and committed, so
neither `npm run build` nor a deploy needs ffmpeg or any sample download. To
rebuild them from their pinned sources, install ffmpeg (`brew install ffmpeg`)
and run:

```bash
npm run tones:build             # every sampled Tone
npm run tones:build accordion   # just one
```

Raw downloads are cached in the gitignored `.cache/tone-sources/`. The recipes
live in `scripts/tones/recipes/`, and the outputs in one folder per Tone under
`src/tones/`.

The app is a Vite + React + TypeScript project, with a framework-agnostic
`VisualizerEngine` driving a single p5.js canvas. See [CONTEXT.md](CONTEXT.md)
for the domain vocabulary (Scene, Overlay, Crystal, etc.) and
[docs/adr/](docs/adr/) for the architectural decisions behind it.

## Sound credits

The sampled Tones are built from these redistributable sample sets. CC0 sets are
credited as a courtesy.

- **Grand Piano**: [Salamander Grand Piano V3](https://github.com/sfzinstruments/SalamanderGrandPiano),
  a Yamaha C5 recorded by Alexander Holm, mapped to SFZ by kinwie.
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Three of its 16
  velocity layers, leading silence trimmed, tails cut at 5 s with a short
  fade-out, and re-encoded as MP3.
- **Accordion**: [FreePats Button Accordion HN](https://github.com/freepats/button-accordion-HN),
  a Hohner accordion recorded by Jeff Stauffer, made into a sound bank by
  michael02022 for the [FreePats project](https://freepats.zenvoid.org/).
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Leading silence
  trimmed and re-encoded as MP3.

## License

This project is open source. Feel free to modify and use for your own
creative projects.
