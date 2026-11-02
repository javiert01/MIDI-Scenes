# Which playback approach should the Tone Player build on?

Findings for [#40](https://github.com/javiert01/MIDI-Scenes/issues/40), part of map [#39](https://github.com/javiert01/MIDI-Scenes/issues/39). Facts were checked on 2026-11-02. "Tone" means the domain term and "Tone.js" means the library.

## Answer

**Hand-roll the Tone Player on native Web Audio: one `AudioBufferSourceNode` plus one `GainNode` per voice, using buffers the app fetches and decodes itself.** Extend the existing `AudioContextLike` seam in `src/engine/previewSynth.ts`.

- **Why not a library:** the browser already does the hard parts, namely sample-accurate looping, repitching and scheduling. What remains is small and specific to this app: mapping key and velocity to a sample, holding notes under the pedal, capping voices, and reporting load progress and failure.
- **What the libraries leave out:** no library that keeps the seam supplies the pedal or a released voice cap, so the app would write that logic anyway.
- **Runner-up:** smplr is good and is the fallback if hand-rolling proves costly. Its `Voice` and `VoiceManager` are also a useful reference for the tricky release and steal paths.
- **Other options:** Tone.js Sampler can't do this job. SpessaSynth is the only option with every feature built in, but it costs the seam and has a Chromium problem with compressed banks. WebAudioFont is ruled out by its GPL licence.

The main risk is that hand-rolling hasn't been built or heard yet. Prototype ticket [#45](https://github.com/javiert01/MIDI-Scenes/issues/45) tests that directly.

## Comparison

| | Hand-rolled | Tone.js Sampler | smplr | WebAudioFont | SpessaSynth |
|---|---|---|---|---|---|
| **Version (npm publish date)** | n/a | 15.1.22 (2025-04-27); `next` 15.5.66 (2026-10-31) | 1.1.0 (2026-09-28) | 3.0.4 (2022-06-28) | lib 4.4.2 (2026-10-30), core 4.4.4 (2026-10-30) |
| **Added note-on delay** | None | 100 ms by default; 0 if `lookAhead` is 0 | None | None | Message hop to the worklet |
| **Velocity layers** | Write it (small) | No, gain only | Yes, `velRange` | No, gain only | Yes, from the bank |
| **Sustain pedal** | Write it (small) | No | No (`setCC(64)` only stores a value) | No | Yes, CC64 |
| **Per-sample loops** | Native | None in stable; one loop per Sampler in `next` | Yes, per region | Yes, per zone | Yes, from the bank |
| **Voice stealing** | Write it (small) | None | Merged, not released | Reuses envelopes, no cap found | Yes, default cap 350 |
| **Firefox and Safari** | Native APIs, all supported | Shimmed | Safari branch, no open bugs | Plain Web Audio | AudioWorklet; see below |
| **Code added (min / gzip)** | Est. 2-4 KB gzip, not built | 237 / 61 KB root; 161 / 45 KB subpath | 66 / 22 KB | 126 / 43 KB, unminified build not tree-shaken | 237 / 93 KB plus 594 / 189 KB worklet |
| **Licence** | n/a | MIT | MIT (declared only) | GPL-3.0-or-later | Apache-2.0 |
| **npm downloads last month** | n/a | 1,169,835 | 107,739 | 3,904 | 33,338 (lib) |
| **Fit with the `AudioContextLike` seam** | Exact | Poor | Workable with a cast | Workable, but API takes `duration` up front | None, behind an adapter only |

Sizes come from bundling one import of each package with esbuild 0.25 (`--bundle --minify --format=esm`). The worklet and WebAudioFont figures are the shipped files, gzipped. Download counts come from the [npm API](https://api.npmjs.org/downloads/point/last-month/smplr) for 2026-10-03 to 2026-11-01.

## Findings by option

### Native Web Audio

The Web Audio spec and browser data cover what a sampled voice needs.

- **Looping:** `loopStart` and `loopEnd` are [positions in seconds with sub-sample accuracy](https://webaudio.github.io/web-audio-api/#AudioBufferSourceNode), set per node, so each sample can have its own loop.
- **Decoding:** `decodeAudioData` [resamples to the context's rate](https://webaudio.github.io/web-audio-api/#dom-baseaudiocontext-decodeaudiodata). Loop points in seconds therefore survive a different sample rate.
- **Node lifetime:** a source can [start only once and is meant to be created per play](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode). Nodes are cheap and buffers are reused, which fits one voice per note.
- **Support:** [browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioBufferSourceNode.json) lists `loop`, `loopStart`, `loopEnd` and `detune` in Firefox from 40 and Safari from 14.1 at the latest.

Two traps for the hand-rolled code, both already avoided by the Preview Synth's release path or smplr's:

- **Don't use `cancelAndHoldAtTime` for releases.** [Firefox doesn't support it](https://github.com/mdn/browser-compat-data/blob/main/api/AudioParam.json).
- **Reading `AudioParam.value` during automation is safe in current browsers.** Firefox only [fixed this in 69](https://github.com/mdn/browser-compat-data/blob/main/api/AudioParam.json). Before 134, setting `value` at the same time as automation was ignored, so use `setValueAtTime`, as `previewSynth.ts` does.

Repitching quality is [left to each browser](https://webaudio.github.io/web-audio-api/#AudioBufferSourceNode). This applies equally to Tone.js and smplr, so how far apart samples are spaced is a listening question for #45.

### Tone.js Sampler

Tone.js is healthy and widely used, but its Sampler doesn't fit this job.

- **No looping in stable.** [`SamplerOptions` in 15.1.22](https://github.com/Tonejs/Tone.js/blob/15.1.22/Tone/instrument/Sampler.ts) has no loop fields, and each note gets a fixed duration of `buffer.duration / playbackRate`. A held organ note would simply end.
- **`next` doesn't fix it.** [Looping on the main branch](https://github.com/Tonejs/Tone.js/blob/main/Tone/instrument/Sampler.ts) has one `loopStart` and `loopEnd` per Sampler, not per sample. Notes also start at `offset = loopStart`, which skips the attack before the loop.
- **Velocity is gain only.** Layers would need one Sampler per layer.
- **No pedal or voice cap.** `maxPolyphony` exists only on [`PolySynth`](https://github.com/Tonejs/Tone.js/blob/15.1.22/Tone/instrument/PolySynth.ts).
- **100 ms added by default.** [`lookAhead` defaults to 0.1 s](https://github.com/Tonejs/Tone.js/blob/15.1.22/Tone/core/context/Context.ts) and `now()` adds it. Setting it to 0 removes the delay, and the docs say that gives the lowest latency.
- **Creates a context on import.** [`export const Transport = getContext().transport`](https://github.com/Tonejs/Tone.js/blob/15.1.22/Tone/index.ts) runs at module scope, and the [README says so too](https://github.com/Tonejs/Tone.js#readme). My bundle kept that call for a root import. A subpath import avoided it. This conflicts with the repo's rule of creating the context lazily on the first note.
- **Fakes won't pass.** [`Param` asserts `isAudioParam`](https://github.com/Tonejs/Tone.js/blob/15.1.22/Tone/core/context/Param.ts) using [standardized-audio-context's type checks](https://github.com/Tonejs/Tone.js/blob/15.1.22/Tone/core/util/AdvancedTypeCheck.ts). From reading the code, the repo's plain fake classes would fail those checks (not run), so tests would have to mock Tone.js itself.

### smplr

This is the closest library match and is actively maintained. It uses [native nodes directly](https://github.com/danigb/smplr/blob/main/src/smplr/voice.ts) and takes an injected context.

**What it does well:**

- [Regions with `keyRange`, `velRange` and per-region loops](https://github.com/danigb/smplr/blob/main/PRESET_SCHEMA.md).
- Load progress through `onLoadProgress`.
- An injectable [`Storage`](https://github.com/danigb/smplr/blob/main/src/storage.ts), which also makes a good test seam for fetching.
- Untimed notes [dispatch synchronously](https://github.com/danigb/smplr/blob/main/src/smplr/scheduler.ts). In my probe, a note started at exactly `currentTime`.

**What it doesn't do for this app:**

- **The pedal doesn't hold notes.** [`setCC` only feeds region matching](https://github.com/danigb/smplr/blob/main/src/smplr/smplr.ts), despite the [README's "sustain pedal on" example](https://github.com/danigb/smplr#midi-cc). In my probe, `setCC(64, 127)` followed by `stop()` still stopped the source. The app must defer stops itself.
- **The voice cap isn't on npm.** `maxVoices` [merged on 2026-10-26](https://github.com/danigb/smplr/pull/143) and is listed under [Unreleased](https://github.com/danigb/smplr/blob/main/CHANGELOG.md). It isn't in the 1.1.0 typings. On a chord over the cap, it cancels the newest notes rather than the oldest.
- **Failed samples are silent.** The [loader omits them and still counts them as loaded](https://github.com/danigb/smplr/blob/main/src/smplr/sample-loader.ts), and non-200 responses [only log a warning](https://github.com/danigb/smplr/blob/main/src/smplr/load-audio.ts). A partly failed download would look ready and leave silent keys, which undermines the map's "Warm Analog until ready" rule.
- **Safari never gets Ogg.** It [skips Ogg by user-agent sniffing](https://github.com/danigb/smplr/blob/main/src/smplr/load-audio.ts), so every Tone would need a second encoding. This may be out of date, as noted under Effects on other tickets.

**Smaller points:**

- **Licence:** MIT is declared in `package.json`, but neither the repo nor the npm tarball has a licence file, and [GitHub reports none](https://github.com/danigb/smplr).
- **Maintainer:** danigb has 81 commits and the next contributor has 3.
- **Open bugs:** the issue tracker's [Safari reports](https://github.com/danigb/smplr/issues?q=is%3Aissue+safari) and [Firefox reports](https://github.com/danigb/smplr/issues?q=is%3Aissue+firefox) are all closed. The one on [Chrome onset pops](https://github.com/danigb/smplr/issues/121) was closed without a reproduction, so a click at note start is worth listening for.

### SpessaSynth

This is a full SoundFont engine and the only option with every feature built in: [CC64 holding note-offs](https://spessasus.github.io/spessasynth_core/extra/midi-implementation), velocity layers, loops and [voice stealing with a default cap of 350](https://github.com/spessasus/spessasynth_core/blob/master/src/synthesizer/audio_engine/synth_constants.ts). It's Apache-2.0 and very active, though it's overkill for this app and has real costs.

- **Chromium trouble with compressed banks.** Fitting "a few MB per Tone" means SF3. The [project's docs](https://github.com/spessasus/spessasynth_lib/blob/master/docs/extra/comparing-synthesizers.md) say `WorkletSynthesizer` is exposed to the [Chromium SF3 bug](https://github.com/spessasus/spessasynth_lib/issues/8) with no workaround. The alternative, `WorkerSynthesizer`, avoids that bug but is less precise for real-time note-ons and can click on non-Chromium browsers on weak devices. Chrome is the primary target here, and live playing is the use case.
- **Size.** It adds about 282 KB gzipped, more than ten times smplr.
- **Build step.** The [processor file must be copied by hand and kept in sync](https://github.com/spessasus/spessasynth_lib/blob/master/docs/extra/importing-the-worklet.md) with the npm package.
- **Seam.** It needs a real `audioWorklet.addModule`, so a fake context can't run it. Tests could only mock an adapter.
- **Dependency pinning.** [`spessasynth_lib` depends on `spessasynth_core: "latest"`](https://www.npmjs.com/package/spessasynth_lib?activeTab=dependencies), and core depends on `stb-vorbis: "latest"`. The lockfile protects installs, but releases are frequent (three lib releases in the last week of October).

### WebAudioFont

This is ruled out by its licence. The [LICENSE is GPL-3](https://github.com/surikov/webaudiofont/blob/master/LICENSE.md), and the [engine logs "GPL3" on load](https://github.com/surikov/webaudiofont/blob/master/npm/src/player.ts). Shipping it in the app bundle would bring GPL terms to a repo that has no licence today.

It also fits poorly. [`queueWaveTable`](https://github.com/surikov/webaudiofont/blob/master/npm/src/player.ts) wants a duration up front and picks zones by pitch alone, so it has no velocity layers. The last npm release was in 2022.

### Also checked

These were not evaluated in depth.

- **[soundfont-player](https://github.com/danigb/soundfont-player):** archived, last release January 2020. It's by smplr's author.
- **[@tonejs/piano](https://www.npmjs.com/package/@tonejs/piano):** last release May 2020, piano only.
- **[js-synthesizer](https://github.com/jet2jet/js-synthesizer):** FluidSynth compiled to WebAssembly, BSD-3-Clause, last release April 2026. It's a SoundFont engine like SpessaSynth, so I'd expect the same seam and size objections.

## Fit with the seam

The repo injects a factory returning `AudioContextLike`, then tests against small fake classes under jsdom (`src/engine/previewSynth.test.ts`).

- **Hand-rolled:** add `createBufferSource` and `decodeAudioData` to the interface, add `disconnect` where needed, and inject `fetch` alongside the context factory. The existing fakes extend directly, with no cast and no new test tooling. Warm Analog and sampled Tones can share one lazily created context and master gain.
- **smplr:** it needs a `BaseAudioContext` cast. My probe ran it against a Proxy-wrapped fake and confirmed that playing a note touches only `createBufferSource`, `createGain` and `currentTime`. Construction also needs `createStereoPanner` and `destination`. Its `buffers` mode threw in Node on `value instanceof AudioBuffer` until I stubbed that global. I didn't run it under jsdom, but the repo already treats jsdom as having no Web Audio. Tests would also assert on another library's internal node graph.
- **Tone.js and SpessaSynth:** only an adapter can be faked, so the voice logic would go untested.

## What the hand-rolled version must supply

This is scope for the spec, not a design. My estimate is 300 to 500 lines, about the size of `previewSynth.ts` (306 lines). Nothing has been built.

- A per-Tone table of regions: sample, root key, key range, velocity range, loop points, release time and gain.
- A velocity curve, and possibly a crossfade between layers.
- Pedal state: note-offs arriving while CC64 is down are deferred, and a repeated note under the pedal needs a defined behaviour.
- A voice cap and a stealing policy. The hand-rolled version can choose its own rule, unlike smplr's.
- Fetch and decode with progress, with failure treated as failure, so a Tone only takes over when every region is ready.
- Click-free release from the current level, and clean disconnects when a voice ends.

## What would change this

- **Switch to smplr** if #45 shows the hand-rolled voice code is taking disproportionate effort, or if the catalogue grows well beyond a handful of Tones. Wrap it behind the same interface and add the pedal and failure handling.
- **Reconsider a SoundFont engine** only if per-zone envelopes and modulators prove essential to recognisability. Even then, check the Chromium bug first.

## Not verified

- **Actual latency.** No option was measured end to end. The table compares what each adds in code. Native scheduling costs at least one [128-frame render quantum](https://webaudio.github.io/web-audio-api/#AudioContextRenderSizeCategory), about 2.9 ms at 44.1 kHz, plus `baseLatency` and output latency. #42 and #45 cover real numbers.
- **Real browsers.** Firefox and Safari support comes from browser-compat-data, source code and issue trackers. Nothing here was played in those browsers.
- **Sound quality.** Nothing was listened to.
- **The hand-rolled size and line count.** Both are estimates.
- **The SpessaSynth Chromium bug on current versions.** I relied on the project's own docs. The linked issue was closed in favour of the Worker option, and I didn't reproduce it.
- **Tone.js with plain fakes.** The failure is inferred from reading the type checks, not run.

## Effects on other tickets

- **#41 (samples):** a SoundFont is acceptable as a source. Its samples and loop points can be extracted at build time, so the runtime doesn't need to parse SF2.
- **#42 (latency):** Tone.js's 100 ms default no longer applies. [`outputLatency` reached Safari only in 18.4](https://github.com/mdn/browser-compat-data/blob/main/api/AudioContext.json).
- **#43 (delivery and format):** loop points need encoding-aware handling. AAC adds [2,112 priming samples](https://developer.apple.com/library/archive/technotes/tn2258/_index.html), and only some containers signal them, so a loop point set on the source file can land in the wrong place after decoding. Measure loop points on decoded audio in each browser, or choose a format without this problem. On Ogg, [Apple's Safari 18.4 notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes.md) add Ogg Opus and Vorbis on macOS 15.4, while [MDN's codec table](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs) still shows no Safari Vorbis. Whether `decodeAudioData` handles Ogg there is unverified.
- **#45 (listening prototype):** build it on a minimal hand-rolled player, and listen for repitching quality and note-start clicks.
- **#46 (hook point):** the pedal state belongs in the Tone Player, because no library will hold it. CC64 has to reach it.
- **ADR:** ADR-0007's "native Web Audio, no dependency" decision stands. Only its rejection of sampled sound is superseded.
- **"Not yet specified" on the map:**
  - **Voice limits:** now a policy choice for the spec, since nothing supplies it.
  - **Testing:** effectively answered by extending the existing fakes and injecting `fetch`.
  - **Sample preparation:** gains the encoding-aware loop point requirement above.
