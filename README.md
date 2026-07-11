# MIDI Visualizer - Underwater Piano Experience

An interactive underwater-themed MIDI visualizer built with p5.js that transforms piano playing into a dynamic aquatic ecosystem.

## Features

### Visual Elements

- **Underwater Environment**: Deep ocean blue gradient background transitioning from lighter blue at the surface to darker depths
- **Crystals**: Geometric crystal formations that grow from piano keys
- **Fish**: Detailed fish with three movement patterns:
  - **Traveling**: Smooth horizontal swimming with vertical undulation
  - **Circling**: Elliptical orbital motion
  - **Wandering**: Random direction changes creating exploratory behavior
- **Jellyfish**: Bioluminescent jellyfish with:
  - Pulsing bell animation
  - 6-12 flowing tentacles with wave motion
  - 4 oral arms (feeding tentacles)
  - Color variations: blue-cyan, pink-purple, green-cyan

### MIDI Velocity Response

Both fish and jellyfish respond dynamically to piano playing velocity (0-127):

#### Fish Effects
- **Speed burst**: 1x to 3x base speed
- **Size scaling**: 1x to 1.5x size
- **Brightness boost**: +0 to +50 brightness
- **Decay rate**: 0.95 (returns to normal in ~1-2 seconds)

#### Jellyfish Effects
- **Pulse speed**: 1x to 4x faster pulsing
- **Size expansion**: 1x to 1.6x size
- **Glow intensity**: +60 brightness, +40 saturation
- **Tentacle motion**: 1x to 2.5x wave amplitude
- **Decay rate**: 0.93 (graceful return over ~1.5-2.5 seconds)

### Spatial Mapping

The nearest creature (fish or jellyfish) to the pressed piano key responds to that note, creating an intuitive spatial relationship between the keyboard and the underwater scene.

### Chroma Key Support

Canvas is divided into two sections:
- **Top 2/3 (1000x533px)**: Underwater visualization
- **Bottom 1/3 (1000x267px)**: Professional chroma key green (RGB: 0, 177, 64)

This layout enables recording the visualization and compositing it with piano performance footage using video editing software.

## Setup

### Prerequisites

- Modern web browser with Web MIDI API support (Chrome, Edge, Opera)
- MIDI keyboard or controller connected to your computer

### Installation

1. Clone or download this repository
2. No build process required - all dependencies are loaded via CDN

### Running the Visualizer

1. Connect your MIDI keyboard to your computer
2. Open `index.html` in a supported web browser
3. Grant MIDI access permission when prompted
4. Start playing - the underwater world responds to your music!

## File Structure

```
MIDI Visualizer/
├── index.html          # Main HTML file with script loading order
├── sketch.js           # Main p5.js sketch, MIDI handling, canvas layout
├── piano.js            # Piano keyboard representation
├── key.js              # Individual piano key class
├── crystal.js          # Crystal visualization class
├── fish.js             # Fish class with velocity response
├── jellyfish.js        # Jellyfish class with velocity response
├── particle.js         # Particle system for firework effects
├── firework.js         # Firework class (legacy)
├── spring.js           # Spring physics (legacy)
├── star.js             # Star effects (legacy)
├── spaceStar.js        # Space star effects (legacy)
├── style.css           # CSS styling
└── README.md           # This file
```

## Technical Details

### Canvas Dimensions
- Total: 1500x800px
- Visualization area: 1500x533px (top 2/3)
- Chroma key area: 1500x267px (bottom 1/3)

### Creature Counts
- Fish: 10-16 randomly generated
- Jellyfish: 6-9 randomly generated

### Color System
- **Creatures**: HSB color mode for natural hue-based variations
- **Backgrounds**: RGB color mode

### Performance
- Object pooling for crystals
- Efficient nearest-neighbor search (O(n) per note where n = total creatures)
- Decay calculations using linear interpolation
- No dynamic object allocation during velocity response

## Usage Tips

### For Musicians
- **Soft playing** (low velocity): Subtle creature responses, gentle glows
- **Medium playing** (mid velocity): Noticeable speed bursts and brightness
- **Hard playing** (high velocity): Dramatic effects - fish dart, jellyfish pulse rapidly with intense bioluminescence
- **Low notes** (left keys): Affect creatures on the left side
- **High notes** (right keys): Affect creatures on the right side

### For Video Production
1. Record the visualizer in fullscreen (use screen capture software)
2. Record piano performance separately or simultaneously
3. In your video editor:
   - Import both recordings
   - Apply chroma key effect to remove the green bottom section
   - Composite piano hands footage in the bottom third
   - Result: Piano hands appear below the underwater visualization

## Browser Compatibility

- **Chrome**: Full support ✓
- **Edge**: Full support ✓
- **Opera**: Full support ✓
- **Firefox**: Limited support (Web MIDI API requires extension)
- **Safari**: Limited support (Web MIDI API not natively supported)

## Dependencies

- [p5.js v1.9.4](https://p5js.org/) - Creative coding framework
- [p5.sound](https://p5js.org/reference/#/libraries/p5.sound) - Audio library (loaded but not currently used)
- Web MIDI API - Browser-native MIDI support

## Future Enhancement Ideas

- Add coral reef elements
- Implement schools of fish that move together
- Add particle effects for bubbles
- Create different underwater scenes (shallow reef, deep ocean, kelp forest)
- Add sound synthesis to complement the visuals
- Support for different MIDI control changes (modulation, sustain pedal)

## License

This project is open source. Feel free to modify and use for your own creative projects.

## Credits

Created with p5.js and inspired by the beauty of underwater ecosystems and music visualization.
