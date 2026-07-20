# Virtual Input as a coexisting, engine-owned source

To play and test Scenes without a physical MIDI keyboard, we add a **Virtual
Input**: two surfaces — the computer keyboard (standard DAW layout, `Z`/`X`
octave shift) and clicks on the Piano Preview — that emit synthetic note events.

We modelled it as a **coexisting concept, not a Device.** A Device is
enumerated and hot-plug-tracked and lives in the selectable Device list; the
Virtual Input is none of those — it is always present and fires *alongside*
whatever Device is selected, so you can click a preview key while a real keyboard
is plugged in. Making it a synthetic Device entry would have reused the selection
machinery but lied about the model (mutually exclusive, "enumerated") and broken
preview-clicks, which must work regardless of the selected Device.

We placed the whole thing **inside the framework-agnostic engine** (see
ADR-0002), not split into the React layer. Two facts forced this: preview clicks
must be handled where the single p5 instance lives (the engine), and both
surfaces must share one enable flag, octave state, velocity, and stuck-note
cleanup. So the engine now binds global `window` keyboard listeners (guarded by
`typeof window`, as it already does for `localStorage`) and p5 mouse handlers —
a deliberate extension of "framework-agnostic" to mean "not React-specific,"
not "DOM-free." The key→note mapping lives in a pure `virtualKeyboard.ts` module
(unit-tested like `keyboardGeometry.ts`/`midi.ts`); real MIDI and the Virtual
Input feed one shared `dispatchNote` core so every downstream reaction is
identical no matter which source a note came from.

Synthetic notes carry a fixed velocity (raw 100), and cleanup releases only
Virtual-Input-originated notes (on window blur, toggle-off, and mouseup/pointer
leave) so a genuinely-held Device note is never cut. Because the engine's
Overlay state (the Crystal pool and Piano Preview lighting) is keyed by note
number, `dispatchNote` also **reference-counts holders per note number**: when a
Device and the Virtual Input hold the same note at once, only the first press
spawns the Crystal and only the last release cuts it — so releasing one source
never darkens a note the other still holds. Scene callbacks and the activity
tick stay per-event, source-independent.
