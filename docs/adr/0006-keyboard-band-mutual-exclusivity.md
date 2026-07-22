# Keyboard band: Piano Preview and Chroma Key as one mutually-exclusive choice

Supersedes the Piano Preview / Chroma Key parts of ADR-0004.

ADR-0004 gave the Piano Preview and the Chroma Key green each their own independent
sidebar toggle. But both Overlays fill the *same* band at the canvas bottom — the
Piano Preview is drawn last and covers the green (ADR-0004 render order) — so with
two booleans, "both on" is a representable but contradictory state, and users think
of them as a single "what fills the keyboard band?" choice, not two switches.

## Decision

The engine models the shared band as one value, the **Keyboard band** (see
`CONTEXT.md`): `keyboardBand: 'none' | 'piano' | 'chroma'`. This makes the
contradictory "both on" state unrepresentable.

- The two independent booleans and their setters (`setChromaKeyVisible`,
  `setPianoPreviewVisible`) are replaced by a single `setKeyboardBand(band)`.
  `chromaKeyVisible` / `pianoPreviewVisible` survive only as derived getters.
- **Default is `'piano'`** (the Piano Preview), not off — the composition is
  usually judged against the preview.
- Leaving `'piano'` releases any note a Piano Preview click is holding (the
  click surface only exists while the preview shows), preserving the ADR-0005
  behaviour that previously lived in `setPianoPreviewVisible(false)`.
- The sidebar's two toggles become one segmented **None / Piano Preview /
  Chroma Key** selector in the Overlays group. Crystals stays independent.

### Persistence / migration

`PersistedStateV1` gains `keyboardBand` and drops the two booleans from what it
writes. On load, a legacy snapshot carrying the old `chromaKeyVisible` /
`pianoPreviewVisible` booleans (each defaulting to on, as the old constructor did)
is migrated: a "both on" state resolves to `'piano'` (the preview wins the band).
Absent fields fall back to the `'piano'` default, so — consistent with ADR-0004 —
no version bump.

## Consequences

- The only new render behaviour is that at most one of the green fill and the
  preview can show; the ADR-0004 render order is otherwise unchanged.
- Overlays are still not mutually exclusive *in general* (Crystals coexist with
  either band); the exclusivity is scoped to the two Overlays that share the band.
