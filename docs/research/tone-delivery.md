# Delivering Tone samples and holding them in memory

Research for [#43](https://github.com/javiert01/MIDI-Scenes/issues/43), on the map
[#39](https://github.com/javiert01/MIDI-Scenes/issues/39). Sources read and tests
run on 2026-11-02. Vocabulary follows `CONTEXT.md`.

## Answer

| Question            | Recommendation                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting             | Static Vite assets on Vercel, imported so each sample gets a content-hashed URL. No separate CDN or storage host for now.                                      |
| Cache headers       | Add a `vercel.json` rule giving `/assets/*` `Cache-Control: public, max-age=31536000, immutable`. **The app doesn't get this today.**                          |
| Browser cache       | The HTTP cache alone. No Cache API and no service worker.                                                                                                      |
| Format              | One format: **MP3 encoded by LAME, keeping its Xing/Info header.** Not AAC, because Firefox plays its attacks 48 ms late. Not Opus, because Safari's support depends on version and macOS. |
| Decoding            | Decode the whole Tone when it's selected, before it takes over. Don't decode per note on demand.                                                               |
| Holding in memory   | Hold only the selected Tone. Drop the previous Tone's buffers once its voices end, and re-decode from the HTTP cache if it's picked again.                     |
| Budget              | Budget each Tone by **seconds of audio**, not MB. A starting limit of 240 s of stereo is about 92 MB decoded at 48 kHz.                                        |

The finding that matters most: **a "few MB" download doesn't mean a few MB in
memory.** A real 2.0 MB piano set decoded to 162 MB in all three engines tested.

## Hosting: Vercel static assets or a separate host

The app is live at `midi-scenes.vercel.app`, with no `vercel.json` in the repo. The
figures below are from Vercel's and Cloudflare's current pages.

| Host                                  | Free allowance                                                                                  | Past the allowance                                                                      | Setup needed                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Vercel static assets, Hobby           | [100 GB Fast Data Transfer, 1M CDN Requests a month][hobby]                                     | [Usually a 30-day wait; Hobby can't buy more][hobby]                                    | One `vercel.json` rule                                       |
| Vercel static assets, Pro ([$20 a seat][hobby]) | [1 TB a month and 10M CDN Requests][pricing]                                                    | [From $0.15/GB and $2 per 1M requests][pricing]                                         | Same                                                         |
| Vercel Blob, Hobby                    | [1 GB stored, 10 GB Blob Data Transfer, 10,000 Simple and 2,000 Advanced Operations][blob]      | [Blob stops working until 30 days have passed][blob]                                    | An upload step and a store                                   |
| Cloudflare R2                         | [10 GB stored, 1M Class A and 10M Class B operations; egress free][r2]                          | [$0.015/GB-month, $0.36 per 1M Class B; egress still free][r2]                          | [A domain on Cloudflare][r2-public], [a CORS policy][r2-cors] |

What that buys, for a 3 MB Tone made of 30 files and a 15 MB catalogue of five Tones:

- **Hobby data:** 100 GB ÷ 3 MB ≈ 33,300 Tone downloads a month, or 100 GB ÷ 15 MB ≈
  6,600 visitors downloading every Tone.
- **Hobby requests:** 1,000,000 ÷ 30 ≈ 33,300 Tone downloads, so data and requests run
  out at about the same point. This assumes the immutable header below, because
  otherwise return visits also spend requests on revalidating.
- **Pro:** 1 TB ÷ 15 MB ≈ 66,600 full catalogues. After that a full catalogue costs
  15 MB × $0.15/GB ≈ $0.002.
- **Blob on Hobby:** 10 GB ÷ 3 MB ≈ 3,300 Tone downloads, a tenth of plain static
  hosting, so it has no advantage here.
- **R2:** 10M ÷ 30 ≈ 333,000 Tone downloads with free egress. It's the cheapest at real
  scale, but [`r2.dev` URLs are rate-limited and meant for development][r2-public],
  and [production caching needs a custom domain][r2-public]. The app has no custom
  domain today, so R2 needs one bought or moved first, plus [a CORS policy][r2-cors].

Static assets also fit the repo's limits. Five Tones at 3 to 5 MB is 15 to 25 MB, well
under [Vercel's 100 MB source limit for CLI deploys on Hobby][limits] and
[GitHub's 100 MiB per-file block and 1 GB repository guidance][github]. Git LFS isn't
needed.

**When to revisit:** traffic near the Hobby limits, or commercial use, since
[Hobby is restricted to non-commercial, personal use][hobby]. Both have the same first
fix, which is moving to Pro. R2 only becomes worthwhile well beyond that.

### How the Vite side should work

- **Use imported assets, not `public/`.** [Imported assets get hashed file names;
  `public/` files are copied as they are][vite-assets], and only hashed names are safe
  to cache for a year. MP3 is [already a known asset type][vite-constants], so no
  config is needed.
- **List a Tone's files with a glob.** [`import.meta.glob` with `query: '?url'` and
  `import: 'default'`][vite-glob] returns URLs without loading the audio. Adding
  [`eager: true`][vite-glob] avoids an extra JS chunk per file.
- **Inlining isn't a concern.** [Assets under 4 KiB are inlined as base64][vite-build],
  and samples will be far larger.
- **Ship one file per sample, not one bundle per Tone.** Hashes then apply per file, so
  re-encoding one note re-downloads one note. Progress can count files.
  [`decodeAudioData` needs complete files, not fragments][mdn-decode], so a single
  bundle would have to arrive whole before anything could decode.
- **Progress is easy to report.** [Vercel compresses only an allowlist of types, and
  audio isn't on it][vercel-compression], so sizes on the wire equal file sizes.

### The cache header the app is missing

[Vercel's default is `public, max-age=0, must-revalidate`][vercel-cc]. It recommends
[`max-age=31536000, immutable` for hashed assets, saying frameworks like Next.js set
this automatically][vercel-cc], but [Vercel's Vite preset defines no default headers or
routes][vercel-frameworks].

I checked the live app. Its hashed bundle `/assets/index-CV2FPPq3.js` comes back with
`cache-control: public, max-age=0, must-revalidate`. Without a fix, every return visit
would revalidate every sample of the selected Tone: 30 requests and 30 round trips,
each [counting as a CDN Request][vercel-cdn-usage], to learn nothing has changed.

The fix is [a `headers` entry in `vercel.json`][vercel-cc]:

```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

This matches [MDN's recommended header for versioned files][mdn-caching] and also
benefits today's JS and CSS. `index.html` stays revalidated, as it should.

## Caching: HTTP cache, Cache API or service worker

|                       | HTTP cache                                                            | Cache API                                                                 | Service worker                                 |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| Code needed           | None beyond `fetch(url)`                                              | Versioning and purging by hand: [entries never expire][mdn-cache]        | All of that, plus an install and update lifecycle |
| Durability            | [Old entries are removed as new ones arrive][mdn-caching]             | [Lasts until deleted or evicted by origin under pressure][mdn-storage]    | Same as Cache API                              |
| Safari, idle 7+ days  | [Not listed under the 7-day cap][webkit-itp]                          | [Deleted after 7 days without interaction, with tracking prevention on][mdn-storage]                   | [Registrations and cache are deleted][webkit-itp] |
| Cost of losing it     | A re-download behind the existing progress indicator                  | The same                                                                  | The same                                       |
| Offline use           | Not guaranteed                                                        | Yes, if cached                                                            | Yes                                            |

The HTTP cache wins because the map only needs a re-download to be harmless, and it
already is: Warm Analog sounds and a progress indicator shows until the Tone is ready.
The Cache API's one strong benefit is durability, and for a Safari user who returns
after a week, it's the option that gets wiped.

Revisit only if users report repeated re-downloads, or if offline use becomes a goal.
The Cache API then works from the page with [no service worker required][mdn-cache].

## Format: what decodes everywhere and starts on time

The spec says [`decodeAudioData` accepts whatever the `audio` element supports][spec],
but in practice that's not enough. [Safari 15 played WebM Opus in `audio` while
`decodeAudioData` failed on it, a bug since fixed][webkit-226922]. Support tables also only cover the
`audio` element ([caniuse says so explicitly][caniuse-mp3]). So I tested the real path.

**Test:** `decodeAudioData` on an `OfflineAudioContext`, in Chrome 156, Firefox 157 and
WebKit from Safari 26.6.2 (a windowless `WKWebView`), on macOS 26.6.2. Files were a WAV
click at a known frame encoded to AAC by `afconvert`, two public piano MP3s, an Ogg
Vorbis, and Opus recorded by Chrome (WebM) and Firefox (Ogg). The test scripts were
throwaway and aren't in the repo.

| Format                     | Chrome | Firefox | WebKit | Attack timing across engines                                                 | Other limits                                                                          |
| -------------------------- | ------ | ------- | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **MP3, LAME Xing/Info tag** | Yes    | Yes     | Yes    | **Same length; peak within 1 frame** (587,543 frames, peak at 831 at 44.1 kHz) | [Audio element support back to Firefox 22, Safari 4, Opera 15][caniuse-mp3]           |
| MP3, no tag                | Yes    | Yes     | Yes    | WebKit is **27 ms earlier** (peak 1,717 vs 2,919) and 3,285 frames shorter   | Avoid                                                                                 |
| AAC in M4A                 | Yes    | Yes     | Yes    | Firefox is **48 ms late** (click at 24,147 vs 22,035) and untrimmed           | [Firefox relies on the platform's AAC; not in Chromium builds][mdn-codecs]            |
| Ogg Vorbis                 | Yes    | Yes     | Yes    | WebKit is 3 ms earlier (peak 1,590 vs 1,718)                                 | [Ogg needs macOS 15.4+ in Safari][mdn-containers]                                     |
| Opus in Ogg or WebM        | Yes    | Yes     | Yes    | Onset not measured: no controlled source                                     | [Ogg needs macOS 15.4+][mdn-containers]; [Safari marked partial][caniuse-opus]        |

Reasons for choosing tagged MP3:

- **It's the only format here with no version or platform caveat that also starts on
  time everywhere tested.** Mozilla's QA verified [Firefox's LAME trimming since
  Firefox 83][bz-1566389] on Windows, macOS and Ubuntu, and that bug's reporter says
  Chrome and Safari already trimmed.
- **AAC would make Firefox lag.** Firefox returned all 46 packets × 1,024 = 47,104
  frames for a 44,100-frame file, so nothing was trimmed, and the click arrived 2,112
  frames late. [Mozilla's AAC trimming bug is still open][bz-1669166]. Those 48 ms add
  directly to the key-press-to-sound latency #42 is studying, and would throw loop
  points off too.
- **Opus saves little where it counts.** MDN gives [96 kbps as the stereo minimum for
  Opus and 128 kbps for MP3][mdn-codecs], so at best the download shrinks by a quarter.
  Decoded memory doesn't change at all, and memory is the real constraint here. Serving
  Opus with an MP3 fallback would add a second encode for little gain, and
  [`canPlayType` has been an unreliable guide for `decodeAudioData`][webkit-226922].

The tag is the requirement, not MP3 alone. [A Web Audio maintainer treats delay handling
as a browser and codec implementation matter][webaudio-2505], so the file has to state
its delay clearly. Our test file without a tag is the proof: engines disagreed by 27 ms.

## Memory: what a Tone costs

[`AudioBuffer` stores 32-bit float PCM, one buffer per channel][mdn-audiobuffer], and
[decoded audio is resampled to the context's rate][mdn-decode]. File size and bitrate
play no part once it's decoded:

```
bytes = seconds × sample rate × channels × 4

stereo, 48 kHz   = 48,000 × 2 × 4 = 384,000 bytes/s
stereo, 44.1 kHz = 44,100 × 2 × 4 = 352,800 bytes/s
mono,   48 kHz   = 48,000 × 1 × 4 = 192,000 bytes/s
stereo, 96 kHz   = 96,000 × 2 × 4 = 768,000 bytes/s
```

**Measured:** the [Tone.js Salamander piano set][salamander] (30 MP3s, single velocity,
LAME tagged) is 2,012,677 bytes holding 422.4 s of stereo audio.

```
422.4 s × 384,000 bytes/s = 162.2 MB
162.2 MB ÷ 2.01 MB        = 81× expansion
2,012,677 × 8 ÷ 422.4 s   = 38 kbps average
```

All three engines reported 162.2 MB from `length × channels × 4`. Low bitrates produce
this ratio because piano tails are nearly silent and encode cheaply, yet still occupy
full memory. A constant 128 kbps gives a smaller ratio, which makes it a floor, not a
typical case:

```
128 kbps = 16,000 bytes/s, and 384,000 ÷ 16,000 = 24×
3 MB ÷ 16,000 bytes/s = 187.5 s, × 384,000 = 72 MB
5 MB ÷ 16,000 bytes/s = 312.5 s, × 384,000 = 120 MB
```

Planning figures at 48 kHz (the zone counts and lengths are my assumptions, for #41 to
replace with real sets):

| Tone shape                                     | Audio                     | Decoded |
| ---------------------------------------------- | ------------------------- | ------- |
| Piano as shipped: 30 zones, tails up to 25 s   | 422 s stereo              | 162 MB  |
| Piano, tails capped at 8 s                     | up to 30 × 8 = 240 s stereo | 92 MB   |
| Piano, 2 velocity layers, capped at 6 s        | 60 × 6 = 360 s stereo     | 138 MB  |
| Looped sustain (Strings, Organ, Accordion): 15 zones × 4 s | 60 s stereo  | 23 MB   |
| Mono guitar: 15 zones × 5 s                    | 75 s mono                 | 14 MB   |

Holding every Tone at once would cost about 175 MB (92 + 3 × 23 + 14), or about 245 MB
with the uncapped piano. Each extra velocity layer multiplies its Tone's figure, and a
96 kHz audio interface doubles everything, because [the context defaults to the output
device's preferred rate][mdn-context].

### Decode up front, hold one Tone

**Decode the whole Tone on selection.** Decoding per note on demand would put an
asynchronous decode inside the first press of each note, the one place the app can't
afford to wait. Decoding everything up front costs little, since it happens before the
Tone takes over, while Warm Analog is still sounding.

Time to decode all 30 Salamander files in parallel at 48 kHz, on this Apple Silicon Mac:

| Engine  | Runs (ms)      | Longest main-thread gap        |
| ------- | -------------- | ------------------------------ |
| Chrome  | 106, 124, 140  | 6 ms                           |
| Firefox | 669, 461, 450  | 6 ms                           |
| WebKit  | 428, 502, 1047 | 5, 157, 754 ms (see unverified) |

So a re-decode is under about a second here, and [the spec runs decoding off the main
and rendering threads][spec]. A slower machine will take longer, which the settled
fallback already covers.

**Hold only the selected Tone.** Only one Tone sounds at a time, so holding others
trades 100+ MB for avoiding a sub-second re-decode. Once a Tone is replaced, drop the
references to its buffers. Voices still ringing keep theirs until they end, so memory
peaks at two Tones for a release tail. A small cache of recent Tones can come later if
switching feels slow in #45.

Details for whoever builds it:

- **Buffers can be shared across voices.** [Starting a source acquires references to
  immutable data rather than a copy][spec-buffer], so polyphony doesn't multiply the
  figures above.
- **Don't keep the encoded bytes.** [The spec detaches the input `ArrayBuffer`][spec].
  Chrome and Firefox did; WebKit left it intact. Either way, re-fetch from the HTTP
  cache rather than holding a second copy.
- **Long samples are within design limits.** MDN describes [`AudioBuffer` as meant for
  clips typically under 45 s][mdn-audiobuffer]. The longest here is 25 s.

## What's unverified

- **Vercel plan.** The dashboard isn't visible from here, so I don't know whether the
  project is on Hobby or Pro. Both are covered above.
- **Edge and Opera weren't run.** Both are Chromium-based, so I expect them to match
  Chrome, and [caniuse lists MP3 for both][caniuse-mp3]. That's an inference.
- **Platforms.** Chrome, Firefox and WebKit were tested on macOS only, at current
  versions. Older Safari wasn't tested. Windows and Linux rest on Mozilla's QA note.
- **WebKit, not Safari itself.** The test used `WKWebView`, the same engine without
  Safari's window.
- **WebKit's main-thread gaps.** The 157 and 754 ms gaps may be timer throttling in a
  windowless view rather than real stalls. **#45 should check this in real Safari**,
  since a stall during decoding would make playing stutter.
- **Absolute MP3 onset.** No LAME encoder was available, so tagged MP3 is shown to agree
  across engines on a real file, not measured against a known click.
- **Memory figures are arithmetic.** They come from the spec's format and each buffer's
  reported length, not heap snapshots. Real allocations may differ somewhat.
- **HTTP cache capacity.** I found no primary source on per-browser HTTP cache size.
  MDN only warns [entries may not last, even within `max-age`][mdn-caching].
- **The `vercel.json` rule hasn't been deployed.** Check it with `curl -I` on a preview
  deployment.
- **The 240 s budget is a proposal,** not a measured limit. Whether tails capped at 8 s
  sound acceptable needs the listening prototype.

## Sources

The links throughout this file point to pages read on 2026-11-02. The Vercel docs pages
showed `last_updated` dates between 2026-03-05 and 2026-09-23.

[hobby]: https://vercel.com/docs/plans/hobby
[pricing]: https://vercel.com/pricing
[limits]: https://vercel.com/docs/limits
[blob]: https://vercel.com/docs/vercel-blob/usage-and-pricing
[vercel-cc]: https://vercel.com/docs/caching/cache-control-headers
[vercel-cdn-usage]: https://vercel.com/docs/manage-cdn-usage
[vercel-compression]: https://vercel.com/docs/how-vercel-cdn-works/compression
[vercel-frameworks]: https://github.com/vercel/vercel/blob/main/packages/frameworks/src/frameworks.ts
[r2]: https://developers.cloudflare.com/r2/pricing/
[r2-public]: https://developers.cloudflare.com/r2/buckets/public-buckets/
[r2-cors]: https://developers.cloudflare.com/r2/buckets/cors/
[github]: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
[vite-assets]: https://vite.dev/guide/assets
[vite-build]: https://vite.dev/config/build-options
[vite-constants]: https://github.com/vitejs/vite/blob/main/packages/vite/src/node/constants.ts
[vite-glob]: https://vite.dev/guide/features#glob-import
[spec]: https://webaudio.github.io/web-audio-api/#dom-baseaudiocontext-decodeaudiodata
[spec-buffer]: https://webaudio.github.io/web-audio-api/#AudioBuffer
[mdn-decode]: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
[mdn-audiobuffer]: https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer
[mdn-context]: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext
[mdn-codecs]: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs
[mdn-containers]: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers
[mdn-caching]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
[mdn-cache]: https://developer.mozilla.org/en-US/docs/Web/API/Cache
[mdn-storage]: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
[webkit-itp]: https://webkit.org/tracking-prevention/
[webkit-226922]: https://bugs.webkit.org/show_bug.cgi?id=226922
[bz-1566389]: https://bugzilla.mozilla.org/show_bug.cgi?id=1566389
[bz-1669166]: https://bugzilla.mozilla.org/show_bug.cgi?id=1669166
[webaudio-2505]: https://github.com/WebAudio/web-audio-api/discussions/2505
[caniuse-mp3]: https://caniuse.com/mp3
[caniuse-opus]: https://caniuse.com/opus
[salamander]: https://tonejs.github.io/audio/salamander/A4.mp3
