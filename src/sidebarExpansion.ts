// UI-only expansion state for the sidebar's sections. Kept out of the engine on
// purpose (ADR 0002): the engine core stays framework-agnostic, so which
// sections are open lives here and persists to its own
// localStorage key managed by React — never in the engine's domain state.

export type ExpansionState = Record<string, boolean>;

// Versioned: the old key stored a nested accordion where an absent id meant
// collapsed, and carrying that over would keep sections hidden from returning users.
export const SIDEBAR_EXPANSION_KEY = 'midi-visualizer:sidebar-expansion.v2';

// Every section starts open so a first-time user sees everything they can
// change; only an explicit collapse is stored (absent id === expanded).
export const DEFAULT_EXPANSION: ExpansionState = {};

// Restore persisted expansion, falling back to defaults when nothing is stored
// or the payload is malformed. Only boolean entries are kept.
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
    return clean;
  } catch {
    return { ...DEFAULT_EXPANSION };
  }
}

export function isExpanded(state: ExpansionState, id: string): boolean {
  return state[id] ?? true;
}

export function toggleExpansion(state: ExpansionState, id: string): ExpansionState {
  return { ...state, [id]: !isExpanded(state, id) };
}
