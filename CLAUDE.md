# MIDI Visualizer

A browser app that turns live MIDI-keyboard playing into real-time p5.js visuals.
See `CONTEXT.md` for the domain glossary and `docs/adr/` for architectural decisions.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `javiert01/MIDI-Scenes`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, label strings unchanged from the defaults. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Scene authoring

Requirements and elicitation questions for building a new Scene. See `docs/agents/scene-authoring.md`.

### Performance

CI runs the performance workbench on every PR. Before handing off a change to a
Scene, an Overlay or the engine's frame loop, run
`npm run perf -- --base-ref origin/main --only <sceneId>`. If a Scene is meant to
draw more, run `npm run perf:update` and commit `perf/baseline.json`. See
`perf/README.md`.
