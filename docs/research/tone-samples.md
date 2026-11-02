# Redistributable samples for the starting Tones

Research for [#41](https://github.com/javiert01/MIDI-Scenes/issues/41), on the map [#39](https://github.com/javiert01/MIDI-Scenes/issues/39). Checked 2 November 2026. This is research, not legal advice.

**Nothing here has been listened to.** Licences, layers and ranges come from each set's own files. Whether a set clears the realism bar is for the listening prototype, [#45](https://github.com/javiert01/MIDI-Scenes/issues/45).

## Recommendation

Every Tone has a usable set, and Accordion turned out not to be a licensing gap. Only Grand Piano carries an attribution duty.

| Tone | Recommended set | Licence | Velocity layers | Natural range (MIDI) | Package size | Estimated shipped size |
|---|---|---|---|---|---|---|
| Grand Piano | [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3) | CC BY 3.0 | 16 (ship 3 or 4) | A0 to C8 (21 to 108) | 707 MiB FLAC | 6 to 8 MiB for 3 or 4 layers |
| Strings | [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE), Cello and Violin Sections, sustained vibrato | CC0 | 2 | C2 to D6 (36 to 86) | 113 MiB WAV for these files | 7 to 10 MiB, less once trimmed to a loop |
| Overdriven Guitar | [FreePats FSBS Electric Guitar Distorted #2](https://freepats.zenvoid.org/ElectricGuitar/distorted-electric-guitar.html) | CC0 | 2 up to F4, then 1 | B1 to D6 (35 to 86) | 129 MiB FLAC | About 4 MiB with one round robin |
| Rock Organ | [FreePats Rock Organ Emulation](https://freepats.zenvoid.org/Organ/electric-organ.html) | CC0 | Unverified | Unverified | 12 MiB (WAV, archived) | Unverified, likely under 12 MiB |
| Accordion | [FreePats Button Accordion HN](https://freepats.zenvoid.org/Organ/accordion.html) | CC0 | 1 | B2 to G5 (47 to 79) | 4.8 MiB FLAC | 1 to 2 MiB, or ship the FLAC size |

Estimated sizes are mine, not measured. Salamander's is scaled from a real benchmark, below. The others assume about 128 kbps lossy encoding. The codec is [#43](https://github.com/javiert01/MIDI-Scenes/issues/43)'s call and would move these numbers.

## Per Tone

Notes use C4 = MIDI 60, matching `KEYBOARD_BASE_NOTE = 36` (C2) in `src/engine/keyboardGeometry.ts`. The board is therefore MIDI 36 to 95. File names in some sets use a different octave convention, so I read ranges from the SFZ `pitch_keycenter` values, not the names.

### Grand Piano: Salamander Grand Piano V3

- **Source:** Alexander Holm's own recording of a Yamaha C5, per the [archive.org release](https://archive.org/details/SalamanderGrandPianoV3) and the [SFZ repo's README](https://github.com/sfzinstruments/SalamanderGrandPiano). The recording itself carries the licence, so there is no separate upstream to clear.
- **Licence:** [CC BY 3.0](https://github.com/sfzinstruments/SalamanderGrandPiano/blob/master/LICENSE). Redistribution and adaptation are allowed, including commercially.
- **Attribution duty:** Section 4(b) requires the author's name, the work's title, the licensor's link where practicable, and a credit showing that we adapted it. Trimming and re-encoding counts as adapting, as I read it.
- **Layers and range:** 16 velocity layers, sampled every minor third from the lowest A, plus release and pedal samples. It covers all 88 keys, so an 88-key Device needs no stretching.
- **Size:** the repo's samples total 714 MiB of FLAC. The benchmark is [Tone.js's own Salamander subset](https://github.com/Tonejs/audio/tree/master/salamander): 30 pitches at one velocity layer is 1.9 MiB as MP3, or 6.6 MiB as Ogg. Three or four layers at that MP3 size gives 6 to 8 MiB. At that Ogg size it would be 20 MiB or more, over the "few MB" bar, so a codec or duration trade is needed.
- **CC0 fallback, if attribution is unwelcome:** [VCSL's Steinway B](https://github.com/sgossner/VCSL), with 42 whole-tone pitches and 3 layers, is 734 MiB of WAV before cutting. VCSL's [README](https://github.com/sgossner/VCSL/blob/master/README.md) confirms no credit is needed.

### Strings: VSCO 2 Community Edition

- **Source:** recorded by Sam Gossner and Simon Dalzell for Versilian Studios, per the [README](https://github.com/sgossner/VSCO-2-CE). These are original recordings, and the repo's `LICENSE` is CC0 1.0.
- **Files:** the section folders on `master` hold `susVib` samples. Cello is 27 files and 69 MiB, Viola is 26 files and 68 MiB, Violin is 22 files and 44 MiB, all WAV.
- **Layers and range:** per the `SFZ` branch maps, Cello is keycentres 36 to 77 (13 pitches), Viola 48 to 86 (13) and Violin 55 to 86 (11), each mostly 2 velocity layers. Cello plus Violin spans 36 to 86 and is enough, so Viola can go. The top of the board, 87 to 95, stretches the top sample up to 9 semitones.
- **Below C2:** only a solo Contrabass reaches lower (keycentres 30 to 59), and it is a solo player, not a section. Device notes below 36 will more simply stretch the Cello.
- **Caveat:** the SFZ maps contain no loop opcodes, so a held note ends when its file does. Looping vibrato cleanly is likely the hardest preparation job in this catalogue.

### Overdriven Guitar: FreePats FSBS Distorted #2

Pre-rendered drive is the better route, so clean samples plus Web Audio drive is not needed by default.

- **Source:** a Fender guitar sampled directly by the FreePats project, then processed through an amp and effects rack, per the [README](https://github.com/freepats/electric-guitar-FSBS-dist2/blob/master/README.txt). The page names no individual recordist. The repo is licensed CC0.
- **Layers and range:** 19 keycentres from C2 to C#6, mapped across 35 to 86. A soft/hard split at velocity 93 applies up to F4 (65), with one layer above that. Each layer has 4 round robins. Notes D#6 to B6 stretch up to 10 semitones.
- **Size:** 129 MiB FLAC as packaged. One round robin of each layer is about 33 MiB of FLAC, hence the estimate of about 4 MiB.

Why not clean plus drive:

- **Direct set:** [FSBS Direct](https://github.com/freepats/electric-guitar-FSBS-direct) is the raw signal. Its README says it isn't meant to be used alone, because it needs an amp and cabinet after it. It has no small variant (74 MiB FLAC), and a cabinet impulse response would be a second thing to license.
- **Clean small set:** [FSBS Clean #1 small](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html) is 3.0 MiB of FLAC and CC0, which makes it the swap. A Web Audio waveshaper on top would be tiny, but we would own the amp design, and the realism bar would rest on it.
- **The real trade-off:** pre-rendered distortion cannot intermodulate, because each note is distorted alone and then summed, so chords may sound thinner than a real amp. If #45 finds that, Clean small plus a shared drive stage is the thing to try.

### Rock Organ: FreePats Rock Organ Emulation

- **Source:** no acoustic recording. The samples are rendered from the [setBfree](https://github.com/pantherb/setBfree) tonewheel synth by the Strix SoundFont Team, and published CC0 by [FreePats](https://freepats.zenvoid.org/Organ/electric-organ.html), which describes it as a classic rock variation.
- **Licence check:** setBfree is GPL-2.0. The FSF's [GPLv3 FAQ](https://www.gnu.org/licenses/gpl-faq.html) says a program's output is not generally covered by the licence on its code, and the [v2 FAQ](https://www.gnu.org/licenses/old-licenses/gpl-2.0-faq.en.html) makes the exception cases where a program copies part of itself into the output. I read that as low risk. I saw this in search excerpts only, because gnu.org refused my direct fetch.
- **Unverified:** velocity layers, range and whether it loops. This set has no public repo, and I didn't download the 12 MiB archive. Check its SFZ before building on it.
- **Swaps:** [Drawbar Organ Emulation](https://freepats.zenvoid.org/Organ/electric-organ.html) is 5.8 MiB and CC0. A native additive organ with no samples at all would also be credible, since setBfree shows the sound can be synthesised. That would give a second playback path, which is for [#40](https://github.com/javiert01/MIDI-Scenes/issues/40) to weigh.

### Accordion: FreePats Button Accordion HN

This was the expected gap, and it isn't one on licensing. Range and expression are the weak points.

- **Source:** a Hohner accordion recorded by Jeff Stauffer in November 2023, reaching FreePats through Piotr Barz and processed by michael02022, per the [README](https://github.com/freepats/button-accordion-HN/blob/master/README.txt). The repo is licensed CC0.
- **Provenance flag:** the CC0 statement is FreePats's. I found no separate statement from the recordist, and a search turned up nothing. FreePats says it checks each instrument's origin under a strict policy, on its [General MIDI page](https://freepats.zenvoid.org/SoundSets/general-midi.html), but this one link rests on that policy. An email to freepats@zenvoid.org would settle it cheaply.
- **Layers and range:** 17 pitches from 47 to 79, with one layer, loop points and matching release samples. Velocity only changes loudness, through `amp_veltrack=40`.
- **Range weakness:** the map stretches the bottom sample across everything below 47 and the top sample across everything above 79. On the board that means up to 11 semitones down and 16 up. A wider Device goes further.
- **Preparation note:** the samples need per-note tuning of up to 38 cents, held in the SFZ's `tune` values. Those must survive preparation, or the Tone will be audibly out of tune.
- **Swap, if it fails #45:** I found no other CC0 or CC-BY accordion multisample. The backstop is building one from CC0 recordings. VCSL has harmonicas but no accordion. If that fails too, dropping Accordion would leave the Cumbia group without its centre, so the map would need to rethink that Genre.

## Rejected

| Candidate | Why not |
|---|---|
| [FluidR3 via midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) | Licence statements conflict: that repo says CC BY 3.0, while the [Debian copyright file](https://people.debian.org/~tg/sf/FluidR3Mono_GM/copyright) says MIT. The author also describes parts as built from public-domain samples, which can't be traced per instrument. |
| MusyngKite and FatBoy (same repo) | CC BY-SA 3.0 per that repo, so share-alike on our adaptations, and underlying recordings weren't traced. |
| [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) | Its MIT licence reads as a code licence, and its own source list mixes VSCO, Karoryfer, Iowa and Freesound. Go upstream instead. It has no accordion. |
| [Philharmonia samples](https://philharmonia.co.uk/resources/sound-samples/) | Free for music, but the terms bar offering the samples to others in their original form or as a sampler instrument. A web app shipping them looks like that. |
| Sonatina Symphonic Orchestra | CC Sampling Plus 1.0, per third-party listings, and that licence carries a promotion restriction. Its own site wouldn't load, so the terms and any upstream samples are unverified. |
| HamOrg Lite, Orchestral Tools Clutch | Freeware with no open licence that I could confirm. |
| [Decrescendo Accordion SF2](https://www.polyphone.io/en/soundfonts/reeds/446-decrescendo-accordion) | Licence is only a site category, and a commenter says it was built from a violin pitch pipe. |
| [FreePats General MIDI set](https://freepats.zenvoid.org/SoundSets/general-midi.html) | GPL v3 with an exception, a licence FreePats itself has [deprecated](https://freepats.zenvoid.org/licenses.html). Use the individual CC0 banks. |
| [Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars) | CC0 and fine, but clean Gretsch and Hofner guitars with no drive. An alternative to Clean small only. |

## Unverified or ambiguous

- **CC0 gives no warranty.** It waives the dedicator's own rights only. For every CC0 set here, I'm trusting the publisher's statement that they had those rights to waive.
- **Rock Organ:** layers, range and looping, as above.
- **Accordion:** the recordist's direct consent, as above.
- **VSCO:** Versilian's project page has an expired certificate, so I relied on the repo's `LICENSE` and README.
- **Brand names:** Hammond, Hohner, Fender, Yamaha and Steinway are makers' names. The catalogue's generic Tone names avoid them, and any credit should name the sample set and author, not imply endorsement. Trademark wasn't researched further.
