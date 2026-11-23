# Recording a 5–15 minute canvas and audio take to MP4 in Chromium

Findings for [Can Chromium record a 5–15 minute canvas and audio take to MP4 in real time?](https://github.com/javiert01/MIDI-Scenes/issues/82), part of [Map: record a performance video in the app](https://github.com/javiert01/MIDI-Scenes/issues/81). Researched 2026-11-22.

## Answer

- **Yes, and no hard blocker forces a desktop app.** Current Chrome and Edge can encode 1080p H.264 with AAC audio in real time, write it to an MP4 on the user's disk as it records, and keep memory flat over a 15-minute take.
- **Recommended pipeline:** draw the finished frame on the p5 canvas, then `canvas.captureStream(30)` for video. Mix the audio in Web Audio and take it from a `MediaStreamAudioDestinationNode`. Encode with WebCodecs (H.264 + AAC) and mux with [Mediabunny](https://mediabunny.dev) into a non-fragmented MP4 with `fastStart: 'reserve'`, streamed to a file in the origin private file system (OPFS). Play the take back from that file, then download it.
- **`MediaRecorder` can write MP4 directly** since Chrome 126. It's the simpler fallback, but its output is a fragmented MP4 with a variable frame rate and no stored duration. It would need a remux before it's a clean upload file.
- **The real constraint is visibility:** if the tab is hidden or the window is fully covered, `requestAnimationFrame` stops, the p5 draw loop stops, and the video freezes while the audio keeps going. The app has to stay on screen during a take. That is also true of today's screen-recorder workflow, so it's a rule for the UI, not a blocker. It belongs to the open question "Failure during a take".

## How to read the evidence

| Label | Meaning |
|---|---|
| **Spec** | W3C or WHATWG specification text |
| **Source read** | Read from Chromium or Mediabunny source on 2026-11-22, not run |
| **Docs** | First-party documentation (Chrome Platform Status, MDN, Mediabunny, platform upload specs) |
| **Measured** | Run by me on this Mac (M3 Pro, macOS 26.6.2) on 2026-11-22 |
| **Secondary** | A third-party write-up, not checked against source |
| **Estimate** | My arithmetic or judgement |

## 1. Can MediaRecorder write MP4 directly?

**Yes, since Chrome 126, but the file isn't what upload platforms ask for.**

- **Shipped:** "MP4 container support for MediaRecorder", enabled by default in Chrome 126 on desktop, Android and WebView. It records "MP4 of H264 video and AAC audio" (**Docs**: [Chrome Platform Status 5163469011943424][cps-mp4]). Chrome 136 added `avc3`, `hvc1` and `hev1` codec strings in MP4 (**Docs**: [Chrome Platform Status 6375884229181440][cps-h26x]).
- **Accepted codecs in `video/mp4`:** `avc1`, `avc3`, `hvc1`, `hev1`, `vp9`, `av01` for video, and `mp4a.40.2` (AAC-LC) or `opus` for audio (**Source read**: [`media_recorder_handler.cc`][cr-mrh]). AAC is only offered if a platform AAC encoder exists (`MojoAudioEncoder::IsSupported(kAAC)`). Chromium has one on macOS (AudioToolbox) and Windows (Media Foundation), and none on Linux (**Source read**: [`gpu_mojo_media_client_mac.cc`][cr-mojo-mac], [`gpu_mojo_media_client_win.cc`][cr-mojo-win], [`gpu_mojo_media_client_linux.cc`][cr-mojo-linux]).
- **On this Mac:** `MediaRecorder.isTypeSupported` returned true for `video/mp4;codecs=avc1,mp4a.40.2`, `avc1.640028,mp4a.40.2` and `avc1,opus` in Chrome 157 (**Measured**).
- **The file is fragmented MP4.** Chromium's MP4 muxer writes `ftyp`, `moov`, then `moof`/`mdat` pairs, then an `mfra` index (**Source read**: [`mp4_muxer_delegate.cc`][cr-mp4mux]). A May 2026 test of Chrome 147 found the `moov` duration was 0. Windows 11 Media Player then showed no duration and couldn't seek, though VLC played the file (**Secondary**: [addpipe][addpipe]).
- **Without a `timeslice`, the whole take stays in memory until `stop()`.** The muxer flushes fragments only in "live mode", which a timeslice turns on. Otherwise every fragment is held and written at the end (**Source read**: [`mp4_muxer_delegate.cc`][cr-mp4mux], `FlushFragment()` / `Flush()`).
- **The default bitrate is 2.5 Mbps** (`kDefaultVideoBitRate`), which is too low for 1080p. Set `videoBitsPerSecond` (**Source read**: [`media_recorder.cc`][cr-mr]).
- **Frames drop silently** when too many are queued in the encoder ("Too many frames are queued up. Dropping this one."). Nothing tells the page (**Source read**: [`video_track_recorder.cc`][cr-vtr]).
- **Timestamps come from capture time,** so the frame rate is variable (**Source read**: [`video_track_recorder.cc`][cr-vtr], `capture_begin_time`).

**Verdict:** MediaRecorder works for a quick prototype. For the deliverable, its fragmented file with no duration and a variable frame rate needs a remux to a fast-start MP4 after `stop()` (Mediabunny can do this without re-encoding). Encoding with WebCodecs directly avoids that step and gives the app control over frame rate, bitrate, keyframes and dropped frames.

## 2. WebCodecs plus an in-browser muxer

- **Availability:** WebCodecs and `MediaStreamTrackProcessor` both shipped in Chrome 94 (**Docs**: [Chrome Platform Status 5669293909868544][cps-webcodecs], [5499415634640896][cps-breakout]).
- **On this Mac:** `VideoEncoder.isConfigSupported` returned true for `avc1.640028` (H.264 High, level 4.0) at 1920×1080 and 1080×1920, 30 fps, 8 Mbps, with `prefer-hardware`, `prefer-software` and `latencyMode: 'realtime'`. `AudioEncoder` supported `mp4a.40.2` at 48 kHz and 44.1 kHz, plus Opus (**Measured**, Chrome 157).
- **Mediabunny is the muxer to use.** `mp4-muxer` "has been deprecated in favor of Mediabunny, which entirely supersedes it" and gets no more fixes (**Docs**: [mp4-muxer README][mp4muxer]). Mediabunny v1.66.2 was released 2026-11-19 (**Docs**: [releases][mb-releases]).
- **Live sources:** `MediaStreamVideoTrackSource` and `MediaStreamAudioTrackSource` start capturing when the `Output` starts. With `timestampBase: 'synced-zero'` (the default), the earliest sample across the tracks is time 0 and the tracks stay in sync. They automatically use `latencyMode: 'realtime'` (**Docs**: [media sources][mb-sources]).
- **Steady frame rate:** `MediaStreamVideoTrackSource`'s `frameRate` option samples the track at a fixed rate. It defaults to the track's settings, so 30 for `captureStream(30)`. When frames are missing it repeats the last one to fill the gap, so the file has a constant frame rate (**Source read**: [`media-source.ts`][mb-src-ms], `frameRate` option and gap filling). In Chrome it reads frames with `MediaStreamTrackProcessor` (same file).
- **Frame dropping is allowed in realtime mode.** The spec says that in `realtime`, "User Agents MAY drop frames to achieve the target bitrate and/or framerate" (**Spec**: [WebCodecs `LatencyMode`][webcodecs]). `encodeQueueSize` and the `dequeue` event let the app see a backlog building (same spec).
- **AAC fallback:** where WebCodecs has no AAC encoder (Linux, or any machine where `AudioEncoder.isConfigSupported` says no), `@mediabunny/aac-encoder` supplies AAC-LC from a WASM build of FFmpeg's encoder (**Docs**: [aac-encoder extension][mb-aac]).

## 3. Memory over a 15-minute take, and streaming to disk

**File size** (**Estimate**): 8 Mbps video (YouTube's 1080p30 recommendation) plus 192 kbps audio is about 1.02 MB a second. That's about **370 MB for 6 minutes and 920 MB for 15 minutes**. Holding that in an `ArrayBuffer` until the end is the main risk. Mediabunny calls its in-memory `BufferTarget` "a great choice for small-ish files (< 100 MB)" (**Docs**: [writing media files][mb-writing]).

**Mediabunny's MP4 layouts** (**Docs**: [output formats][mb-formats]):

| `fastStart` | Layout | Memory | Notes |
|---|---|---|---|
| `false` | Metadata (`moov`) at the end | Least | Not fast start. YouTube and Instagram ask for `moov` at the front |
| `'in-memory'` | `moov` at the front | Whole take in RAM until finalised | Out for 15 minutes |
| `'reserve'` | Space reserved at the front for `moov`, filled in at the end | Flat | Needs `maximumPacketCount` on every track. Adding more packets than that throws (**Source read**: [`isobmff-muxer.ts`][mb-src-mux]) |
| `'fragmented'` | fMP4, append-only | Flat | Same structure as MediaRecorder's file |

**Recommendation:** use `'reserve'` with a hard cap a little over 15 minutes. At 30 fps, a 16-minute cap is 28,800 video packets. AAC at 48 kHz is 46.875 packets a second, so about 45,000 audio packets (**Estimate**). The app stops the take at the cap. This gives a normal fast-start MP4 with flat memory.

**Where the bytes go:**

- **`StreamTarget`** takes any `WritableStream` and writes each chunk at its own position. It works with a `FileSystemWritableFileStream` passed straight from `handle.createWritable()`, respects backpressure, and closes the stream on `finalize` (**Docs**: [writing media files][mb-writing]).
- **OPFS, recommended.** No picker, works with "watch it back → download", and Chromium lets an origin use up to 60% of the disk. Going over fails with `QuotaExceededError`. Data is best-effort unless `navigator.storage.persist()` is granted (**Docs**: [MDN storage quotas][mdn-quota]). Check `navigator.storage.estimate()` before a take.
- **`showSaveFilePicker`**, File System Access, Chrome 86 (**Docs**: [Chrome Platform Status 6284708426022912][cps-fsa]). This writes straight to a file the user picks, but asks for the location before the take rather than at download.
- **A caveat for both:** `createWritable()` writes to a temporary file, and changes only reach the real file when the stream is closed (**Docs**: [MDN `createWritable`][mdn-writable]). So a crash mid-take probably loses the take. If partial takes must survive, write in a dedicated worker with `FileSystemSyncAccessHandle`, which writes directly to the OPFS file and has `flush()` (**Docs**: [MDN `FileSystemSyncAccessHandle`][mdn-sync]). Pair it with `'fragmented'`, then remux to fast start at stop. That's a decision for "Failure during a take".
- **If MediaRecorder is used,** pass a `timeslice` and write each `dataavailable` Blob to the file. Chromium's Blob store holds at most 2 GiB in memory on 64-bit desktop and pages the rest to disk, up to 10% of the disk (**Source read**: [`blob_memory_controller.cc`][cr-blob]). So even keeping the Blobs wouldn't run out of RAM at 920 MB, but writing them out is cleaner.

## 4. Hardware encoding on Macs and Windows laptops

- **Chromium's encoders:** macOS uses VideoToolbox ([`vt_video_encode_accelerator_mac.mm`][cr-vt]). Windows uses Media Foundation ([`media_foundation_video_encode_accelerator_win.cc`][cr-mf]). Where no hardware profile fits, H.264 falls back to the bundled OpenH264 software encoder, Baseline profile only (**Source read**: [`video_track_recorder.cc`][cr-vtr], `GetMediaVideoCodecProfileForSwEncoder`).
- **Software at 1080p is marginal:** Chromium's own comment says desktop software encoding "can run fine up and until HD resolution at 30fps" (1280×720×30 pixels a second). 1080p30 is 2.25 times that (**Source read**: [`media_recorder_handler.cc`][cr-mrh]). So a laptop without a usable hardware H.264 encoder is the case to watch.
- **Measured on this Mac:** encoding 600 synthetic 1080p frames, drawn on a canvas, at 8 Mbps ran at 182 fps with `prefer-hardware` and 169 fps with `prefer-software`. The 1080×1920 run hit 207 fps. That's about 5 to 7 times real time, and the speed was probably limited by the drawing, not the encoder. The output averaged 8.0 Mbps. The browser was the Chromium 156 inside the Claude desktop app, and the probe can't tell which encoder Chromium actually picked. **No Windows laptop was tested.**
- **What to build:** before a take, call `VideoEncoder.isConfigSupported` (or Mediabunny's `canEncode`) for the chosen size. While recording, watch `encodeQueueSize` or Mediabunny's backpressure. If frames back up, tell the user instead of shipping a stuttering file. The perf workbench should measure the frame loop with encoding switched on.

## 5. Hidden or busy tabs

- **Hidden tab:** "`requestAnimationFrame()` calls are paused in most browsers when running in background tabs or hidden `<iframe>`s" (**Docs**: [MDN rAF][mdn-raf]). Chrome's rAF "waits until the page is visible" (**Docs**: [Chrome timer throttling][cr-throttle]). p5's draw loop runs on rAF, so it stops.
- **Covered window:** Chromium treats a fully covered window as hidden on Windows (**Docs**: [native window occlusion][cr-occlusion-win]) and on macOS (**Source read**: [`web_contents_occlusion_checker_mac.mm`][cr-occlusion-mac]). Present mode in front avoids this, but a full-screen editor or a covering window would freeze the video.
- **What `captureStream` does then:** a frame is captured only when the canvas is painted with new content (**Spec**: [Media Capture from DOM Elements][fromelement]). With no paints, the track goes quiet. Mediabunny repeats the last frame, so the file shows a freeze while the audio keeps going. MediaRecorder would show a gap in timestamps.
- **Timers:** a page that has made sound in the last 30 seconds gets only minimal timer throttling (**Docs**: [Chrome timer throttling][cr-throttle]). The Tone Player or a monitored input keeps timers healthy during a take, but that doesn't bring back rAF.
- **Busy main thread:** frames the draw loop misses are missing from the video. That's the "what was on screen is what's in the file" rule. Hardware video encoding runs through the GPU process, and AAC through an offloading encoder on its own task runner, so encoding adds little to the main thread (**Source read**: [`gpu_mojo_media_client_mac.cc`][cr-mojo-mac]; the main-thread cost is my **Estimate**, not measured). The p5 frame time with the camera band drawn is the thing to measure.
- **What the app should do:** listen for `visibilitychange` during a take and warn, or mark the take. An Electron build could turn rendering throttling off for a hidden window (`backgroundThrottling: false`), but the pianist has to watch the screen anyway. This doesn't justify a desktop app (**Estimate**).

## 6. Will platforms and editors accept the file?

| Target | What it asks for | Source |
|---|---|---|
| YouTube | MP4, `moov` at the front, **no edit lists**; H.264 High, progressive, closed GOP of half the frame rate, 4:2:0; AAC-LC or Opus at 48 kHz; 8 Mbps for 1080p at 24–30 fps, 12 Mbps at 48–60 fps | **Docs**: [YouTube upload settings][yt] |
| Instagram Reels (API) | MP4 or MOV, **no edit lists**, `moov` at the front; H.264 or HEVC, closed GOP, 4:2:0; AAC at 48 kHz max; 23–60 fps; 1920 px wide max; 9:16 recommended; 25 Mbps max; 3 seconds to 15 minutes; **300 MB max** | **Docs**: [Instagram Graph API][ig] |
| TikTok (API) | MP4 recommended; H.264 recommended; 23–60 fps; 360–4096 px each side; up to 4 GB; **10 minutes max through the API** | **Docs**: [TikTok media transfer guide][tt] |

- **Recommended file against these lists:** fast start, H.264, AAC, 48 kHz, 30 fps constant, closed GOP. It meets YouTube's and Instagram's lists. The recommended GOP is a keyframe every 0.5 s. Mediabunny defaults to 2 s, so set `keyFrameInterval` lower if that matters (**Docs**: [media sources][mb-sources]).
- **Edit lists:** Mediabunny writes an edit list (`edts`/`elst`) when a track's first timestamp isn't 0 (**Source read**: [`isobmff-boxes.ts`][mb-src-boxes], `needsEditList`). With two live tracks, the later one may start a few milliseconds in. Check a prototype file with `ffprobe` or `mp4box`. If an edit list appears, line the starts up or trim before muxing.
- **Instagram's 300 MB and TikTok's 10 minutes** are limits of their posting APIs. Uploads through the phone apps weren't checked. A 6-minute take at 8 Mbps is about 370 MB, so an Instagram API upload would need about 6 Mbps or less (**Estimate**). Since the app doesn't upload anything, this only matters if users post from a computer through these limits.
- **Editors:** I found no first-party compatibility statement from Premiere, Final Cut or DaVinci for these files. A standard H.264/AAC fast-start MP4 with a constant frame rate is the safe shape. MediaRecorder's fragmented file with a variable frame rate and no duration is the risky one (**Secondary**: [addpipe][addpipe]).

## Recommended pipeline

1. **Frame:** the p5 canvas holds the final composite, with Crystals, Overlays and the camera footage drawn in the Keyboard band, at 1920×1080 or 1080×1920. `canvas.captureStream(30)` gives the video track.
2. **Audio:** a Web Audio graph mixes the Tone Player output and the input device. A `MediaStreamAudioDestinationNode` gives the audio track. A 48 kHz context is preferred.
3. **Encode and mux:** Mediabunny `Output` with `Mp4OutputFormat({ fastStart: 'reserve' })`. The video source is `MediaStreamVideoTrackSource` (`codec: 'avc'`, about 8 Mbps, `frameRate: 30`, `maximumPacketCount` for a 16-minute cap). The audio source is `MediaStreamAudioTrackSource` (`codec: 'aac'`, 192 kbps, falling back to `@mediabunny/aac-encoder`).
4. **Target:** `StreamTarget` on `createWritable()` of an OPFS file. Check `navigator.storage.estimate()` first. Use `FileSystemSyncAccessHandle` plus `'fragmented'` and a remux if a crash must not lose the take.
5. **Watch back and download:** at stop, `finalize()`. Then `getFile()` gives a Blob URL for a `<video>`. Download with `<a download>` or `showSaveFilePicker`. Retake deletes the OPFS file.
6. **Guards:** `isConfigSupported` at start; backpressure or dropped frames reported during the take; `visibilitychange` warns or marks the take.

**Fallback:** MediaRecorder with `video/mp4;codecs=avc1,mp4a.40.2`, `videoBitsPerSecond: 8e6` and a 1 s timeslice, writing chunks to OPFS, then a Mediabunny remux to fast-start MP4 after stop.

## Hard blockers

**None found.** Everything above works in Chromium on macOS and Windows with no server. The risks to check in a prototype, none of which favours desktop:

- **The window must stay visible during a take.** A desktop app would only remove the throttling, and the pianist is watching the screen anyway.
- **No Windows laptop was measured,** and a machine without hardware H.264 at 1080p30 would be marginal.
- **Possible edit lists** in Mediabunny output, against YouTube's and Instagram's "no edit lists".

## Facts that may go stale

- The MediaRecorder MP4 structure and its missing duration were seen in Chrome 147 by a third party. Chromium's `main` branch still writes fMP4 as of 2026-11-22.
- Mediabunny is moving fast (v1.66.2, 2026-11-19). Recheck option names like `fastStart: 'reserve'` and `maximumPacketCount` before building.
- Platform upload specs (YouTube, Instagram, TikTok) were read on 2026-11-22 and change without notice.

[cps-mp4]: https://chromestatus.com/feature/5163469011943424
[cps-h26x]: https://chromestatus.com/feature/6375884229181440
[cps-webcodecs]: https://chromestatus.com/feature/5669293909868544
[cps-breakout]: https://chromestatus.com/feature/5499415634640896
[cps-fsa]: https://chromestatus.com/feature/6284708426022912
[cr-mrh]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediarecorder/media_recorder_handler.cc
[cr-mr]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediarecorder/media_recorder.cc
[cr-vtr]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediarecorder/video_track_recorder.cc
[cr-mp4mux]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/muxers/mp4_muxer_delegate.cc
[cr-mojo-mac]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/mojo/services/gpu_mojo_media_client_mac.cc
[cr-mojo-win]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/mojo/services/gpu_mojo_media_client_win.cc
[cr-mojo-linux]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/mojo/services/gpu_mojo_media_client_linux.cc
[cr-vt]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/gpu/mac/vt_video_encode_accelerator_mac.mm
[cr-mf]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/gpu/windows/media_foundation_video_encode_accelerator_win.cc
[cr-blob]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/storage/browser/blob/blob_memory_controller.cc
[cr-occlusion-win]: https://chromium.googlesource.com/chromium/src/+/master/docs/windows_native_window_occlusion_tracking.md
[cr-occlusion-mac]: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/app_shim_remote_cocoa/web_contents_occlusion_checker_mac.mm
[cr-throttle]: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
[webcodecs]: https://w3c.github.io/webcodecs/
[fromelement]: https://w3c.github.io/mediacapture-fromelement/
[mdn-raf]: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
[mdn-quota]: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
[mdn-writable]: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable
[mdn-sync]: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle
[mb-formats]: https://mediabunny.dev/guide/output-formats
[mb-writing]: https://mediabunny.dev/guide/writing-media-files
[mb-sources]: https://mediabunny.dev/guide/media-sources
[mb-aac]: https://mediabunny.dev/guide/extensions/aac-encoder
[mb-releases]: https://github.com/Vanilagy/mediabunny/releases
[mb-src-ms]: https://github.com/Vanilagy/mediabunny/blob/main/src/media-source.ts
[mb-src-mux]: https://github.com/Vanilagy/mediabunny/blob/main/src/isobmff/isobmff-muxer.ts
[mb-src-boxes]: https://github.com/Vanilagy/mediabunny/blob/main/src/isobmff/isobmff-boxes.ts
[mp4muxer]: https://github.com/Vanilagy/mp4-muxer
[addpipe]: https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/
[yt]: https://support.google.com/youtube/answer/1722171
[ig]: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
[tt]: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
