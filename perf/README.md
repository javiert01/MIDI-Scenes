# Performance workbench

Keeps the visualizer fast as it grows. It plays scripted performances into every
Scene in headless Chromium, measures what each frame costs, and fails when a
change makes the app slower. It runs in CI on every pull request and every push
to `main` (`.github/workflows/perf.yml`). The report shows up as a sticky PR
comment and in the job summary.

```bash
npm run perf                              # this working tree against the budgets
npm run perf -- --base-ref origin/main    # …and side by side with main
npm run perf:update                       # re-record the draw-call baseline
```

## What it measures

Every **Scene** (No Scene included) × every **Workload** in `workloads.ts`:

| Workload | What it plays                                                      |
| -------- | ------------------------------------------------------------------ |
| `idle`   | nothing: the Scene's ambient animation alone                       |
| `melody` | one note at a time across the keyboard, ~6 a second                |
| `chords` | sustained five-note chords, one a second, for tall Crystals        |
| `storm`  | stress: 120 notes a second at full velocity, ~24 held at once      |

The harness (`harness/main.ts`) builds the real `VisualizerEngine` with the real
p5, every registered Scene, the default Overlays (Crystals, Piano Preview) and a
fake MIDI Device. It stops the p5 loop and draws each frame itself:

- **Frame cost** is one frame's update + draw + raster, in ms. The canvas is read
  back after each frame, so rasterising is counted instead of deferred. Chromium
  runs with the GPU off (a software canvas), so every machine measures the same
  pipeline. That is also a conservative stand-in for a weak laptop.
- **Draw calls** count every shape, vertex and text call per frame. The clock is
  virtual (exactly 1/60 s per frame) and `Math.random` is seeded, so this count is
  exactly repeatable and does not depend on the machine.
- **Bundle** is the gzipped JS + CSS the production build ships. Sampled Tones'
  MP3s are left out because they load on demand.

Each case runs 120 warmup frames, then 300 measured frames, three rounds. When
there is a base, the base and the head alternate on the same machine.

## What fails the check

Thresholds live in `budgets.json`:

| Check            | Fails when                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| Frame budget     | a case's p95 frame cost is over `frame.p95Ms` (16.7 ms, one 60 fps frame) by more than `frame.tolerancePct` % |
| Regression       | a case's median frame is `regression.medianPct` % **and** `minDeltaMs` ms slower than the base |
| Draw calls       | a case draws more than `drawCalls.tolerancePct` % over `baseline.json`      |
| Bundle           | the bundle is over `bundle.maxGzipKb`, or `maxGrowthPct` % bigger than the base |

The regression check only means something next to a base, so it runs only with
`--base-ref`. CI always passes one: a PR's target branch, or the `main` a push
replaced. The frame-cost checks use timing, so they get generous margins.
The frame budget is an absolute figure, so a slow runner can push every case
over it, the base included. `frame.tolerancePct` absorbs that: a case over the
budget but inside the tolerance passes with a note in the report. The
draw-call check is exact, so it catches "this now draws twice as much" even on a
noisy runner.

## When a change is meant to cost more

A new Scene or a richer effect will draw more. If that is intended:

1. Make sure the frame budget still holds. Look at the p95 column.
2. Run `npm run perf:update` and commit the new `baseline.json`. The diff shows
   reviewers exactly which Scenes got heavier, and by how much.

A new Scene appears in the report as soon as it is registered in
`src/scenes/index.ts`. It just needs `npm run perf:update` to get a baseline.
A new Workload goes in `workloads.ts`.

## Options

| Flag               | Default | Meaning                                                  |
| ------------------ | ------- | -------------------------------------------------------- |
| `--base-ref <ref>` | none    | also measure this commit (checked out under `perf/.out/`) |
| `--only <text>`    | all     | only cases whose `scene/workload` contains this text     |
| `--rounds <n>`     | 3       | rounds per case                                          |
| `--frames <n>`     | 300     | measured frames per round                                |
| `--warmup <n>`     | 120     | frames before measuring starts                           |
| `--no-bundle`      | off     | skip the bundle build                                    |
| `--update`         | off     | rewrite `baseline.json` from this run                    |
| `--markdown <f>`   | none    | write the report as Markdown                             |
| `--json <f>`       | none    | write the raw figures as JSON                            |

For a quick local check of one Scene:
`npm run perf -- --only rain --base-ref origin/main --no-bundle --rounds 2`.

Exit code: 0 when everything is within budget, 1 when a check failed, and 2 when
the workbench itself broke.

Local timings depend on what else the machine is doing. Close heavy apps before
trusting absolute numbers. The side-by-side comparison stays fair either way,
because both sides share the slowdown.
