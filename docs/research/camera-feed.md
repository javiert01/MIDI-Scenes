# Drawing a live camera feed into the canvas, and what it costs

Findings for [How does the app draw a live camera feed into the canvas, and what does it cost?](https://github.com/javiert01/MIDI-Scenes/issues/84), on the map [Map: record a performance video in the app](https://github.com/javiert01/MIDI-Scenes/issues/81). Researched 2026-11-22.

## Answer

- **How to draw it:** open the camera with `getUserMedia`. Draw the camera's `<video>` element into the Keyboard band once per frame with one `drawingContext.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)` call. It goes where the Piano Preview or the Chroma Key green is drawn today, last in the render order. Skip p5's `image(capture)`: in p5 1.11 it copies every full camera frame into a hidden canvas first, which wastes about 1 to 1.5 ms a frame.
- **Constraints:** ask with `ideal`, not `exact`: `{ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }`. Then read `track.getSettings()` and tell the user what they actually got. `exact` or `min` values fail with `OverconstrainedError` on cameras that can't meet them, and the user is never prompted.
- **Cost:** a 1080p camera frame drawn into a 1920×360 band adds about **1 to 3 ms median and 3 to 4 ms p95** to a frame. That figure is for the workbench's software canvas at pixel density 1. On a Retina screen, which is pixel density 2 today, it is about **6 to 7 ms**. The cost is paid when a new camera frame arrives, so a 30 fps camera charges every other 60 fps frame. The heaviest case today (Spiral Galaxy, `storm`, p95 about 12 ms at 1600×800 on CI) would land near the 16.7 ms budget, but inside its 30% tolerance.
- **Cheap calibration:** crop and scale are free, because they are just the source and destination rectangles of the one `drawImage` call. Mirroring, small rotations and 180° turns cost about 2 to 2.5 ms more per frame on the software canvas, and about 1 ms more with the GPU.
- **Expensive calibration:** perspective (keystone) correction. The 2D canvas only does affine transforms. Draw it as one textured quad on a small helper WebGL canvas, then copy that into the band. That costs about 0.2 ms of main-thread time with a GPU. Never slice the camera into strips with many `drawImage(video)` calls: with the GPU, each call re-converts the frame, and 24 strips took 32 ms.
- **Cameras:** Chrome on macOS 14 or later lists Continuity Camera iPhones next to built-in and USB cameras (read in Chromium source; the feature flag is on by default). Desk View is a separate camera device that Chrome does not list. On Windows, USB (UVC) cameras show up through Media Foundation as usual.
- **Permission:** the page must be a secure context (`localhost` or HTTPS). Chrome then offers *Allow while visiting the site*, *Allow this time* or *Never allow*. On macOS the OS must also allow Chrome to use the camera. The prompt can be left unanswered forever, so the UI must not wait on it silently.
- **Hard blocker forcing a desktop app: no.** A desktop app would gain only nice-to-haves: the Desk View device, and control over macOS video effects (Center Stage, Reactions), which the user can switch off by hand.

## How to read the evidence

| Label | Meaning |
|---|---|
| **Spec / docs** | Stated by the W3C, WHATWG, MDN, Apple, Google or Microsoft page cited |
| **Source read** | Read from p5.js 1.11.13 (the installed version) or Chromium source on 2026-11-22, not run |
| **Measured** | Timed by my throwaway probe on this Mac (method below) |
| **Estimate** | My arithmetic or judgement |

Nothing here was tested with a real camera. The probe used Chromium's fake camera, which feeds a generated test pattern instead of live input ([WebRTC testing][webrtc-testing]). Continuity Camera, a USB camera and Windows still need a hands-on check (see *Open questions*).

## 1. Opening the camera: `getUserMedia` constraints for 1080p at 30 or 60 fps

- **Spec / docs:** a plain value such as `width: 1920` means `{ ideal: 1920 }`. MDN says "an `ideal` value, when used, has gravity": the browser picks the setting closest to it, measured by fitness distance. `min`, `max` and `exact` are mandatory. When no camera can meet them, the promise "will be rejected with `OverconstrainedError`, and the user will not be prompted" ([MDN getUserMedia][mdn-gum]).
- **Spec / docs:** the browser "MUST support downsampling" to any size between 1 and the native width or height. `resizeMode: "none"` stops it from cropping and scaling, and `"crop-and-scale"` allows it ([W3C Media Capture and Streams, CRD 19 Nov 2026][w3c-mcs], §4.3.6, §4.3.9). The spec is still a Candidate Recommendation Draft, so details may move.
- **Source read (Chromium, macOS):** `FindBestCaptureFormat` only picks a native format whose width and height match exactly. Among those it prefers one that supports the requested frame rate, then the lowest maximum frame rate, then the preferred pixel format. Frame rate is set through `videoMinFrameDuration` and `videoMaxFrameDuration` on the capture connection ([`video_capture_device_avfoundation.mm`][cr-avf]). A camera with no native 1920×1080 mode is therefore served by a larger mode scaled down, or by something smaller.
- **Spec / docs (Continuity Camera):** Apple describes three 16:9 formats up to 1080p and one 4:3 format at 1920×1440, "up to 30 frames per second or 60 frames per second" ([WWDC22 10018][wwdc-cc]). That is 2022 material. iPhones newer than the talk may offer more.
- **Estimate (USB cameras):** uncompressed YUY2 at 1080p30 is about 1920 × 1080 × 2 bytes × 30 ≈ 124 MB/s. USB 2.0 tops out at 60 MB/s on paper, so a USB 2.0 webcam can reach 1080p30 only through its MJPEG (or H.264) mode. Chromium chooses that mode. The app doesn't have to.
- **Measured:** with `ideal` 1920×1080 at 30 or 60 fps, Chromium 158 gave the fake camera 1920×1080 at 30 and at 60 fps, with `resizeMode: "none"`. With no fps argument the fake camera runs at 20 fps whatever is asked, which is a property of the test device.

**Recommendation:** `video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, deviceId: { exact: chosenId } }`, with `audio: false` (the mic is a separate choice, made by the audio-capture research). After the stream starts, read `getSettings()` and warn the user when it reports less than 1080p or less than 30 fps. A 60 fps camera buys nothing while the output target is at least 30 fps: the frame loop draws whatever frame is newest.

## 2. Which cameras show up: Continuity Camera and USB cameras in Chromium

### macOS

- **Source read:** Chromium's `GetVideoCaptureDevices()` builds an `AVCaptureDeviceDiscoverySession` with `AVCaptureDeviceTypeBuiltInWideAngleCamera`, and on macOS 14+ adds `AVCaptureDeviceTypeExternal` and `AVCaptureDeviceTypeContinuityCamera`. The Continuity type sits behind `kUseAVCaptureDeviceTypeContinuity`, which is `FEATURE_ENABLED_BY_DEFAULT`. The comment says "Continuity cameras are available from MacOS 14.0 and also have to be queried." Before macOS 14 it falls back to `AVCaptureDeviceTypeExternalUnknown` ([`video_capture_device_avfoundation_helpers.mm`][cr-helpers]). The device factory skips suspended devices and one Blackmagic ID ([`video_capture_device_factory_apple.mm`][cr-factory]).
- **Consequence (estimate):** on macOS 14 Sonoma or later, an iPhone through Continuity Camera is an ordinary entry in `enumerateDevices()`. Whether macOS 13 Ventura lists it through `ExternalUnknown` is not settled by the source. Treat macOS 14 as the supported floor.
- **Source read:** `AVCaptureDeviceTypeDeskViewCamera` is not in Chromium's discovery list. Apple exposes Desk View as "a separate AVCaptureDevice" ([WWDC22 10018][wwdc-cc]), so **Chrome cannot use Desk View's top-down desk view**, even though it would suit filming hands. This is the one camera feature a native app would gain.
- **Spec / docs (requirements):** Continuity Camera needs iOS 16+, an iPhone XR or later, macOS Ventura 13+, the same Apple Account with two-factor authentication, and Bluetooth plus Wi-Fi, or a USB cable with the Mac trusted. The iPhone should be locked, stable, with the rear cameras facing you; landscape lets apps pick it automatically ([Apple 102546][apple-cc], published 6 May 2026). WWDC22 says it "works with all four orientations" and becomes available "in all applications" ([WWDC22 10018][wwdc-cc]).
- **Spec / docs (video effects, a real hazard):** macOS offers Center Stage (keeps you "centered in the camera frame", so it pans and zooms on its own), Portrait, Studio Light, Background replacement and **Reactions**, which a pianist's hands can trigger. Thumbs up, two thumbs, peace signs, a heart made with two hands and the horns sign each fire a full-frame effect. You switch them in the menu bar's Video menu during a call ([Apple 105117][apple-effects], published 12 Dec 2025). Center Stage moving the frame would break a calibration, and a Reaction would land in the recording. *Estimate:* these are system effects, so they very likely apply to Chrome's capture too. That needs checking on a real Mac. Either way, the setup flow should tell the user to turn Center Stage and Reactions off. A web page cannot do it for them.
- **Community report, low trust:** one Electron app on Chromium 142 got a Continuity Camera stream with no frames, while Chrome on the same Mac worked ([Obsidian forum][obsidian]). It is a reminder that a Chromium-based desktop app is not automatically better here.

### Windows

- **Spec / docs:** Windows 11's multi-app camera mode lets several apps share one camera stream. By default Windows picks the highest resolution up to 1440p that streams at 30 fps ([Microsoft: Manage cameras][ms-cameras]). Without it, a camera held by another app can surface as `NotReadableError`, which MDN defines as a hardware or OS-level error that happens even though permission was granted ([MDN getUserMedia][mdn-gum]).
- **Not checked:** how Chromium on Windows enumerates cameras or picks formats (Media Foundation). USB UVC webcams are the standard case there. Using an iPhone as a camera on Windows needs a third-party virtual-camera app, which falls outside "one camera: webcam, USB, or iPhone via Continuity Camera".

## 3. `createCapture` versus drawing the `<video>` straight onto the canvas

**Source read (p5.js 1.11.13, the version `package.json` resolves to):**

- `createCapture()` creates a `<video playsinline>`, calls `getUserMedia(constraints)` and appends the element to the page, where it shows until you call `.hide()`. Unless you pass `VIDEO`, or an object with `audio: false`, it **asks for the microphone as well**, because `useAudio` defaults to `true`. Errors are only logged through p5's friendly-error messages. The promise isn't exposed, so `NotAllowedError` and `OverconstrainedError` can't be handled properly. The p5 2.4 reference says the same thing about audio and `hide()` ([p5 reference][p5-capture]). The repo is on p5 1.x.
- `image(capture, …)` calls `MediaElement._ensureCanvas()`, which once per p5 frame clears a hidden canvas the size of the whole camera frame and runs `drawImage(video)` into it. `flipped: true` mirrors there. The renderer then runs `drawImage` again from that hidden canvas. **Every frame is copied at full camera size before it is drawn.** `tint()` adds a third canvas.
- **Measured (software canvas):** `image(capture)` cost about 1 to 1.6 ms more median per frame than a direct `drawImage(video)`. The p95 was close (4.3 against 3.9 ms), because the two share the frame-conversion cost.

**Recommendation:** use `navigator.mediaDevices.getUserMedia` yourself, keep a detached `<video muted playsinline>` (never added to the DOM), and call `p.drawingContext.drawImage(video, …)` in the engine's render step. This keeps error handling, device choice, `getSettings()` and track lifetime in the engine. Nothing in `src/` touches `drawingContext` today, so this adds `drawingContext` to the engine's `P5Like` surface (`src/engine/types.ts`). The perf harness already reads it. Only draw once `video.readyState >= 2`. MDN notes that `drawImage` only works on a video whose `readyState` is above 1 ([MDN drawImage][mdn-drawimage]). The HTML standard draws "the frame at the current playback position" ([WHATWG canvas][whatwg-canvas]).

## 4. Calibration transforms: which are cheap

The Keyboard band at 1920×1080 is 1920×360 (`CHROMA_KEY_RATIO = 1/3`). The Crystals and the Piano Preview place 35 white keys, C2 to B6, across the full canvas width (`src/engine/keyboardGeometry.ts`). Calibration means mapping the camera pixels showing those keys onto that strip.

- **Crop and scale:** free. They are the `sx, sy, sw, sh` and `dx, dy, dw, dh` arguments of the one `drawImage` call ([MDN drawImage][mdn-drawimage]). A two-point calibration (lowest C, highest B) fixes the horizontal crop and scale.
- **Rotation, mirror, 180° turn:** the WHATWG algorithm applies "the current transformation matrix to the destination rectangle" ([WHATWG canvas][whatwg-canvas]), so `translate`, `rotate` and `scale` around the one call cover tilt, mirroring and a camera facing the player from across the keys. **Measured:** about +2 to 2.5 ms median on the software canvas for either a 2° rotation or a mirror, and about +1 to 1.5 ms with the GPU. On the software canvas, anything that isn't a plain scale loses the fast path.
- **Perspective (keystone):** a camera looking down at the keys at an angle makes the far edge narrower. The 2D canvas has no perspective transform. Options, measured:
  - **WebGL helper canvas:** draw the video as a texture on one quad with the four calibration corners, then `drawImage(helperCanvas)` into the band. About **0.2 ms** main-thread time with the GPU and no readback, but about 10 to 11 ms on the software canvas (SwiftShader WebGL).
  - **2D strips:** N horizontal `drawImage(video)` calls, each with its own source width. About 4 ms on the software canvas whether N is 24 or 60, but **32 ms (24 strips) and 77 ms (60 strips) with the GPU**: each call pays the frame conversion again. Don't use it.
  - Switching the whole engine to p5's WEBGL renderer would also work, but every Scene draws through the 2D API. Out of proportion for one Overlay.
- **Warping once per camera frame:** I tried caching: warp into a helper canvas only when a new camera frame arrives (`requestVideoFrameCallback`), then copy the helper into the band every display frame. It was no cheaper (software: 4 ms median affine, 11 ms WebGL; GPU: about 4 ms for both, with readback). Simplest is best: one draw per frame.

**Recommendation for the calibration ticket:** affine transforms only (crop, scale, rotate, flip) are cheap and enough for a camera placed square to the keys. Add keystone through a WebGL helper only if prototyping shows real camera placements need it.

## 5. What it costs the frame loop at 1920×1080

### Probe method (measured)

A throwaway page modelled on the workbench (`perf/harness/main.ts`): a 1920×1080 canvas, a full-canvas background fill, then the camera variant, then a 1-pixel `getImageData` readback so rasterising is counted. The real p5 1.11.13 was used for the `image(capture)` variants. 60 warmup and 300 measured frames, paced by `requestAnimationFrame` so the camera kept delivering new frames. The source was the fake camera at 1920×1080, 30 or 60 fps. Headless Chromium 158 (Playwright 1.65) on an Apple M3 Pro, macOS 26.6, in two modes:

- **Software:** `--disable-gpu`, the workbench's own pipeline.
- **GPU:** ANGLE on Metal (`--use-angle=metal --enable-gpu`). The workbench never runs this mode.

The figures are the time for the whole frame. "No camera" is the baseline.

| Variant (30 fps camera, density 1) | Software median / p95 ms | GPU median / p95 ms |
|---|---|---|
| No camera (background only) | 0.8 / 1.2 | 1.0 / 1.2 |
| `drawImage(video)` crop → band | 1.3 / 3.9 | 5.3 / 7.5 |
| p5 `image(capture)` crop → band | 2.9 / 4.3 | 5.2 / 7.2 |
| `drawImage` + 2° rotation + mirror | 3.9 / 5.7 | 6.7 / 7.4 |
| `drawImage` whole frame → whole canvas | 2.0 / 3.7 | 5.8 / 6.6 |
| p5 `image(capture)` + `tint` | 3.9 / 5.3 | 5.9 / 6.8 |

| Variant | Software median / p95 ms |
|---|---|
| 60 fps camera, `drawImage(video)` crop → band | 2.5 / 2.8 |
| Pixel density 2 (3840×2160 backing), no camera | 1.7 / 3.5 |
| Pixel density 2, `drawImage(video)` crop → band | 7.4 / 8.2 |
| Pixel density 2, `drawImage(video)` whole canvas | 19.4 / 20.1 |

### What the numbers mean

- **The cost follows new camera frames.** At 30 fps the software times split in two: about 0.5 ms on frames that reuse the last camera frame, about 3 to 3.5 ms on frames with a new one. Hence the low median and the higher p95. A 60 fps camera pays on every frame (2.5 ms median). Converting the camera's YUV frame to RGB is the work. Covering the band is cheap.
- **Against the workbench budget:** the latest CI report (on the Snowfall scene pull request) has the worst case at Spiral Galaxy `storm`, p95 11.97 ms at 1600×800. *Estimate:* adding about 3 to 4 ms of camera p95 gives about 15 to 16 ms. That is under 16.7 ms on CI and well inside the 30% tolerance. It doesn't account for 1920×1080 having 1.6× the pixels of 1600×800, which the workbench doesn't measure.
- **Pixel density is the big lever.** `p5` defaults to `Math.ceil(devicePixelRatio)` (source read), and the engine never calls `pixelDensity()`. On a Retina Mac a 1920×1080 canvas is therefore 3840×2160 pixels, and the band alone costs about 6 to 7 ms. A 1080p recording needs no more than 1920×1080 pixels. *Estimate:* calling `pixelDensity(1)` on the recording canvas would cut the cost of every Scene and Overlay by about 4×. That decision belongs to the canvas-recording ticket.
- **The GPU numbers are not "the GPU is slower".** With the GPU, the per-frame readback forces the GPU to finish, and the fake camera's frames sit in CPU memory and must be uploaded. On macOS, Chromium's real capture path carries frames in GPU memory buffers (`gpu_memory_buffer_tracker_apple`, [Chromium `media/capture/video/apple`][cr-apple-dir]). *Estimate:* a real camera in headed Chrome with the GPU should cost the same or less than the software figures. Even at the measured worst (about 5 to 6 ms) it fits a 60 fps frame. This is the main number to recheck in the prototype.
- **No dropped frames:** in every single-draw variant the 95th-percentile gap between `requestAnimationFrame` callbacks stayed at 16.7 ms. Only the strip-sliced keystone with the GPU dropped frames.

### Putting it in the workbench

The workbench can include the camera without hardware: `--use-fake-device-for-media-stream` plus `--use-fake-ui-for-media-stream`, or `--use-file-for-fake-video-capture=hands.y4m` for real piano footage ([WebRTC testing][webrtc-testing]). Add `fps=30` to the device flag to get 30 fps rather than the default 20. A "camera" Keyboard band choice would then be one more case per Scene. The fake camera's timing is not deterministic, so frame cost will be noisier than today. The draw-call count stays exact. The harness counts p5's `image` but not a raw `drawingContext.drawImage`, so add the band's draw to the count if it should show there.

## 6. Chromium's camera-permission flow for a first-time user

1. **Secure context.** `getUserMedia` exists only in secure contexts: HTTPS, `file:///` or `localhost`. Elsewhere `navigator.mediaDevices` is `undefined` ([MDN getUserMedia][mdn-gum]). Both the Vercel deployment and `npm run dev` qualify.
2. **Before permission.** `enumerateDevices()` returns only default devices, without labels. Labels appear once a stream is active or permission is persistent ([MDN enumerateDevices][mdn-enum]). A camera picker therefore has to ask for access first, for example with a "Turn on camera" button, then list cameras by name, then reopen the chosen `deviceId`.
3. **Chrome's prompt.** It offers *Allow while visiting the site*, *Allow this time* or *Never allow*. Users change it later under Settings → Privacy and security → Site settings → Camera ([Chrome Help][chrome-help]). *Allow this time* lasts only for the current visit, and the Permissions API reports `"prompt"` again afterwards ([Chrome one-time permissions][chrome-onetime], a 2023 Chrome 116 post, so the details may have changed).
4. **The OS layer.** On macOS, Chrome itself must be allowed under System Settings → Privacy & Security → Camera ([Apple: camera access][apple-tcc]). When the OS blocks Chrome, Chrome's prompt shows an "Open settings" link. The user may then have to restart Chrome ([Chrome Help][chrome-help]). On Windows, the OS camera privacy switch does the same job.
5. **Failure modes to design for:** `NotAllowedError` (the user, the policy or the OS said no), `NotFoundError` (no camera), `NotReadableError` (the camera is busy in another app, or a hardware fault), `OverconstrainedError` (a mandatory constraint failed; avoid it by using `ideal`). The promise may also "neither resolve nor reject" when the user ignores the prompt ([MDN getUserMedia][mdn-gum]). Show a "waiting for camera permission…" state, never a spinner with no explanation.
6. **Continuity Camera specifics.** The first time macOS 13+ opens a camera app with an eligible iPhone nearby, it shows a one-time onboarding dialog ([WWDC22 10018][wwdc-cc]). Disconnecting the iPhone removes it from apps' camera lists ([Apple 102546][apple-cc]), so the app should listen for `devicechange` and handle the track ending.

## 7. Hard blockers that would force a desktop app

**None found.** Each requirement on the map is met in Chromium on the web:

| Requirement (map notes) | Web status |
|---|---|
| One camera: webcam, USB or iPhone | Built-in, USB (UVC) and Continuity Camera (macOS 14+) are listed by Chrome (source read) |
| 1080p, at least 30 fps | `ideal` constraints and native-format matching. Continuity Camera offers 1080p at 30 and 60 fps (Apple) |
| Real keys under the Crystals via calibration | Crop, scale, rotate and flip cost one `drawImage`. Keystone via a WebGL helper (measured) |
| Fits the frame loop | About +3 to 4 ms p95 at density 1 on the workbench pipeline (measured, fake camera) |
| Local only | Camera frames never leave the page. Nothing needs a server |

What a native or desktop app would add, none of it a blocker:

- **Desk View** (Apple's top-down desk camera), which Chrome does not discover.
- **Programmatic control of macOS video effects** (Center Stage, Reactions, Portrait). On the web the user must turn them off by hand.
- **Exact format choice** (pick MJPEG over YUY2, or a specific 4:3 mode), instead of the browser's best match.

## Open questions for the prototype

- Real-camera cost in **headed** Chrome with the GPU, with a USB webcam and an iPhone via Continuity Camera, at density 1 and 2. That is the number that matters for users, and the probe could not get it.
- Whether macOS **Reactions and Center Stage apply to Chrome's capture**, and whether a pianist's hands set off Reactions in practice.
- The **camera's latency** compared with the MIDI-driven visuals, for the camera-to-MIDI sync question still open on the map. `requestVideoFrameCallback` reports `captureTime` for getUserMedia sources ([WICG rVFC][rvfc], a 2024 community draft, not a W3C standard). That gives a way to measure it.
- Whether a **61- or 88-key** keyboard fits the 35-white-key band. The engine models C2 to B6 across the full width, so calibration may need to crop to that span or the geometry may need to change. This belongs to the calibration-model ticket.
- Low-light behaviour: many webcams lengthen exposure in dim rooms and drop below 30 fps. Untested; `getSettings().frameRate` won't show it, but `requestVideoFrameCallback`'s `presentedFrames` would.

## Sources

[w3c-mcs]: https://www.w3.org/TR/mediacapture-streams/ "W3C Media Capture and Streams, Candidate Recommendation Draft, 19 November 2026"
[mdn-gum]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia "MDN: MediaDevices.getUserMedia()"
[mdn-enum]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices "MDN: MediaDevices.enumerateDevices()"
[mdn-drawimage]: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage "MDN: CanvasRenderingContext2D.drawImage()"
[whatwg-canvas]: https://html.spec.whatwg.org/multipage/canvas.html "WHATWG HTML Living Standard: canvas, image sources and drawImage"
[rvfc]: https://wicg.github.io/video-rvfc/ "WICG: HTMLVideoElement.requestVideoFrameCallback(), draft CG report, 2 August 2024"
[p5-capture]: https://p5js.org/reference/p5/createCapture/ "p5.js reference: createCapture() (documents v2.4.0)"
[cr-helpers]: https://chromium.googlesource.com/chromium/src/+/main/media/base/mac/video_capture_device_avfoundation_helpers.mm "Chromium: GetVideoCaptureDevices() on macOS"
[cr-factory]: https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/apple/video_capture_device_factory_apple.mm "Chromium: VideoCaptureDeviceFactoryApple"
[cr-avf]: https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/apple/video_capture_device_avfoundation.mm "Chromium: AVFoundation capture session and FindBestCaptureFormat"
[cr-apple-dir]: https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/apple/ "Chromium: media/capture/video/apple"
[wwdc-cc]: https://developer.apple.com/videos/play/wwdc2022/10018/ "Apple WWDC22 10018: Bring Continuity Camera to your macOS app"
[apple-cc]: https://support.apple.com/en-us/102546 "Apple Support: Use iPhone as a webcam for Mac (Continuity Camera), published 6 May 2026"
[apple-effects]: https://support.apple.com/en-us/105117 "Apple Support: Use video effects and mic modes during video calls on Mac, published 12 Dec 2025"
[apple-tcc]: https://support.apple.com/guide/mac-help/control-access-to-your-camera-mchlf6d108da/mac "Apple Support: Control access to the camera on Mac"
[chrome-help]: https://support.google.com/chrome/answer/2693767 "Chrome Help: Use your camera and microphone in Chrome"
[chrome-onetime]: https://developer.chrome.com/blog/one-time-permissions "Chrome for Developers: One-time permissions in Chrome (Chrome 116, 2023)"
[ms-cameras]: https://support.microsoft.com/en-us/windows/hardware/camera/manage-cameras-with-camera-settings-in-windows-11 "Microsoft Support: Manage cameras with Camera settings in Windows 11"
[webrtc-testing]: https://webrtc.github.io/webrtc-org/testing/ "WebRTC: testing (fake media flags)"
[obsidian]: https://forum.obsidian.md/t/macos-continuity-camera-is-detected-by-getusermedia-but-delivers-zero-video-frames-in-obsidian/116834 "Obsidian forum: Continuity Camera detected but delivers zero frames (community report)"

- [W3C Media Capture and Streams][w3c-mcs]
- [MDN getUserMedia][mdn-gum] · [MDN enumerateDevices][mdn-enum] · [MDN drawImage][mdn-drawimage]
- [WHATWG HTML canvas][whatwg-canvas] · [WICG requestVideoFrameCallback][rvfc]
- [p5.js createCapture reference][p5-capture], and p5.js 1.11.13 `lib/p5.js` (`createCapture`, `Renderer2D.image`, `MediaElement._ensureCanvas`, default `_pixelDensity`)
- Chromium: [device discovery][cr-helpers] · [device factory][cr-factory] · [capture session][cr-avf] · [apple capture dir][cr-apple-dir]
- Apple: [WWDC22 Continuity Camera][wwdc-cc] · [Continuity Camera support][apple-cc] · [video effects][apple-effects] · [camera privacy][apple-tcc]
- Google: [Chrome camera help][chrome-help] · [one-time permissions][chrome-onetime] · [WebRTC fake-media flags][webrtc-testing]
- Microsoft: [Windows 11 camera settings][ms-cameras]
- Community (low trust): [Obsidian forum report][obsidian]
