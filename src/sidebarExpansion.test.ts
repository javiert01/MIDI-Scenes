import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPANSION, isExpanded, parseExpansion, toggleExpansion } from '@/sidebarExpansion';

describe('parseExpansion', () => {
  it('falls back to defaults when nothing is persisted', () => {
    expect(parseExpansion(null)).toEqual(DEFAULT_EXPANSION);
  });

  it('falls back to defaults on non-JSON garbage', () => {
    expect(parseExpansion('not json {')).toEqual(DEFAULT_EXPANSION);
  });

  it('falls back to defaults when the payload is not an object', () => {
    expect(parseExpansion('42')).toEqual(DEFAULT_EXPANSION);
    expect(parseExpansion('null')).toEqual(DEFAULT_EXPANSION);
    expect(parseExpansion('[true, false]')).toEqual(DEFAULT_EXPANSION);
  });

  it('restores a valid persisted object verbatim, without re-applying defaults', () => {
    const stored = { scene: false, overlays: true, input: true };
    expect(parseExpansion(JSON.stringify(stored))).toEqual(stored);
  });

  it('keeps only boolean entries, dropping junk values', () => {
    const raw = JSON.stringify({ scene: true, bogus: 'nope', count: 3, overlays: false });
    expect(parseExpansion(raw)).toEqual({ scene: true, overlays: false });
  });

  it('falls back to defaults for an object with no usable boolean entries', () => {
    expect(parseExpansion(JSON.stringify({ foo: 123, bar: 'x' }))).toEqual(DEFAULT_EXPANSION);
    expect(parseExpansion('{}')).toEqual(DEFAULT_EXPANSION);
  });

  it('returns a fresh copy of the defaults (no shared mutation)', () => {
    const a = parseExpansion(null);
    a.scene = false;
    expect(parseExpansion(null)).toEqual(DEFAULT_EXPANSION);
  });
});

describe('isExpanded', () => {
  it('treats a missing id as collapsed', () => {
    expect(isExpanded({}, 'anything')).toBe(false);
  });

  it('reflects the stored boolean', () => {
    expect(isExpanded({ scene: true }, 'scene')).toBe(true);
    expect(isExpanded({ scene: false }, 'scene')).toBe(false);
  });
});

describe('toggleExpansion', () => {
  it('opens a previously-absent (collapsed) id', () => {
    expect(toggleExpansion({}, 'overlays')).toEqual({ overlays: true });
  });

  it('flips an existing value', () => {
    expect(toggleExpansion({ scene: true }, 'scene')).toEqual({ scene: false });
  });

  it('leaves other entries untouched and does not mutate the input', () => {
    const state = { scene: true, overlays: false };
    const next = toggleExpansion(state, 'overlays');
    expect(next).toEqual({ scene: true, overlays: true });
    expect(state).toEqual({ scene: true, overlays: false });
  });
});
