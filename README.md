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
  - **No Scene**: just the background and Overlays, for a minimal composition
- **Crystals** — a glowing shaft grows from the column under whichever key
  you're holding, on every Scene (purple on the left half of the keyboard,
  orange on the right)
- **Piano Preview** — an optional on-screen keyboard that lights up as you
  play, letting you judge a recording's composition before you actually record
  your hands
- **Chroma Key band** — a green strip along the bottom of the canvas, ready to
  key out in your video editor and replace with piano-hands footage
- **Present Mode** — hide the sidebar for a clean, fullscreen view when
  recording or performing
- Every setting (Scene, sidebar toggles, resolution, MIDI device) is
  remembered across reloads

## Getting started

You'll need a modern browser with Web MIDI support (Chrome, Edge, or Opera —
see [Browser support](#browser-support) below) and a MIDI keyboard or
controller.

```bash
npm install
npm run dev
```

Open the printed local URL, grant MIDI access when prompted, and start
playing.

## Using it

- **Scenes** sidebar section switches the active visualization
- **Chroma Key**, **Crystals**, and **Piano Preview** sections toggle those
  Overlays and (where relevant) their opacity
- **Resolution** switches the canvas between preset sizes for recording
- **MIDI Device** lets you pick which connected keyboard the app listens to
- **Present Mode** hides the sidebar; press Escape or use the exit button to
  bring it back

### Recording with piano-hands footage

1. Turn on **Piano Preview** to check your framing before you record for real
2. Record the app in Present Mode (screen capture) and your hands separately
3. In your video editor, chroma-key out the green band and composite your
   hands footage into it

## Browser support

Web MIDI is required, so **Chrome, Edge, and Opera** work out of the box.
Firefox and Safari don't support it natively.

## Development

```bash
npm run dev      # start the dev server
npm test         # run the test suite
npm run lint     # lint + format check
npm run build    # typecheck and build for production
```

The app is a Vite + React + TypeScript project, with a framework-agnostic
`VisualizerEngine` driving a single p5.js canvas. See [CONTEXT.md](CONTEXT.md)
for the domain vocabulary (Scene, Overlay, Crystal, etc.) and
[docs/adr/](docs/adr/) for the architectural decisions behind it.

## License

This project is open source. Feel free to modify and use for your own
creative projects.
