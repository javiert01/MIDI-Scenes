# Tone Player: sampled and synthesised Tones, hooked at each source's entry point

Supersedes in part ADR-0007 (see "What this supersedes" below).

The Preview Synth gave the Virtual Input one stand-in sound. We now want a catalogue
of recognisable **Tones** grouped by **Genre** (see `CONTEXT.md`): Warm Analog and
Villera Lead are synthesised, and Grand Piano, Strings, Overdriven Guitar, Rock Organ
and Accordion come from redistributable samples. A real Device can now sound too, if
the user opts in. The engine-owned **Tone Player** replaces the Preview Synth. The
reasoning behind each choice lives in the decision tickets under the map
[Map: realistic Tones for Classical, Rock and Cumbia](https://github.com/javiert01/MIDI-Scenes/issues/39).
This ADR records the decisions that are surprising or hard to reverse.

## Decision

- **Hand-rolled on native Web Audio, still with no audio dependency.** Each voice is
  an `AudioBufferSourceNode` (sampled Tones) or a small oscillator stack (synthesised
  Tones) behind its own envelope gain. The Tone Player extends the existing injected
  `AudioContextLike` seam, so it is tested against a fake context, as the Preview
  Synth is. No library both kept that seam and supplied the sustain pedal and a voice
  cap with stealing. smplr was the closest, and it stays the fallback.

- **Each source's entry point calls the Tone Player. The dispatch core stays
  source-agnostic.** ADR-0007 hooked audio at the Virtual Input surfaces. We keep
  that rule and widen it to two sources: the Virtual Input surfaces call the Tone
  Player as before, and so does the Device's raw-message entry point, but only while
  Device sound is on. Each call names its source, so `NoteEvent` still carries no
  source tag. The Tone Player is called before dispatch, so a note sounds before
  Crystals, Scene callbacks and subscribers run. A future reader will expect audio
  in `dispatchNote`. It is kept out on purpose.

- **Sustain pedal and pitch bend reach the Tone Player and nothing else.** The MIDI
  parser now reads CC64 and pitch bend as well as note on/off. The Device entry
  point sends both straight to the Tone Player, gated by Device sound, and neither
  ever enters the dispatch core. They shape every sounding voice, Virtual Input notes
  included, because it is one instrument. They never affect Crystals, the Piano
  Preview or Scenes: a Crystal still ends at key-up, not pedal-up. The Tone Player
  holds pedal state and bend itself. Bend is a fixed ±2 semitones for every Tone,
  and RPN 0 messages are ignored.

- **One voice per note number, held by a set of sources, up to a 32-voice cap.**
  This matches the reference counting in ADR-0005. When the cap is reached, the
  Tone Player steals the oldest voice, taking release tails first, then pedal-held
  voices, then key-held ones, each with a 20 ms fade.

- **Tones sound as recorded, with a fixed gain each. There is no reverb and no
  volume control.** Each Tone's gain was matched to Warm Analog by meter and
  accepted by ear. The gains live in a hand-written Tone catalogue in the app, not
  in the assets, so they can be retuned without re-encoding. The output chain is the
  voice, its Tone's fixed gain, a master at 1.0 (so Warm Analog stays exactly as
  loud as today), and then a soft-clip `WaveShaperNode` ceiling.

- **The safety ceiling is a wave shaper, not a compressor.** Only one short phrase
  was measured for headroom, and a large pedal-held chord will peak higher. Chrome's
  `DynamicsCompressorNode` has a fixed lookahead of about 6 ms, which is a fifth of
  the 30 ms latency aim, and it pumps. A wave shaper with oversampling off adds no
  latency, passes ordinary playing through unchanged, and only bends peaks that
  would otherwise hard-clip.

- **Sample assets are built offline and committed to plain git as MP3.** An in-repo
  TypeScript script runs hand-written recipes through a system `ffmpeg`. It writes
  CBR 128 kbps LAME-tagged MP3s and a generated `regions.json` per Tone, both
  committed. Each `regions.json` also records its sources: set, pinned commit or
  SHA-256, licence and author. Vite hashes the files, and Vercel serves them with an
  immutable cache header. The browser's HTTP cache is the only cache. A Tone
  downloads when it is selected, decodes fully before it takes over, and only the
  selected sampled Tone is held in memory. The budget is about 450 s of stereo and
  7 MiB per Tone.

- **Only redistributable samples, credited where the licence asks.** Sources must
  be CC0 or CC BY. Salamander Grand Piano (CC BY 3.0) is credited in the Sound strip
  while it is selected. A test fails if any Tone with an attribution-bearing source
  has no credit.

- **Latency settings.** The `AudioContext` uses `latencyHint: 0`, and notes start at
  once rather than at the MIDI timestamp. The context is created on the gesture that
  turns sound on. When a sampled Tone is saved and sound isn't Off, it is created
  suspended at page load, so decoding can finish before the first note. It resumes on
  the first click or key press. Device notes that arrive before then are dropped.

## What this supersedes in ADR-0007

- **"Virtual Input only"**: superseded. A Device sounds when the user opts in
  (`deviceSoundEnabled`, off by default). This keeps the recording workflow clean
  unless the user chooses otherwise.
- **"Hooked at the surfaces, not the dispatch core"**: generalised. "Surfaces" now
  means each source's entry point. The reason, a source-agnostic core with no source
  tag, stands.
- **The rejection of a sampled piano**: superseded. Sampled Tones are now the main
  feature. The rejection of `p5.sound` and Tone.js stands.
- **"Own Sound toggle" and the single master gain**: `soundEnabled` keeps its
  meaning and default. The toggle moves into the sidebar's Sound strip with
  Device sound. Per-Tone fixed gains and the ceiling join the master gain. "No
  volume slider" stands.
- **"The AudioContext is created lazily on the first note"**: superseded by the
  latency settings above. A cold start on the first note took 148 ms in Chrome.
- **Unchanged:** native Web Audio with no dependency, the injected context factory,
  and a pure, unit-tested audio module.

## Considered options

- **Tone.js Sampler, SpessaSynth or WebAudioFont instead of hand-rolling.**
  Rejected. Tone.js adds 100 ms of lookahead by default and has no proper looping.
  SpessaSynth adds about 282 KB gzipped and can't run against a fake context.
  WebAudioFont is GPL-3.
- **Audio in the dispatch core, with a source tag on every note.** Rejected for the
  same reason ADR-0007 gave. It would also let pedal and bend leak towards the
  visuals.
- **Git LFS, or building the assets at deploy time.** Rejected. LFS's free bandwidth
  would run out after about 60 Vercel builds. Building at deploy time would need
  ffmpeg and about 380 MB of downloads on every deploy.
- **A shared reverb.** Rejected by ear. It would also need a convolver and an
  impulse-response asset.
- **A compressor used as a limiter.** Rejected because of its latency (see above).

## Consequences

- The repo carries about 17 MiB of committed MP3s. Only someone regenerating the
  assets needs ffmpeg.
- A Device's notes can be heard, so a Device left sounding during a recording would
  be captured. That is why Device sound stays off by default.
- The `prototype/tone-audition` branch stays unmerged as the bench for tuning
  sample preparation. It is not part of the app.
- `PersistedStateV1` gains optional `deviceSoundEnabled` and `toneId` fields. An
  unknown `toneId` falls back to Warm Analog, so no version bump is needed.
