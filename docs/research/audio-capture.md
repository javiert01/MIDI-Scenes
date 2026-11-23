# Recording audio: the Tone Player, a mic or interface, or a mix, in sync with the canvas

Findings for [How can a recording capture the Tone Player and a mic or audio interface, in sync?](https://github.com/javiert01/MIDI-Scenes/issues/83) on the map [Map: record a performance video in the app](https://github.com/javiert01/MIDI-Scenes/issues/81). Researched 2026-11-22 against Chromium `main` source as of that date. Chromium source moves, so the code facts may go stale. Re-read the linked files before building on a detail.

## Answer

- **Tone Player:** add one `connect()`. The soft-clip ceiling in `TonePlayer.ensureContext()` feeds `ctx.destination` today. Connect it to a `MediaStreamAudioDestinationNode` (MSADN) as well, and take the MSADN's single audio track.
- **Mic or interface:** call `getUserMedia({ audio: { deviceId: {exact}, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: {ideal: 2}, latency: {ideal: 0.01} } })`. With all three processing flags off, Chromium takes its "unprocessed" raw-hardware path. That path uses the device's native sample rate and channel count and applies none of Chrome's processing. On Windows it also requests WASAPI raw mode, which skips system effects where the device supports it. Then check `track.getSettings()`. If another tab already holds the device open with processing, Chrome can lock the new track to those settings.
- **Picking channels:** Chrome gives the page at most a stereo pair. On macOS, a device with more than two inputs is opened as stereo, and the page doesn't choose which pair. Within that pair, a `ChannelSplitterNode` picks input 1, input 2 or both, and duplicates a mono input to both sides. Inputs 3 and up are out of reach in Chrome.
- **Mix:** do the mix in Web Audio. Chrome's MediaRecorder records only the first audio track, so the recorder must get one already-mixed track. The graph is `MediaStreamTrackAudioSourceNode(mic)` → gain → MSADN, plus the Tone Player ceiling → `DelayNode` → gain → the same MSADN. For mic-only recordings, skip Web Audio and hand the `getUserMedia` track straight to the recorder.
- **Latency:** the piano's own sound reaches the recording later than its MIDI, by the input latency (about 10–30 ms, **estimate**). Against the video that's harmless: sound arriving after the picture is the forgiving direction, and ITU-R BT.1359 puts detectability at about 125 ms of sound delay. In a mix it's audible, because the Tone Player and the piano play the same notes about 20 ms apart, which smears each attack. Compensate by delaying the Tone Player's recording branch with a `DelayNode`. Set the delay from a short calibration: the user plays a few notes, and the app compares MIDI arrival times with the onsets in the mic signal. `track.stats.latency` (Chrome 125+) gives a starting value.
- **Drift over 15 minutes:** there's no cumulative timestamp drift. Chrome stamps canvas frames, MSADN audio and mic audio on the same system clock (`base::TimeTicks`), and the recorder writes those stamps as given. Two second-order risks are unmeasured:
  1. Chrome never reconciles audio sample counts against those timestamps. If the sound card's crystal runs fast or slow, the encoded audio's length can differ from its stamped length by roughly 20–100 ppm, which is 18–90 ms by the end of a 15-minute take (**estimate**). How much of that a player shows depends on the container and the player.
  2. In a mix, the mic crosses from the input device's clock to the output device's clock through a FIFO with no drift correction. Each overflow or underrun is one dropped or zero-filled buffer, an audible click. At 50 ppm that might happen about once per 10 minutes (**estimate**). Avoid it by running the `AudioContext` on the interface's own output (`setSinkId`, Chrome 110+), so input and output share one clock.

  A 15-minute probe on real hardware settles both.
- **Hard blocker? No.** Everything above works in the web app. The real limits are a stereo pair at most, 16-bit capture and the device's native rate. Electron couldn't lift them, because it runs the same Chromium capture code. Only a desktop app with its own native audio layer could, which is the same as asking for a DAW. Multitrack interfaces with the piano on inputs 3 and up can route it to 1–2 in the interface's own mixer software.

## How to read the evidence

| Label | Meaning |
|---|---|
| **Spec** | W3C spec text (Media Capture and Streams CRD of 2026-11-19, Media Capture Extensions ED, Web Audio ED of 2026-11-17) |
| **Source read** | Read from Chromium `main` on 2026-11-22, not run |
| **Docs** | MDN or developer.chrome.com |
| **Estimate** | My arithmetic or judgement. Nothing was measured for this ticket |

## 1. Routing the Tone Player into the recording

Today's output chain is voice → Tone gain → master → drive → soft-clip `WaveShaperNode` → `ctx.destination`. It's built in `TonePlayer.ensureContext()` (`src/engine/tonePlayer.ts`, around lines 389–406).

- An MSADN has one input and no outputs. Its `stream` holds a single audio track with as many channels as the node, two by default (**Docs**, [MDN MediaStreamAudioDestinationNode][mdn-msadn]). Chromium rejects a `channelCount` above its `kMaxChannelCountSupported` (**Source read**, [media_stream_audio_destination_node.cc][cr-msadn]).
- Plan: create the MSADN only while recording. Connect the ceiling, which carries the whole instrument, Virtual Input and Device notes alike, to it. `AudioContextLike` in `src/engine/audio.ts` needs `createMediaStreamDestination()`, and for the mix `createMediaStreamTrackSource()`/`createChannelSplitter()`/`createDelay()`, added to the seam so the fake context can still stand in.
- **Timestamps.** Chromium stamps MSADN audio with `base::TimeTicks::Now()` when the render thread hands it over, not with its playout time. A TODO in the code notes this (crbug.com/1302080). It then rebuffers into 10 ms chunks, offsetting each chunk's stamp by its frame delay (**Source read**, [webaudio_media_stream_source.cc][cr-wamss]). Render happens about one output buffer ahead of the speakers. The recorded Tone Player is therefore stamped when it was synthesised, which is right after the MIDI arrived. That's the same moment the visuals react, give or take a frame, and ADR-0009 calls the Tone Player before dispatch. The recorded Tone Player sits within about a frame of the Crystals, and the output latency the user hears doesn't enter the file (**Estimate**).
- ADR-0009's consequence still holds. With Device sound on, the Tone Player plays the Device's notes, so a recording that uses only the mic should normally have Device sound off. If it's on, the Tone Player goes into the file only when the user picked "Tone Player" or "mix".

## 2. `getUserMedia` constraints for music

**Spec** ([Media Capture and Streams, CRD 2026-11-19][mcs]): `echoCancellation` is now `true`, `false`, or a mode: `"all"` removes everything the system plays, and `"remote-only"` removes only audio from peer connections. `autoGainControl`, `noiseSuppression`, `sampleRate`, `sampleSize`, `channelCount` and `latency` (in seconds) are all constrainable. The spec doesn't say how a browser satisfies them.

**What Chromium does** (**Source read**, [media_stream_constraints_util_audio.cc][cr-constraints]):

- Chromium chooses among three capture paths: unprocessed (raw hardware), no-APM, and APM (WebRTC's audio processing module). When processing is off, the unprocessed path wins the tie-break.
- `echoCancellation: false`, `noiseSuppression: false` and `autoGainControl: false` are honoured. On the unprocessed path only `false` is even allowed for AGC and noise suppression. The `"all"` and `"remote-only"` strings work for mic capture. `"all"` is offered only where system-wide echo cancellation exists.
- **`sampleRate`:** only the device's native rate is allowed on the unprocessed path. Chrome doesn't resample capture. An `exact` request for another rate fails, and an `ideal` one gets the native rate. On macOS a mismatched rate fails outright (**Source read**, [apple/audio_low_latency_input.cc][cr-mac-in]).
- **`sampleSize`:** always reported as 16, "due to the Signed-16 format". Don't build UI on 24-bit capture.
- **`channelCount`:** only the device's own count is allowed on the unprocessed path. When unconstrained on the APM path, the default is mono.
- **`latency`:** only the unprocessed path can change the hardware buffer size, and only when `latency` is explicitly constrained. Asking for `latency: {ideal: 0.01}` is free and lowers input latency.
- **The lock.** If the device is already open and can't be reconfigured, candidates are limited to the active source's settings, which may include APM. Read `track.getSettings()` after opening, and warn if `echoCancellation`, `noiseSuppression` or `autoGainControl` came back `true`.

**macOS** (**Source read**, [audio_manager_mac.cc][cr-mac-mgr], [apple/audio_low_latency_input.cc][cr-mac-in]):

- With echo cancellation off, Chrome opens the device with the plain HAL output unit (AUHAL), not `VoiceProcessingIO`. The macOS voice-processing path, and the system Mic Modes that ride on it, is therefore never engaged (**Estimate**, on the second half).
- The input rate is the device's hardware rate, with 44.1 kHz as the fallback.
- **Channels:** `GetInputStreamParameters` keeps the device's channel count only when it's 2 or less. Anything else falls back to stereo. Chrome sets no `kAudioOutputUnitProperty_ChannelMap`, so AUHAL's converter picks which device channels reach the stereo pair. My reading is that it takes the first two (**Estimate**, not tested).

**Windows** (**Source read**, [win/audio_low_latency_input_win.cc][cr-win-in]):

- The stream asserts two channels or fewer (`DCHECK_LE(params.channels(), 2)`), and channel layouts above stereo map to "unsupported".
- When echo cancellation isn't requested and the device supports raw processing, Chrome sets `AUDCLNT_STREAMOPTIONS_RAW`, for up to 8 device channels. That bypasses Windows' own effects (APOs). Devices without raw support still go through their driver's effects, and the page can't detect it.
- Capture follows the shared-mode mix format, converting it through an `AudioConverter` where needed. The rate the user set in Windows sound settings is the rate the page gets.

**Multichannel is a long-standing Chromium limit.** A W3C WebRTC WG comment from November 2024 says Chrome's channel count "has been hardcoded to `2`" and points at [Chromium issue 40403559][cr-40403559] ([public-webrtc-logs][w3c-2ch]). I couldn't open the issue to read its current status, because the tracker needs a signed-in browser. The source above shows the cap still holds on `main`. Firefox lets a page ask for more than two channels with `channelCount: {exact: n}` ([Mozilla WebRTC blog][moz-ch]), but this map is Chromium only.

## 3. Picking channels and mixing

- `MediaStreamTrackAudioSourceNode` (`ctx.createMediaStreamTrackSource({ mediaStreamTrack })`) takes a specific track. `MediaStreamAudioSourceNode` takes the "first" track by id order, which isn't stable across browsers (**Docs**, [MDN MediaStreamAudioSourceNode][mdn-msasn]).
- A `ChannelSplitterNode(2)` exposes input 1 and input 2. For a mono source, such as one mic on input 1, route that one output into both inputs of a `ChannelMergerNode`, or into a mono gain feeding a stereo MSADN with `"speakers"` upmixing. Otherwise the video's audio comes out on the left only.
- **Chrome's MediaRecorder records only the first audio track** ("Recording multiple audio tracks is not implemented. Only recording first audio track.") and the first video track. It reads the track list once, at `start()` (**Source read**, [media_recorder_handler.cc][cr-mrh]). The mix therefore has to exist as a single MSADN track before recording starts. Switching sources mid-take would need the graph to switch, not the stream.
- **Bringing the mic into Web Audio costs something.** Chromium's `WebAudioMediaStreamAudioSink` pushes capture data into a FIFO, six batch reads deep, which Web Audio pulls from. It uses an `AudioConverter` with a fixed rate ratio, so its input callback always returns 1.0. On overflow it skips the push. On underrun it zero-fills the bus. There's no drift correction. The sink outputs stereo (**Source read**, [webaudio_media_stream_audio_sink.cc][cr-wamsas]). See section 5 for what that means over a long take.
- **Mic-only recordings shouldn't take this detour.** Hand the `getUserMedia` track to the recorder directly. It keeps its own capture timestamps, which Chrome corrects for hardware latency (section 4), and it never meets the FIFO.
- **Monitoring.** If the Tone Player plays through speakers while the mic is live, the mic records the speakers too. With echo cancellation rightly off, a "mix" would then contain the Tone Player twice. The sidebar should steer users who mix toward headphones, or toward a line or USB feed from the piano rather than a room mic (**Estimate**).

## 4. Input latency and compensation

- **What Chrome already corrects.** On macOS, each capture buffer is stamped with the CoreAudio host time (`mHostTime`), minus the device's reported hardware latency, minus the FIFO's buffering (**Source read**, [apple/audio_low_latency_input.cc][cr-mac-in]). The recorder uses those stamps (section 5). A mic track recorded directly is therefore already shifted back toward the moment the sound hit the mic, as far as the driver's latency figure is honest.
- **What it doesn't.** After the Web Audio detour, the mic is re-stamped with `Now()` at render (section 1). The correction is lost, and the FIFO's delay is added. In a mix, both sources are re-stamped the same way, so what matters is their offset from each other: the mic is late by its input path plus the FIFO.
- **Measuring it.** `MediaStreamTrack.stats` (`MediaStreamTrackAudioStats`) has `latency`, `averageLatency`, `minimumLatency` and `maximumLatency`, in milliseconds. They run from "an audio input device has acquired a signal" to when it's available to sinks. Sink-side processing isn't included (**Spec**, [Media Capture Extensions][mce]). It shipped in Chrome, Edge and Opera 125+, with no Firefox or Safari support ([caniuse][caniuse-stats], [blink-dev Intent to Ship][i2s-stats]). It doesn't include the Web Audio sink FIFO, or the piano's own key-to-sound time.
- **Recommended compensation** (**Estimate**, a design proposal):
  1. **Calibrate.** The user plays a few staccato notes. The app already timestamps MIDI arrivals (`performance.now()`). An `AudioWorklet` or `AnalyserNode` on the mic branch finds each onset. `AudioContext.getOutputTimestamp()` maps context time to performance time. The median gap is the mic's lateness relative to MIDI, measured end to end, piano included. Seed it with `track.stats.latency` and let calibration refine it.
  2. **Mix mode:** set a `DelayNode` on the Tone Player's recording branch, not its monitoring branch, to that gap. The two copies of each note then land together. The video, which follows MIDI, ends up ahead of both by the same amount, and that's the forgiving direction (next point).
  3. **Mic-only and mix vs video:** leave it unless calibration finds more than about 45 ms. If the encoder ticket picks a WebCodecs and muxer pipeline, where the app writes the timestamps, subtract the gap from the audio timestamps and get exact alignment for free. MediaRecorder offers no per-track offset.
- **How much offset viewers notice.** ITU-R BT.1359-1: "the thresholds of detectability are about +45 ms to −125 ms and thresholds of acceptability are about +90 ms to −185 ms", where + means sound leads vision ([ITU-R BT.1359-1][itu]). Those thresholds come from television material, not piano hands, and a sharp key strike may be judged more strictly. Treat about 45 ms of sound lag as the comfortable budget (**Estimate**). A typical input latency of 10–30 ms fits inside it. It won't fit if Bluetooth or heavy driver buffering is involved.

## 5. A/V sync over a 15-minute take

**Every stream stamps on one clock** (**Source read**):

| Stream | Timestamp source |
|---|---|
| Canvas `captureStream` frames | `base::TimeTicks::Now()` taken when the new-frame callback is created, made relative to the first frame ([canvas_capture_handler.cc][cr-canvas]) |
| MSADN audio (Tone Player, or the mix) | `base::TimeTicks::Now()` at render, plus a per-chunk offset ([webaudio_media_stream_source.cc][cr-wamss]) |
| Direct mic track (macOS) | CoreAudio host time minus hardware latency ([apple/audio_low_latency_input.cc][cr-mac-in]) |

The recorder passes those stamps through:

- The audio recorder sends each chunk with its `capture_time` ([audio_track_recorder.cc][cr-atr]). The Opus encoder stamps a packet with `capture_time` minus the input buffer's duration. It doesn't count samples and doesn't correct drift. It resamples to 48 kHz and keeps at most two channels ([audio_track_opus_encoder.cc][cr-opus]).
- The muxer's timestamp adapter makes every track relative to one shared first timestamp. It subtracts paused time and forces each timestamp to be no earlier than the last. It never rewrites audio from sample counts ([muxer_timestamp_adapter.cc][cr-mta]).

There's therefore no mechanism that accumulates drift between the canvas track and the audio track's timestamps. Both follow the system's monotonic clock over 5 or 15 minutes alike.

**What's left** (**Estimate**, unmeasured):

1. **The sample-count mismatch.** The audio samples are produced at the sound card's clock, but stamped against the system clock. If the card runs at 48 000 Hz × (1 ± ε), the encoded audio is ε × duration longer or shorter than its stamps say. Consumer crystals are often specified somewhere around ±20–100 ppm, which is 18–90 ms over 15 minutes. Whether a player shows that depends on the container and the player. In MP4, sample durations live in the sample table, so it hangs on how Chrome's MP4 muxer, or the JS muxer the encoder ticket picks, turns stamps into durations. Most players slave video to the audio clock. If the durations are fixed per frame, the error appears as gradual drift. If they're derived from the stamps, it may not appear at all. The worst case, 90 ms of sound lead, would be past the 45 ms detectability threshold, so this needs a probe, not a guess.
2. **The mix's two-clock FIFO.** The mic enters the `AudioContext`, clocked by the output device, through a FIFO with no drift correction (section 3). With different input and output hardware, for example a USB interface in and MacBook speakers out, the FIFO slowly fills or drains. Each overflow drops a capture buffer, and each underrun inserts a zero-filled one: a click, not a sync shift. At 50 ppm and 48 kHz the FIFO gains or loses about 2.4 frames a second. A few hundred frames of headroom then means an event about every few minutes to 10 minutes. **Mitigations:**
   - `ctx.setSinkId(<the interface's output deviceId>)` (Chrome 110+, [developer.chrome.com][setsinkid], [MDN][mdn-setsinkid]) runs the context on the interface's own clock, and the input shares it. Match input and output by `MediaDeviceInfo.groupId`. Monitoring then comes out of the interface's headphone jack, which is what a player with an interface uses anyway.
   - Mic-only recordings bypass the FIFO altogether.
3. **Pauses and hidden tabs** belong to the failure ticket. The adapter already subtracts paused time. Canvas capture stalls when the tab is hidden, while `AudioContext` keeps running.

**Probe to run before the spec** (a prototype ticket, not done here): record 15 minutes in Chrome on macOS and Windows of a Tone Player click every 2 s and a canvas flash on the same tick, mixed with the mic from a USB interface that hears the click. Measure flash-to-click and click-to-mic offsets at 0, 5, 10 and 15 minutes in the downloaded MP4, and count the clicks in the mic track. Run it with and without `setSinkId` to the interface.

## 6. Hard blocker?

**No.** Each of the ticket's needs is met in Chromium today:

| Need | Web status |
|---|---|
| Tone Player into the file | MSADN, one `connect()` |
| Mic or interface, unprocessed | Unprocessed path. Raw mode on Windows where the driver supports it |
| A mix, chosen per recording | Web Audio graph into one MSADN track |
| Latency compensation | `DelayNode` plus a calibration, or timestamp offsets if the encoder ticket goes WebCodecs |
| Sync over 15 minutes | One clock for all timestamps. Residual risks are measurable and mitigable |

The real limits are below. Electron couldn't lift them, because it shares this capture stack, so they don't argue for the desktop app ADR-0001 would weigh:

- **At most a stereo pair from an interface,** and on macOS the page can't choose which pair. A multitrack interface's routing software is the workaround.
- **16-bit capture at the device's native rate.** Inaudible after AAC or Opus at recording bitrates (**Estimate**).
- **A device already open elsewhere with processing can lock the settings.** Detect it with `getSettings()` and tell the user.

## Sources

- [Media Capture and Streams, W3C CRD 2026-11-19][mcs]
- [Media Capture Extensions, editor's draft (`MediaStreamTrackAudioStats`)][mce]
- [Web Audio API, editor's draft 2026-11-17][webaudio]
- [MDN: MediaStreamAudioDestinationNode][mdn-msadn], [MediaStreamAudioSourceNode][mdn-msasn], [AudioContext.setSinkId()][mdn-setsinkid]
- [developer.chrome.com: Change the destination output device in Web Audio][setsinkid]
- [blink-dev: Intent to Ship MediaStreamTrack Stats (Audio)][i2s-stats], [caniuse: MediaStreamTrackAudioStats latency][caniuse-stats]
- Chromium source (`main`, read 2026-11-22): [media_stream_constraints_util_audio.cc][cr-constraints], [audio_manager_mac.cc][cr-mac-mgr], [apple/audio_low_latency_input.cc][cr-mac-in], [win/audio_low_latency_input_win.cc][cr-win-in], [webaudio_media_stream_audio_sink.cc][cr-wamsas], [webaudio_media_stream_source.cc][cr-wamss], [media_stream_audio_destination_node.cc][cr-msadn], [canvas_capture_handler.cc][cr-canvas], [media_recorder_handler.cc][cr-mrh], [audio_track_recorder.cc][cr-atr], [audio_track_opus_encoder.cc][cr-opus], [muxer_timestamp_adapter.cc][cr-mta]
- [Chromium issue 40403559][cr-40403559] (not readable without signing in), cited via [W3C public-webrtc-logs, Nov 2024][w3c-2ch]
- [Mozilla WebRTC blog: channelCount microphone constraint][moz-ch]
- [ITU-R BT.1359-1, Relative timing of sound and vision for broadcasting][itu]

[mcs]: https://www.w3.org/TR/mediacapture-streams/
[mce]: https://w3c.github.io/mediacapture-extensions/
[webaudio]: https://webaudio.github.io/web-audio-api/
[mdn-msadn]: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode
[mdn-msasn]: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioSourceNode
[mdn-setsinkid]: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId
[setsinkid]: https://developer.chrome.com/blog/audiocontext-setsinkid
[i2s-stats]: https://groups.google.com/a/chromium.org/g/blink-dev/c/xcGJyic7ttI
[caniuse-stats]: https://caniuse.com/mdn-api_mediastreamtrackaudiostats_latency
[cr-constraints]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_audio.cc
[cr-mac-mgr]: https://chromium.googlesource.com/chromium/src/+/main/media/audio/mac/audio_manager_mac.cc
[cr-mac-in]: https://chromium.googlesource.com/chromium/src/+/main/media/audio/apple/audio_low_latency_input.cc
[cr-win-in]: https://chromium.googlesource.com/chromium/src/+/main/media/audio/win/audio_low_latency_input_win.cc
[cr-wamsas]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/mediastream/webaudio_media_stream_audio_sink.cc
[cr-wamss]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/mediastream/webaudio_media_stream_source.cc
[cr-msadn]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webaudio/media_stream_audio_destination_node.cc
[cr-canvas]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/mediacapturefromelement/canvas_capture_handler.cc
[cr-mrh]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/mediarecorder/media_recorder_handler.cc
[cr-atr]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/mediarecorder/audio_track_recorder.cc
[cr-opus]: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/mediarecorder/audio_track_opus_encoder.cc
[cr-mta]: https://chromium.googlesource.com/chromium/src/+/main/media/muxers/muxer_timestamp_adapter.cc
[cr-40403559]: https://issues.chromium.org/issues/40403559
[w3c-2ch]: https://lists.w3.org/Archives/Public/public-webrtc-logs/2024Nov/0191.html
[moz-ch]: https://blog.mozilla.org/webrtc/channelcount-microphone-constraint/
[itu]: https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-1-199811-I!!PDF-E.pdf
