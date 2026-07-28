# Preview Synth: audio for the Virtual Input, hooked at the surfaces

To hear what you play while testing or composing without a real keyboard, we add a
**Preview Synth** (see `CONTEXT.md`): an engine-owned, native Web Audio synthesizer
that makes Virtual Input notes audible. It is the audible counterpart to the Piano
Preview — a stand-in instrument, not a real piano.

## Decision

- **Native Web Audio, no dependency.** A hand-rolled oscillator + ADSR envelope in a
  pure `previewSynth.ts` module (unit-tested like `virtualKeyboard.ts` / `midi.ts`),
  polyphonic (one voice per held note), clean synth tone with a short release tail
  (~200 ms). We rejected `p5.sound` (a large addon wrapping the same Web Audio API,
  ~2% of which we'd use) and a sampled piano (Tone.js + sample assets) as overkill for
  what is auditory feedback, not a performance instrument.

- **Virtual Input only.** The Preview Synth sounds notes from the Virtual Input's two
  surfaces (computer keyboard + Piano Preview clicks) and nothing else. A real Device
  stays silent — it is already its own instrument, usually voiced elsewhere; doubling
  it with a synth tone is unwanted. This also keeps the recording workflow clean:
  piano-hands footage is recorded against a real Device, so nothing synthetic sounds
  then.

- **Hooked at the surfaces, not the dispatch core.** ADR-0005 routes every note —
  Device and Virtual Input alike — through one source-agnostic `dispatchNote` core, so
  that Crystals, held-key lighting, and Scene callbacks react identically regardless of
  source. "Virtual Input only" audio deliberately *breaks* that symmetry: the Preview
  Synth is called from the Virtual Input surfaces (`handleKeyDown` / `handleKeyUp` /
  `setMouseNote`), alongside `dispatchNote`, rather than inside it. This is the
  surprising part worth recording — a future reader will expect audio in the shared
  core. We keep it out so the core stays source-independent and audio needs no `source`
  tag threaded through every note event. The synth owns its own voice map keyed by note
  number, released by the same events that release Virtual notes (toggle-off, window
  blur, mouse-up).

- **Own Sound toggle, default on.** Audio sounds only when the Virtual Input is enabled
  *and* Sound is on, so the Virtual Input can still be used silently for pure visual
  testing. A single conservative master gain, no volume slider in v1 (Virtual Input
  notes are fixed-velocity, so every note is equally loud).

## Considered options

- **All sources sound (audio in the dispatch core).** The symmetric choice, consistent
  with ADR-0005. Rejected: a real keyboard already makes its own sound, so this doubles
  it; and the goal is to voice the *synthetic* source that has no sound of its own.
- **Piano Preview clicks only.** Narrower than the chosen scope. Rejected: the computer
  keyboard is the other Virtual Input surface and should sound too; scoping to the click
  surface alone would make the same synthetic note behave differently by surface.

## Consequences

- The AudioContext is created/resumed lazily on the first note (itself a user gesture),
  satisfying browser autoplay rules; it is injected via a factory (guarded for
  jsdom/SSR) mirroring the existing `createP5` / `createMidi` dependency injection.
- Turning Sound off immediately silences held voices; turning it on affects only
  subsequent notes.
- `PersistedStateV1` gains a Sound-enabled field alongside `virtualInputEnabled`.
