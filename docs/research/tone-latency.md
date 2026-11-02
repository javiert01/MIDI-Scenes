# Key-press-to-sound latency: Web MIDI to Web Audio

Findings for [#42](https://github.com/javiert01/MIDI-Scenes/issues/42) on the map [#39](https://github.com/javiert01/MIDI-Scenes/issues/39). Researched 2026-11-02.

## Answer

- **Chrome with a real Device:** about 30 to 50 ms on MacBook speakers, and an estimated 15 to 30 ms on low-latency wired output. No acoustic measurement was made, so both are estimates built from the budget below.
- **Firefox:** reports a slightly shorter audio path than Chrome (23 ms against 26 to 35 ms on the same Mac), but its main thread stalls longer.
- **Safari:** has no Web MIDI, so it only plays Virtual Input notes. No latency was measured there.
- **Virtual Input:** an estimated 40 to 100 ms, because a computer keyboard alone takes 15 to 60 ms. Fine for trying a Tone, not for performing.
- **Bluetooth:** adds about 100 to 250 ms on common codecs. That is not playable.
- **Target:** aim for 30 ms or less end to end, accept up to about 50 ms, and treat anything above about 60 ms as failing. These bands are my synthesis of the literature, not a published standard, and no cited study tested them on pianists playing alone.
- **p5 is not the problem.** With today's Scenes, a message arriving from another thread waited at most 4.4 ms in Chrome. Output buffering dominates, so moving rendering off the main thread isn't justified.

## How to read the evidence

Each figure carries one of these labels:

| Label | Meaning |
|---|---|
| **Measured** | Timed with instruments by the cited source, or timed by my probe in this repo |
| **Reported** | What a browser API returned. It is the browser's estimate, not a timed acoustic delay |
| **Source read** | Read from browser source code on 2026-11-02, not run |
| **Estimate** | My arithmetic or judgement |
| **Secondary** | A paper I didn't read, as summarised by one I did |

## Latency budget (Device, Chrome, this Mac)

| Stage | Time | Evidence |
|---|---|---|
| Key contact to MIDI arriving at the computer | Varies by up to 8 ms; the fixed part is unknown | **Measured** on two keyboards by [Schmid et al. 2024][schmid], who attribute the variation to 125 Hz USB polling |
| USB MIDI transfer | About 0.2 to 0.5 ms beyond cable time | **Measured** on 5-pin interfaces by [Microsoft][ms-midi]; the round trip was 1.2 to 1.5 ms, of which about 0.96 ms is cable time for a 3-byte message. It doesn't test a keyboard's own USB port |
| Waiting for the main thread | p99 3 ms or less, max 4.4 ms | **Measured** here, using a stand-in for MIDI (see below) |
| Audio output path | 26 to 35 ms | **Reported** here (see below) |
| Air, laptop speakers at about 0.5 m | About 1.5 ms | **Estimate** from about 3 ms per metre ([Schmid et al. 2024][schmid]) |
| **Total on MacBook speakers** | **About 30 to 50 ms** | **Estimate** |

The hand-off inside the browser, from its MIDI service to the page, wasn't timed. For wired output, the estimate of 15 to 30 ms assumes an output path of about 10 to 20 ms. [RTINGS][rtings] measured 7 ms for one wired headset, and [McPherson et al. 2016][mcpherson] measured 5.1 ms total from USB MIDI through Max/MSP on a 2014 MacBook's built-in audio with 32-sample blocks. That second figure suggests the operating system and hardware can go much lower than the browser reports here, so the 24 to 32 ms value on this Mac needs an acoustic check.

## `latencyHint`, `baseLatency` and `outputLatency`

**What the spec says.** [The Web Audio spec][webaudio] defines these:

- `latencyHint` is a preference. `interactive` is the default and asks for the lowest latency possible without glitching. A number of seconds is also allowed, and it's up to the browser how to interpret it.
- `baseLatency` is the processing latency between the destination node and the audio subsystem.
- `outputLatency` is an estimate of the time from the browser requesting playback to the device processing the first sample. It can change while the context runs.
- `getOutputTimestamp()` maps the audio clock to the performance clock.

**What each browser does:**

| Browser | `latencyHint` | `baseLatency` | `outputLatency` |
|---|---|---|---|
| Chrome | Honoured. On Mac the default output buffer is 256 frames and the minimum is 128 (**source read**: [limits.h][cr-limits], [audio_manager_mac.cc][cr-mac]) | The larger of the hardware buffer and the render quantum ([audio_context.cc][cr-ctx]) | Rounded to 8 ms without microphone permission, 1 ms with it ([audio_context.cc][cr-ctx]) |
| Firefox | Ignored: the constructor doesn't read it ([AudioContext.cpp][ff-ctx]) | Always 0, because Firefox doesn't buffer ([padenot in spec issue 2467][issue2467]) | Measured by its audio graph; a 2021 test found it reported less than half the real delay ([Kaufman][kaufman]) |
| Safari | Ignored: the code has a FIXME where it would go ([AudioContext.cpp][wk-ctx]) | One destination buffer. WebKit asks for a 128-frame buffer while Web Audio is active ([MediaSessionManagerCocoa.mm][wk-session]) | Available from Safari 18.4 ([web.dev][webdev]) |

**Reported values on this Mac** (M3 Pro, macOS 26.6.2, built-in speakers at 44.1 kHz). "Output side" is `currentTime` minus `getOutputTimestamp().contextTime`, which I'm using as the total delay on the output side. Headless Chrome 156 and Firefox 157 ran with throwaway profiles.

| Browser | Hint | `baseLatency` | `outputLatency` | Output side |
|---|---|---|---|---|
| Chrome | `interactive` | 5.8 ms | 24 to 32 ms | 32 to 35 ms |
| Chrome | `0` | 2.9 ms | 24 ms | 26 ms |
| Chrome | `balanced` | 10 ms | 32 ms | 44 ms |
| Chrome | `playback` | 23 ms | 40 ms | 67 ms |
| Firefox | Any | 0 ms | 23.4 ms | 23.4 ms |

So `latencyHint: 0` looks about 6 to 9 ms faster than the default in Chrome. The app uses the default today: `defaultAudioContextFactory` calls `new Ctor()` with no options. I didn't test `0` for dropouts, and it could glitch once many sample voices are sounding.

**Other platforms are unverified.** I measured no Windows or Linux figures, and no Safari figures anywhere. Chromium's source says Linux has a minimum hardware buffer of 512 frames, and that Windows allows either the IAudioClient3 minimum or multiples of the default buffer ([audio_latency.cc][cr-latency]). The only cross-browser timing I found is one 2021 loopback on a 2016 MacBook: [Kaufman][kaufman] got about 19 ms in Chrome and 14 ms in Firefox when tuned, and 67 ms and 55 ms with defaults including microphone processing.

**Jitter comes with the block size.** [McPherson et al. 2016][mcpherson] found that jitter falls at intervals of the audio block, so smaller blocks improve both latency and jitter. A note started "now" also has to wait for the next block, and Chrome's `currentTime` appears to advance by `baseLatency` ([issue 2467][issue2467]). That is up to about 5.8 ms of timing variation at the default buffer here (**estimate**).

## Audio output differences, including Bluetooth

**Measured Bluetooth figures:**

| Headphones | Codec | Latency | Source |
|---|---|---|---|
| Plantronics BackBeat Pro 2 | Wired | 7 ms | [RTINGS][rtings] |
| Plantronics BackBeat Pro 2 | SBC | 173 ms; 248 ms in the other test | [RTINGS][rtings]; [SoundStage][soundstage] |
| Plantronics BackBeat Pro 2 | aptX | 166 ms | [RTINGS][rtings] |
| Sony WH-1000XM5 | SBC | 241 ms | [RTINGS][rtings] |
| Razer Barracuda Pro Wireless | SBC | 113 ms | [RTINGS][rtings] |
| Focal Sphear Wireless | SBC / aptX | 181 ms / 112 ms | [SoundStage][soundstage] |
| BackBeat Pro 2, MEE Matrix Cinema, Sennheiser MTW | aptX Low Latency | 34, 31, 54 ms | [SoundStage][soundstage] |

The RTINGS figures come from search excerpts, because the full article wouldn't load. These are consumer-lab tests: I found no peer-reviewed measurement of Bluetooth audio latency, and no reliable figure for AirPods. A trade article gives roughly 100 ms for Bluetooth Classic and 20 to 30 ms for an optimised LE Audio link ([audioXpress][audioxpress]), but that is a vendor-side claim.

**Detecting it.** `outputLatency` should rise on Bluetooth, since the spec says it can change with the device, but I didn't test that and its accuracy varies. It can support a soft hint, but it can't be a guarantee.

## p5 sharing the main thread

**Web MIDI runs on the main thread in Chrome.** `MIDIAccess::DidReceiveMIDIData` asserts that it's on the main thread ([midi_access.cc][cr-midi]), and `MIDIInput` then dispatches the event directly ([midi_input.cc][cr-midi-input]). The [spec][webmidi] marks the MIDI interfaces as exposed to workers, but its only entry point I could find is `navigator.requestMIDIAccess()`, so I found no supported way to receive MIDI off the main thread. An AudioWorklet wouldn't help, because the note still has to pass through the main thread first.

**The probe.** I ran the app's five Scene choices in a dev build from the main checkout (Crystals on, Sound off), for 8 s idle and 8 s playing a six-note chord that changed every 250 ms. A worker posted a timestamped message every 3 to 10 ms, and the page recorded how long each waited. Each row holds about 1,100 messages in each state.

| Scene, playing | Chrome p99 | Chrome max | Firefox p99 | Firefox max |
|---|---|---|---|---|
| No Scene | 1.9 ms | 4.4 ms | 4 ms | 7 ms |
| Starfield | 2.0 ms | 2.4 ms | 5 ms | 6 ms |
| Rain | 2.4 ms | 3.2 ms | 7 ms | 20 ms |
| Great Hall | 2.3 ms | 3.1 ms | 6 ms | 31 ms |
| Underwater | 3.0 ms | 3.9 ms | 11 ms | 27 ms |

Across these runs, no message in Chrome waited over 8 ms; in Firefox, at most 1.4% did, in Underwater.

Chrome's canvas was 3200 x 1600 at 60 Hz. Firefox's was 1600 x 800 at 120 Hz with 1 ms timer resolution, so the two columns aren't a like-for-like comparison.

**What this doesn't prove:**

- A worker message stands in for a MIDI event, which uses a different task queue. No real Device was connected.
- Both browsers ran headless, so a visible window could behave differently.
- It ran on one fast machine. Slower ones will wait longer.

The first attempt, in the app's built-in browser pane, was discarded because the pane was hidden and drew about once per second.

**Dropped frames didn't delay messages.** Underwater had a 100 ms gap between frames in Chrome while messages still arrived within 3.9 ms. Visual stutter and audio delay are separate problems here.

**Order within the handler matters more.** `dispatchNoteOn` runs Crystals, Scene callbacks and subscribers before `synth.noteOn` is called ([VisualizerEngine.ts](../../src/engine/VisualizerEngine.ts)). The later notes of a chord also wait behind the work of the earlier ones.

## What players find acceptable

No study I found tests a pianist playing alone on a digital piano through varied latency. This is the nearest evidence:

| Finding | Task | Evidence |
|---|---|---|
| Aim for under 10 ms, with under 1 ms jitter | Design guideline, not a study result | **Secondary**: Wessel and Wright 2002, via [McPherson et al. 2016][mcpherson] and [Jack et al. 2016][jack] |
| 10 ms rated the same as 0 ms; 20 ms and 10 ±3 ms rated significantly worse. Timing accuracy didn't change | Musicians on a percussive digital instrument | **Measured**: [Jack et al. 2016][jack], extended in [Jack et al. 2018][jack2018] |
| Average noticeable difference 49 ms from no base latency (range 10 to 129 ms), and 27 ms from a 64 ms base (range 5 to 73 ms). More musically sophisticated participants noticed smaller differences | 34 mostly student participants comparing two keys on a MIDI keyboard | **Measured**: [Schmid et al. 2024][schmid] |
| Musicians first noticed a delay at 102 ±65 ms, non-musicians at 180 ±104 ms | Woodblock sound on a computer keypad, reported as immediate or delayed | **Measured**: [van Vugt and Tillmann 2014][vugt] |
| Delay caused large errors in pianists | Pianists with delayed feedback | **Secondary**: Finney, via [Mäki-Patola and Hämäläinen 2004][maki] |
| Musicians keep time up to about 55 ms by playing ahead of the beat | Percussive task | **Secondary**: Dahl and Bresin, via [McPherson et al. 2016][mcpherson] |
| Acceptable latency ranged from 1.4 to 42 ms, depending on instrument and monitoring | Live monitoring | **Secondary**: Lester and Boley, via [Schmid et al. 2024][schmid] |
| Two pianists managed up to 50 ms on fast pieces and 75 ms on slow ones | Ensemble playing, so latency between players | **Secondary**: Chew et al., via [Schmid et al. 2024][schmid] |
| 100 ms acceptable for piano, 20 ms for accordion | Ensemble playing | **Secondary**: Sawchuk et al., via [Schmid et al. 2024][schmid] |

**Two things that might be folklore:**

- *"Pianists are used to delay, so piano is forgiving."* A real piano does have delay inside its action. [Jack et al. 2016][jack] quotes key travel of over 100 ms at pp and 25 ms at ff. But players feel that travel as part of the touch, so it isn't the same as a delay added afterwards. The sources also conflict on the detail: Jack quotes about +35 ms (pp) and -5 ms (ff) from key bottom to hammer strike, while the [KTH lecture][kth] by Askenfelt says that at soft levels key bottom comes after hammer contact and gives only a maximum of about 20 ms. I didn't read the original paper, so don't rely on these numbers.
- *"10 ms is the limit."* It's a guideline for digital instruments, and it was never measured on pianists. Published thresholds run from 1.4 ms to over 100 ms depending on the task, the person and the instrument.

**Bands I recommend for this app (my synthesis):**

| End-to-end latency | Verdict | Reasoning |
|---|---|---|
| Up to 30 ms | Good | Above the 20 ms where percussive ratings fell, but near the 27 to 30 ms thresholds and within the acceptable range for monitoring |
| 30 to 50 ms | Acceptable | Sensitive players will notice, particularly on fast passages, but playing still works |
| 50 to 60 ms | Marginal | Near the 55 ms compensation limit |
| Over 60 ms, including most Bluetooth | Failing | Past the compensation limit |

These are working numbers for prototype [#45](https://github.com/javiert01/MIDI-Scenes/issues/45), and playing on a real keyboard should override them. The target is modest for a reason: MacBook speakers probably can't reliably get under 30 ms in a browser, so a stricter target would fail on the most common setup.

## What the app can do

**Do these, since they're cheap and carry little risk:**

1. **Sound first.** Start the Tone before Crystals, Scene callbacks and subscribers run. This removes a few milliseconds of avoidable wait.
2. **Start the `AudioContext` before the first note.** On a cold start, the first context took 148 ms to start advancing in Chrome and 80 ms in Firefox (**measured** here; later contexts took 6 ms and about 28 ms). The Preview Synth creates its context on the first note, so that note comes out late. Resume it on the gesture that enables sound instead.
3. **Decode every sample before it can be played.** A Tone should only take over once all its samples are decoded into `AudioBuffer`s, so a note never waits on a decode or a download.
4. **Trim leading silence from the shipped samples.** Encoders add padding: AAC priming is 2,112 samples, about 48 ms at 44.1 kHz ([Apple TN2258][apple-aac]), and Ogg Opus recommends a pre-skip of at least 3,840 samples, 80 ms ([RFC 7845][rfc7845]). Players should remove this, but I couldn't confirm `decodeAudioData` does so in every browser. Check the first audible sample in each browser's decoded buffer.
5. **Avoid library scheduling delay.** Tone.js defaults to a `lookAhead` of 0.1 s, which adds 100 ms to live notes unless it's set to 0 or `Tone.immediate()` is used ([Tone.js wiki][tone]).
6. **Tell users about Bluetooth.** Show a soft hint when `outputLatency` is high, such as over about 60 ms. Keep it advisory, because the value is only an estimate.

**Test these in prototype #45 rather than assuming them:**

7. **`latencyHint: 0` in Chrome.** It reported 6 to 9 ms less here. Test it for dropouts at high polyphony with the pedal down. Firefox and Safari ignore it, so it's harmless there.
8. **Scheduling from the event's timestamp.** `MIDIMessageEvent` carries the time the system received the message ([spec][webmidi]). Mapping that through `getOutputTimestamp()` to a start time slightly in the future could trade a few milliseconds of constant delay for less jitter, which [Jack et al. 2016][jack] suggests matters. `webMidiAdapter.ts` currently drops the timestamp: `handler(Array.from(event.data))`.
9. **Measuring it acoustically.** Record a key tap and the speaker on one microphone, then read the gap from the waveform. Compare MacBook speakers and wired output on Chrome. This is what would replace the estimates in this document.

**Don't do this now:** moving p5 to a worker or `OffscreenCanvas`. The measured wait is small next to output buffering, so a large refactor would gain very little.

## The Device sound gesture problem

This came up during the research and affects other tickets. A MIDI message isn't a user gesture: the [HTML spec's list][html-activation] covers only `keydown`, `mousedown`, `pointerdown`, `pointerup` and `touchend`. Without a gesture, an `AudioContext` starts suspended ([Chrome autoplay policy][autoplay]), although Chrome may allow it for origins with high media engagement.

The opt-in click itself can resume the context. But a saved "Device sound on" setting has no gesture after a page reload, so the first notes on the keyboard would be silent until the user clicks or presses a key. The app needs a defined behaviour for this. Today's Preview Synth avoids the issue, because Virtual Input notes come from a gesture.

## Virtual Input in Firefox and Safari

| Stage | Time | Evidence |
|---|---|---|
| Computer keyboard, from the start of key movement to USB | 15 to 60 ms depending on the model | **Measured** by [Luu][luu]; Apple Magic Keyboard is 15 ms. This is a blog, but with an instrumented method |
| Waiting for the main thread | Firefox p99 up to 11 ms, max 31 ms | **Measured** here |
| Audio output, Firefox | 23 ms | **Reported** here |
| Audio output, Safari | Unknown; asks for 128-frame buffers | **Source read** |
| **Total** | **About 40 to 100 ms** | **Estimate** |

Clicks on the Piano Preview weren't timed. [Can I Use][caniuse] lists Safari through 27.1 as having no Web MIDI, and the [WebKit tracking bug][wk-bug] is still open. I found no current formal WebKit position. Firefox has had Web MIDI since version 108, behind a permission ([Chrome blog][midi-permission]), so Device sound could work there, but that's outside this map's stated platform plan.

## Still unverified

- **Any end-to-end acoustic measurement.** Every browser total here is an estimate. This is the most important gap.
- **A real MIDI event's main-thread wait.** The probe used a stand-in.
- **Safari's actual latency, and Windows and Linux on any browser.**
- **`outputLatency` accuracy,** on Bluetooth especially.
- **Whether `decodeAudioData` strips encoder padding** consistently across browsers.
- **Thresholds for pianists on digital instruments.** There's no direct study, and several findings above are secondary. [Jack et al. 2018][jack2018] and the Wessel and Wright, Lester and Boley, Sawchuk and Chew papers weren't read directly.

## Sources

**Specs and platform docs**

- [Web Audio API][webaudio], [Web MIDI API][webmidi], [HTML: user activation][html-activation]
- [RFC 7845: Ogg Encapsulation for Opus][rfc7845], [Apple TN2258: AAC encoder delay][apple-aac]
- [web.dev: audio output latency][webdev], [Chrome: autoplay policy][autoplay], [Chrome: Web MIDI permission][midi-permission], [Can I Use: Web MIDI][caniuse], [WebKit bug 107250][wk-bug]

**Browser source code (read 2026-11-02)**

- Chromium: [audio_context.cc][cr-ctx], [audio_latency.cc][cr-latency], [audio_manager_mac.cc][cr-mac], [limits.h][cr-limits], [midi_access.cc][cr-midi], [midi_input.cc][cr-midi-input]
- Firefox: [AudioContext.cpp][ff-ctx]
- WebKit: [AudioContext.cpp][wk-ctx], [MediaSessionManagerCocoa.mm][wk-session]

**Peer-reviewed or conference papers**

- [McPherson, Jack and Moro 2016, "Action-Sound Latency: Are Our Tools Fast Enough?", NIME][mcpherson]
- [Jack, Stockman and McPherson 2016, "Effect of latency on performer interaction...", Audio Mostly][jack]
- [Jack, Mehrabi, Stockman and McPherson 2018, Music Perception 36(1)][jack2018] (not read directly; via Schmid et al.)
- [Schmid, Ambros, Bogon and Wimmer 2024, "Measuring the Just Noticeable Difference for Audio Latency", Audio Mostly][schmid]
- [van Vugt and Tillmann 2014, PLoS ONE][vugt]
- [Mäki-Patola and Hämäläinen 2004, DAFx][maki]
- [KTH lecture on key bottom and hammer contact, in Askenfelt's piano acoustics lecture series][kth]

**Other measurements and references**

- [Microsoft: USB MIDI device round-trip measurements][ms-midi] (unofficial, one PC)
- [Kaufman: Browser Audio Latency][kaufman] (one machine, 2021)
- [Luu: Keyboard latency][luu]
- [RTINGS: headphone latency][rtings], [SoundStage: latency][soundstage], [audioXpress: LE Audio][audioxpress]
- [Web Audio spec issue 2467][issue2467], [Tone.js wiki: Performance][tone]

[webaudio]: https://webaudio.github.io/web-audio-api/
[webmidi]: https://webaudio.github.io/web-midi-api/
[html-activation]: https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event
[rfc7845]: https://www.rfc-editor.org/rfc/rfc7845.txt
[apple-aac]: https://developer.apple.com/library/mac/technotes/tn2258/_index.html
[webdev]: https://web.dev/articles/audio-output-latency
[autoplay]: https://developer.chrome.com/blog/autoplay
[midi-permission]: https://developer.chrome.com/blog/web-midi-permission-prompt
[caniuse]: https://caniuse.com/webmidi
[wk-bug]: https://bugs.webkit.org/show_bug.cgi?id=107250
[issue2467]: https://github.com/WebAudio/web-audio-api/issues/2467
[cr-ctx]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webaudio/audio_context.cc
[cr-latency]: https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/media/base/audio_latency.cc
[cr-mac]: https://github.com/chromium/chromium/blob/main/media/audio/mac/audio_manager_mac.cc
[cr-limits]: https://github.com/chromium/chromium/blob/main/media/base/limits.h
[cr-midi]: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webmidi/midi_access.cc
[cr-midi-input]: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webmidi/midi_input.cc
[ff-ctx]: https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webaudio/AudioContext.cpp
[wk-ctx]: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/webaudio/AudioContext.cpp
[wk-session]: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm
[mcpherson]: https://nime.org/proc/nime2016_mcpherson/
[jack]: https://doi.org/10.1145/2986416.2986428
[jack2018]: https://qmro.qmul.ac.uk/xmlui/handle/123456789/44614
[schmid]: https://doi.org/10.1145/3678299.3678331
[vugt]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3911931/
[maki]: https://dafx.de/paper-archive/2004/P_011.PDF
[kth]: https://www.speech.kth.se/music/5_lectures/askenflt/keybott.html
[ms-midi]: https://microsoft.github.io/MIDI/kb/usb-midi-device-round-trip-measurements/
[kaufman]: https://www.jefftk.com/p/browser-audio-latency
[luu]: https://danluu.com/keyboard-latency/
[rtings]: https://www.rtings.com/headphones/learn/latency
[soundstage]: https://www.soundstagesolo.com/index.php/features/185-latency-a-new-concern-for-audiophiles
[audioxpress]: https://audioxpress.com/article/wireless-audio-ultra-low-latency-audio-transmission-over-bluetooth-le-audio
[tone]: https://github.com/Tonejs/Tone.js/wiki/Performance
