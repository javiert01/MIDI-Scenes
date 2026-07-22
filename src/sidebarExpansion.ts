// UI-only accordion expansion state for the sidebar. Kept out of the engine on
// purpose (ADR 0002): the engine core stays framework-agnostic, so which
// sidebar groups/sections are open lives here and persists to its own
// localStorage key managed by React — never in the engine's domain state.

export type ExpansionState = Record<string, boolean>;

export const SIDEBAR_EXPANSION_KEY = 'midi-visualizer:sidebar-expansion';

// First-ever load: SCENE group open with its Scene picker visible; everything
// else collapsed (absent id === collapsed).
export const DEFAULT_EXPANSION: ExpansionState = {
  scene: true,
  'scene:picker': true,
};

// Restore persisted expansion, falling back to defaults when nothing is stored
// or the payload is malformed. A valid object is trusted verbatim (so an
// all-collapsed state survives reload); only boolean entries are kept.
export function parseExpansion(raw: string | null): ExpansionState {
  if (raw == null) return { ...DEFAULT_EXPANSION };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_EXPANSION };
    }
    const clean: ExpansionState = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') clean[key] = value;
    }
    // A real persisted state always carries at least one boolean entry (toggling
    // adds one and never removes it), so an object with none is corrupt junk —
    // fall back to defaults rather than loading everything collapsed.
    return Object.keys(clean).length > 0 ? clean : { ...DEFAULT_EXPANSION };
  } catch {
    return { ...DEFAULT_EXPANSION };
  }
}

export function isExpanded(state: ExpansionState, id: string): boolean {
  return Boolean(state[id]);
}

export function toggleExpansion(state: ExpansionState, id: string): ExpansionState {
  return { ...state, [id]: !state[id] };
}
