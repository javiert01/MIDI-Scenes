# Rebuild as a Vite + React + TypeScript p5.js web app

The visualizer was a static `index.html` loading p5.js and global-scope scripts via
CDN. To become a real app (sidebar, Scene switching, MIDI device picker) we are
rebuilding it as a Vite-bundled, TypeScript web app: **React** for the UI chrome,
**p5.js in instance mode** for the canvas, **WEBMIDI.js** for MIDI. TypeScript is
strict for app/MIDI code and relaxed for sketch files. Dev tooling: Vitest, ESLint +
Prettier, and `@/` path aliases.

## Considered Options

- **Web app (chosen).** Keeps the browser Web MIDI API, which already works in the
  user's Chrome; simplest to build and deploy.
- **Electron desktop app.** Rejected for now — bundles Chromium so MIDI is bulletproof
  and it feels installable, but ~150MB and extra build machinery aren't justified while
  the user runs it in Chrome. Revisit if wide distribution is wanted.
- **Tauri desktop app.** Rejected — on macOS its WebKit/Safari webview does **not**
  support Web MIDI, which would break the core feature unless MIDI were rewritten in
  Rust. Do not reach for Tauri here without solving that first.
