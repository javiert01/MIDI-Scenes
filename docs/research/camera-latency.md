# How far behind the MIDI camera footage arrives

Findings for the research ticket [How far behind the MIDI does camera footage arrive, and can the app measure it?](https://github.com/javiert01/MIDI-Scenes/issues/85), on the map [Record a performance video in the app](https://github.com/javiert01/MIDI-Scenes/issues/81). Researched 2026-11-22. The MIDI-side figures come from the earlier research [What latency can Web MIDI to Web Audio reach, and what is playable?](https://github.com/javiert01/MIDI-Scenes/blob/research/tone-latency/docs/research/tone-latency.md).

## Answer

- **Expected offset:** in the composite, camera footage of a key press should land an **estimated 40 to 120 ms after its Crystal** for a webcam or USB camera at 30 fps in good light. Expect roughly 10 to 15 ms less at 60 fps, and roughly 20 to 40 ms more if the camera falls to 15 fps in dim light. **Continuity Camera has no published measurement.** Treat it as unknown, probably at the high end or above it, especially over Wi-Fi. Every one of these figures is an estimate assembled from glass-to-glass measurements of other setups. Nothing was timed on this app.
- **That's noticeable.** The Crystals and the recorded sound both run ahead of the picture, and sound ahead of picture is the direction viewers forgive least. [ITU-R BT.1359][bt1359] puts detection at about 45 ms and the acceptability limit at about 90 ms for sound before picture. [EBU R37][r37] allows at most 40 ms end to end. Doing nothing isn't an option for typical cameras.
- **Stability:** the average offset should hold steady over a take as long as the camera keeps its frame rate. Chrome shows a local camera's newest frame with no queue, so lag can't build up (**source read**). Each frame still jitters by up to one camera frame (33 ms at 30 fps). A correction can't remove that, but it is within the thresholds above. The real risk is the camera changing frame rate during a take, usually from auto-exposure in dim light.
- **Measurement in the browser:** not from timestamps alone. In Chrome on macOS and Windows, `requestVideoFrameCallback`'s `captureTime` is the moment Chrome's capture service *received* the frame, not when light hit the sensor. It misses exposure, readout, the camera's own processing and USB, which make up most of the delay (**source read**). Only an optical check can measure the whole offset: something the camera sees, compared with the MIDI note-on time.
- **Recommended correction:** delay the MIDI-driven side by the offset. Hold note events for D ms before the Crystals and Scenes get them, and run the *recorded* audio through a delay of D. Keep the pianist's monitoring audio undelayed. Set D with a **calibration step**: the user plays a few notes and moves a slider until the Crystals land with their fingers in the live preview. An automatic "play this key a few times" measurement can be added if a prototype shows it's reliable.
- **Hard blocker forcing a desktop app: no.** A native app gets the same camera delay. At best it can read the operating system's frame timestamp, which still misses the sensor and USB part, so it would need the same calibration.

## How to read the evidence

| Label | Meaning |
|---|---|
| **Measured** | Timed with instruments by the cited source |
| **Source read** | Read from Chromium source code at commit [`350e067`][cr-commit] (2026-11-23), not run |
| **Spec** | What a specification says |
| **Estimate** | My arithmetic or judgement |
| **Secondary** | A claim I found only as summarised by another source |
| **Anecdotal** | A forum or guide figure with no stated method |

## What the offset is made of

What matters is the gap *on the canvas*, between a Crystal appearing and the camera frame that shows the key going down. The display's own latency doesn't count, because both reach the screen and the recording in the same canvas frame.

| Stage | Camera path | MIDI path |
|---|---|---|
| Event to the computer | Exposure, sensor readout, the camera's processing and compression, USB, OS driver. Includes a wait of 0 to 1 frame for the next exposure (33 ms at 30 fps) | Key contact to USB MIDI: varies by up to 8 ms, plus about 0.5 ms of transfer (**Measured**, via the earlier latency research) |
| Into the page | Chrome capture service, then renderer, then the `<video>` element. Not measured. Visible as `now − captureTime` in `requestVideoFrameCallback` | Main-thread wait: p99 3 ms or less, max 4.4 ms (**Measured** with a stand-in, earlier latency research) |
| Onto the canvas | Drawn at the next p5 frame: 0 to 16.7 ms at 60 Hz | Crystal spawns at the next p5 frame: 0 to 16.7 ms. Same term on both sides, so it largely cancels |
| **Sum** | **Glass to canvas** | **About 5 to 13 ms before the draw** (**Estimate**) |

The offset is glass-to-canvas minus the MIDI path.

### Published glass-to-glass measurements

Glass to glass means from light reaching the lens to light leaving the display, so each figure below includes a display term that the composite doesn't have. That term is about half a refresh plus the panel's response, roughly 10 to 25 ms on a 60 Hz panel (**Estimate**).

| Setup | Glass to glass | Evidence |
|---|---|---|
| Industrial FireWire camera at 50 fps, 60 Hz monitor, Linux | Min 19.1, mean about 33, max 52.4 ms (std 6.9 ms, n = 250). At 25 fps: 24.8 / 50.4 / 78.7 ms. At 300 fps: 8.1 / 15.5 / 23 ms | **Measured** with an LED and phototransistor, accurate to 0.5 ms ([Bachhuber and Steinbach 2016][bachhuber2016]) |
| Purpose-built VGA prototype, off-the-shelf parts | Mean 21.2 ms | **Measured** ([Bachhuber et al. 2018][bachhuber2018], abstract only) |
| Unnamed USB webcam at 30 fps, 165 Hz monitor, Linux | Best 32, average 41.2, worst 51.5 ms. At 10 fps: 53 / 82.9 / 113 ms | **Measured**, but on a personal blog with no camera model or sample count ([comicfans 2026][comicfans]) |
| Three USB3 cameras (Logitech C925e, RealSense D435, a LeRobot camera) at 30 fps, 60 Hz display, Ubuntu, shown directly | About 110 ms; no notable difference between cameras | **Measured** by reading timecodes off an infinite mirror, on a vendor blog ([Transitive Robotics 2026][transitive]) |
| Logitech C920 in OBS | 122 to 165 ms; "4½ to 5½ frames at 30 fps" | **Anecdotal** ([OBS forum][obs-c920]) |
| iPhone through Continuity Camera | No measurement found. One OBS guide suggests an audio offset of 80 to 120 ms without saying how it got that | **Anecdotal** ([obs-versions guide][obs-iphone]) |

[Bachhuber and Steinbach 2016][bachhuber2016] model the camera's wait as uniform over one frame period, and the display's wait as uniform over one refresh. Added to a nearly constant processing delay, these give a trapezoid-shaped spread, which their measurements match. That is why each table row spans about one frame plus one refresh, and why higher frame rates shift the whole range down.

### Estimated offset by camera

Each row subtracts a display term of 10 to 25 ms and the MIDI path of 5 to 13 ms from the measurements above. All are **Estimates**.

| Camera | Estimated camera-behind-Crystal offset |
|---|---|
| Webcam or USB camera, 30 fps, good light | 40 to 120 ms (the low end is the blog webcam, the high end is the three-camera vendor test) |
| Same at 60 fps | About 10 to 15 ms lower on average. The average wait for the next exposure halves, saving about 8 ms, and a shorter exposure trims more. Bachhuber's step from 25 to 50 fps cut the mean by 17 ms |
| Same, dropping to 15 fps in dim light | About 20 to 40 ms higher. The blog webcam's average rose 42 ms going from 30 to 10 fps |
| iPhone through Continuity Camera | Unknown. Wired over USB is likely lower than wireless, which Apple supports over Wi-Fi and Bluetooth ([WWDC22 session 10018][wwdc]) |

Continuity Camera offers 640×480 up to 1080p at up to 30 or 60 fps, plus a 1920×1440 4:3 format ([WWDC22 session 10018][wwdc]). Apple's support page says the iPhone may turn off its Wi-Fi to protect video quality, and that plugging it in prevents this ([Apple support][apple-cc]). It doesn't publish latency.

### What the viewer sees as "the moment"

Note-on isn't the moment the finger first touches the key. A digital keyboard fires note-on near the bottom of the key's travel. Askenfelt's measurements on a grand piano give key speeds of about 0.3 to 0.5 m/s at mezzo forte and seldom above 1 m/s at forte ([KTH lecture][kth-motion]). Over a key dip of roughly 10 mm, that is about 10 to 35 ms of visible downward travel before note-on (**Estimate**; the dip depth and the note-on point vary by instrument). A viewer probably reads the key bottoming out as the event, so the camera offset is what to correct. The key starting to move a little earlier gives a small margin in the camera's favour, not a fix.

## Is the delay noticeable?

In the composite, both the Crystals and the audio run ahead of the picture. The audio is the Tone Player, played the instant MIDI arrives, or a microphone hearing the real piano. Broadcast research rates this direction, sound ahead of picture, as the less forgivable one.

| Source | Sound before picture | Sound after picture |
|---|---|---|
| [ITU-R BT.1359-1][bt1359] (1998), detectability threshold | About 45 ms | About 125 ms |
| ITU-R BT.1359-1, acceptability threshold | About 90 ms | About 185 ms |
| ITU-R BT.1359-1, recommended allowable error | 22.5 ms | 30 ms |
| [EBU R37][r37] (2007), end to end at emission | 40 ms | 60 ms |

**Spec** values. BT.1359's thresholds average subjective tests in Japan, Switzerland and Australia on newsreader footage. R37's are where 50% of observers notice a break in lip sync. Neither tested music or a visual-to-visual mismatch like Crystal against finger.

On music specifically, [Vatakis and Spence 2006][vatakis] found people judge audio-visual order *less* precisely for music clips than for speech or object actions. For piano clips, the visual stream had to lead the sound for the two to feel simultaneous (**Secondary**: from the abstract and a citing paper; I didn't read the figures). That suggests viewers forgive a picture-first piano clip, but this composite is the opposite case.

**Verdict (Estimate):** an offset of 40 to 120 ms is at or past the point of detection, and the upper half is past acceptable. Aim for a residual average offset of 30 ms or less after correction, which falls inside both standards' sound-first limits. The remaining jitter of up to ±17 ms at 30 fps can't be avoided, and footage shot at 24 fps already carries about ±21 ms ([BT.1359 appendix][bt1359]).

## Is it stable over a take?

- **No build-up in Chrome (source read).** For a local camera, Chrome's MediaStream compositor creates no smoothing buffer and draws the newest frame as it arrives (`RenderWithoutAlgorithm`). The smoothing algorithm is only used for remote WebRTC video ([web_media_player_ms_compositor.cc][cr-compositor]). A slow frame is replaced, not queued, so the delay can't grow over 15 minutes the way it can in apps that buffer. The OBS reports of a C920 "drifting with time" ([OBS forum][obs-drift]) are about OBS's pipeline.
- **Per-frame jitter:** up to one camera frame, plus the part of a 60 Hz canvas frame that doesn't cancel out (**Estimate** from the [Bachhuber and Steinbach][bachhuber2016] model).
- **Frame-rate changes are the real risk.** UVC webcams can lower their frame rate in dim light to lengthen exposure. The [comicfans][comicfans] measurement had to set `exposure_dynamic_framerate=0` on Linux to hold 30 fps. A camera going from 30 to 15 fps partway through a take adds roughly 20 to 40 ms on average (**Estimate**). The app can detect this: count `presentedFrames` in `requestVideoFrameCallback`, or read `MediaStreamTrack.stats` (`deliveredFrames`, `discardedFrames`, `totalFrames`; **Spec**, [mediacapture-extensions][mc-ext], Chrome support not checked). Request a fixed `frameRate` in `getUserMedia` and warn about light before recording.
- **Continuity Camera over Wi-Fi:** wireless delivery may vary more than USB. Nothing published quantifies this (**unverified**).

## What the browser can measure

### `requestVideoFrameCallback` metadata

What the spec says ([video-rvfc][rvfc], WICG Draft Community Group Report, 2024-08-02):

- `presentationTime` is when the frame was submitted for composition.
- `expectedDisplayTime` is when the browser expects it to be visible.
- `captureTime` is, "for video frames coming from a local source, … the time at which the frame was captured by the camera". It should be present for `getUserMedia` sources.
- `receiveTime` and `rtpTimestamp` are for remote WebRTC only.

[mediacapture-extensions][mc-ext] puts `captureTime` relative to `Performance.timeOrigin`, the same clock as `performance.now()`. For local capture, it is the browser's "best estimate" of when capture happened, with no accuracy bound. MDN adds that callbacks can fire a v-sync late, and that `presentedFrames` reveals skipped frames ([MDN][mdn-rvfc]).

What Chrome actually puts in `captureTime` (**source read**):

1. `requestVideoFrameCallback` copies the frame's `capture_begin_time` into `captureTime` when present ([video_frame_callback_requester_impl.cc][cr-rvfc], around line 252).
2. On macOS, Chrome reads the sample buffer's presentation timestamp from AVFoundation. But it **throws that timestamp away unless the `AVFoundationCaptureForwardSampleTimestamps` feature is enabled, and it is disabled by default** ([video_capture_device_avfoundation.mm][cr-avf], lines 49 and 1085 to 1101). The frame is then handed on with `reference_time = base::TimeTicks::Now()`, the moment Chrome received it ([video_capture_device_apple.mm][cr-apple], around line 240).
3. Windows does the same with `MediaFoundationVideoCaptureForwardSampleTimestamps`, also disabled by default ([video_capture_device_mf_win.cc][cr-mf], lines 57 and 115 to 125).
4. In the renderer, a frame without `capture_begin_time` gets `reference_time` instead, explicitly "so there is a captureTime available for local sources for requestVideoFrameCallback" ([video_capture_impl.cc][cr-impl], around line 1226).

So in stock Chrome on Mac and Windows, `expectedDisplayTime − captureTime` measures only **Chrome's own pipeline**, from receiving the frame to displaying it. Exposure, readout, the camera's processing, USB and the OS driver are invisible, and they're most of the 40 to 120 ms. Even with the feature enabled, Apple doesn't document whether its presentation timestamp marks exposure or arrival (**unverified**). Two more limits:

- `captureTime` can be missing for the first several frames of a local stream. A web-platform test was relaxed for exactly this reason (**Secondary**, via a [Firefox WPT sync bug][wpt-sync]).
- Chrome clamps these timestamps for privacy, more finely when the page is cross-origin isolated ([video_frame_callback_requester_impl.cc][cr-rvfc]). Either way the clamping is far below a millisecond, so it doesn't matter here (**Estimate**; the exact resolution wasn't read).

**Use:** `captureTime` makes a good health monitor during a take. It shows a jump in Chrome's own delay, such as under heavy load. It can't measure the offset.

### MIDI side

The [Web MIDI spec][webmidi] gives each `midimessage` a `DOMHighResTimeStamp` for "the time the message was received by the system". `send()` timestamps are relative to the document's navigation start, which suggests the same clock as `performance.now()`, though the spec doesn't say so for received events. The app's `webMidiAdapter.ts` passes only `event.data` to the engine today, so any measurement or scheduled delay needs the timestamp passed through.

### Optical calibration: the only full measurement

To measure glass to canvas, the camera has to see an event whose MIDI time is known. Options:

| Method | How it works | Assessment |
|---|---|---|
| **Slider against a live preview** | The user plays a few notes and drags an offset until each Crystal's birth matches the key landing in the preview. The preview is the composite that gets recorded | Always works, needs no computer vision, and is judged by the same eye a viewer uses. Precision is limited to what a person can see, which is the threshold that matters anyway. **Recommended baseline** |
| **Automatic tap test** | The user plays one key staccato about 10 times. The app watches that key's area in the camera image (known from the key-alignment calibration), finds the frame where the key reaches the bottom, and takes the median gap between that frame's draw time and the note-on time | Each sample is quantised to one camera frame, but the median of N samples narrows to roughly a frame divided by √N: about ±10 ms at 30 fps with 10 taps (**Estimate**). Hands covering the key, lighting and the key-bottom detection all need proving. **Worth a prototype**, as a "measure for me" button that fills in the slider |
| **Camera points at the screen** | The app flashes a patch, and the camera films it | Measures camera plus display, not camera alone, and means re-aiming a camera that's mounted over the keys. Not recommended |

Pixel access for the tap test is available in Chromium either by drawing the `<video>` into a small offscreen canvas in a `requestVideoFrameCallback`, or through `MediaStreamTrackProcessor` frames. Neither was tested here.

## Applying the correction

- **Delay the MIDI-driven visuals, not the camera.** Footage can't be made to arrive sooner. Queue each note-on and note-off, and release it to the engine (Crystals, Scene `onNoteOn`/`onNoteOff`, Piano Preview) on the first draw at or after its arrival time plus D. That keeps today's frame quantisation. A `setTimeout` per event would add timer jitter (**Estimate**).
- **Delay the recorded audio, not the monitoring.** The earlier latency research found more than about 60 ms of key-to-sound delay unplayable. So the pianist keeps hearing the Tone Player at once, and only the branch feeding the recorder goes through a `DelayNode` set to D. The [Web Audio spec][webaudio] allows a `maxDelayTime` up to three minutes. Microphone or interface audio also runs ahead of the camera, so it needs a delay of about D minus its own input latency (a few ms to a few tens of ms; not measured).
- **The pianist sees delayed Crystals.** On screen, Crystals will trail the playing by D, because the screen shows the composite being recorded. Whether that bothers a performer, who mostly watches the keys, is a question for the spec, not a technical blocker. Delaying only an offscreen copy for the recorder would avoid it, but would break "what was on screen is what's in the file".
- **Reduce D at the source.** Ask for a fixed 60 fps where the camera offers it. Use good light so auto-exposure doesn't drop frames. Plug in a Continuity Camera iPhone.
- **Re-check, don't trust.** Calibrate per camera and frame-rate setting. Whether to remember the calibration belongs to the map's open "What's remembered" question.

## Desktop app?

No hard blocker. Electron runs the same Chromium capture code, so it has the same `captureTime` behaviour, although it could enable the sample-timestamp feature with a command-line switch. A native AVFoundation or Media Foundation app could read the OS timestamp directly. Neither removes the sensor, readout and USB delay, or the need for an optical calibration. Everything recommended here runs in a Chromium web page.

## Still unverified

- **Any timing on this app or this Mac.** The offset ranges are estimates from other people's setups. A quick check, such as filming the screen and a key with a 240 fps phone, would anchor them.
- **Continuity Camera latency**, wired or wireless. No published figure exists.
- **Chrome's in-browser share**, `expectedDisplayTime − captureTime`, wasn't measured on a real camera.
- **Whether macOS cameras drop frame rate in dim light** under Chrome's capture settings, and how often.
- **`MediaStreamTrack.stats` support in Chrome** for video tracks.
- **Perception thresholds for music and for Crystal-against-finger timing.** The standards cover lip sync. [Vatakis and Spence][vatakis] was read only as summarised.
- **Where note-on fires in key travel** on common digital pianos.

## Sources

**Specs and platform docs**

- [WICG: HTMLVideoElement.requestVideoFrameCallback()][rvfc], [W3C mediacapture-extensions][mc-ext], [W3C WebCodecs VideoFrame metadata registry][wc-registry]
- [MDN: requestVideoFrameCallback()][mdn-rvfc]
- [Web MIDI API][webmidi], [Web Audio API][webaudio]
- [Apple WWDC22 session 10018: Bring Continuity Camera to your macOS app][wwdc], [Apple support: Continuity Camera][apple-cc]

**Standards on audio-video timing**

- [ITU-R BT.1359-1 (11/1998): Relative timing of sound and vision for broadcasting][bt1359]
- [EBU R37 (2007): The relative timing of the sound and vision components of a television signal][r37]

**Chromium source (read at commit `350e067`, 2026-11-23)**

- [video_frame_callback_requester_impl.cc][cr-rvfc], [video_capture_device_avfoundation.mm][cr-avf], [video_capture_device_apple.mm][cr-apple], [video_capture_device_mf_win.cc][cr-mf], [video_capture_impl.cc][cr-impl], [web_media_player_ms_compositor.cc][cr-compositor], [video_frame_metadata.h][cr-metadata]

**Peer-reviewed papers**

- [Bachhuber and Steinbach 2016, "A System for High Precision Glass-to-Glass Delay Measurements in Video Communication", IEEE ICIP][bachhuber2016]
- [Bachhuber, Steinbach, Freundl and Reisslein 2018, "On the Minimization of Glass-to-Glass and Glass-to-Algorithm Delay in Video Communication", IEEE Trans. Multimedia 20(1)][bachhuber2018] (abstract only)
- [Vatakis and Spence 2006, "Audiovisual synchrony perception for music, speech, and object actions", Brain Research 1111][vatakis] (abstract only)
- [Askenfelt, KTH lecture on key and hammer motion][kth-motion]

**Other measurements and reports**

- [comicfans 2026: Measuring camera latency][comicfans] (personal blog, one unnamed webcam)
- [Transitive Robotics 2026: WebRTC latency, a breakdown][transitive] (vendor blog)
- [OBS forum: C910 and C920 webcam latency][obs-c920], [OBS forum: C920 drifting with time][obs-drift], [obs-versions: iPhone as OBS camera][obs-iphone]
- [Mozilla bug 1837534: WPT sync, captureTime verification timeouts][wpt-sync]

[rvfc]: https://wicg.github.io/video-rvfc/
[mc-ext]: https://w3c.github.io/mediacapture-extensions/
[wc-registry]: https://w3c.github.io/webcodecs/video_frame_metadata_registry.html
[mdn-rvfc]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
[webmidi]: https://webaudio.github.io/web-midi-api/
[webaudio]: https://webaudio.github.io/web-audio-api/
[wwdc]: https://developer.apple.com/videos/play/wwdc2022/10018/
[apple-cc]: https://support.apple.com/102546
[bt1359]: https://www.itu.int/rec/R-REC-BT.1359/en
[r37]: https://tech.ebu.ch/docs/r/r037.pdf
[cr-commit]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a
[cr-rvfc]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a/third_party/blink/renderer/modules/video_rvfc/video_frame_callback_requester_impl.cc
[cr-avf]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a/media/capture/video/apple/video_capture_device_avfoundation.mm
[cr-apple]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a/media/capture/video/apple/video_capture_device_apple.mm
[cr-mf]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a/media/capture/video/win/video_capture_device_mf_win.cc
[cr-impl]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a/third_party/blink/renderer/platform/video_capture/video_capture_impl.cc
[cr-compositor]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a/third_party/blink/renderer/modules/mediastream/web_media_player_ms_compositor.cc
[cr-metadata]: https://chromium.googlesource.com/chromium/src/+/350e067063fff35ee826c7167ae27afa1c36965a/media/base/video_frame_metadata.h
[bachhuber2016]: https://arxiv.org/abs/1510.01134
[bachhuber2018]: https://doi.org/10.1109/TMM.2017.2726189
[vatakis]: https://doi.org/10.1016/j.brainres.2006.05.078
[kth-motion]: https://www.speech.kth.se/music/5_lectures/askenflt/motions.html
[comicfans]: https://comicfans.github.io/2026/02/09/journal-on-camera-latency-measure.html
[transitive]: https://transitiverobotics.com/blog/webrtc-latency-breakdown/
[obs-c920]: https://obsproject.com/forum/threads/webcam-latency-question-logitech-c910-c920.10517/
[obs-drift]: https://obsproject.com/forum/threads/webcam-logitech-c920-image-goes-drifting-with-time-lag.109606/
[obs-iphone]: https://obs-versions.com/blog/obs-iphone-camera
[wpt-sync]: https://bugzilla.mozilla.org/show_bug.cgi?id=1837534
