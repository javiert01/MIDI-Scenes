import { describe, expect, it } from 'vitest';
import { NoteLedger } from '@/engine/noteLedger';

describe('NoteLedger press', () => {
  it("reports a note's first Hold as first, and every later one as added", () => {
    const ledger = new NoteLedger();
    expect(ledger.press('device', 60)).toBe('first');
    expect(ledger.press('keyboard', 60)).toBe('added');
    expect(ledger.press('device', 60)).toBe('added');
  });

  it('tracks each note number independently', () => {
    const ledger = new NoteLedger();
    expect(ledger.press('device', 60)).toBe('first');
    expect(ledger.press('device', 62)).toBe('first');
  });
});

describe('NoteLedger release', () => {
  it("reports only a note's last Hold going as last", () => {
    const ledger = new NoteLedger();
    ledger.press('device', 60);
    ledger.press('pointer', 60);
    expect(ledger.release('device', 60)).toBe('remaining');
    expect(ledger.release('pointer', 60)).toBe('last');
  });

  it('counts a source holding the same note twice, as two computer keys across an octave shift do', () => {
    const ledger = new NoteLedger();
    ledger.press('keyboard', 72);
    ledger.press('keyboard', 72);
    expect(ledger.release('keyboard', 72)).toBe('remaining');
    expect(ledger.release('keyboard', 72)).toBe('last');
  });

  it("takes nobody's Hold when the releasing source holds nothing on that note", () => {
    const ledger = new NoteLedger();
    ledger.press('keyboard', 60);
    expect(ledger.release('device', 60)).toBe('unmatched');
    expect(ledger.held.has(60)).toBe(true);
    expect(ledger.release('keyboard', 60)).toBe('last');
  });

  it('reports a release of a note nobody holds as unmatched', () => {
    const ledger = new NoteLedger();
    expect(ledger.release('device', 60)).toBe('unmatched');
    expect(ledger.held.size).toBe(0);
  });

  it('lets a note be pressed again after its last release', () => {
    const ledger = new NoteLedger();
    ledger.press('device', 60);
    ledger.release('device', 60);
    expect(ledger.press('device', 60)).toBe('first');
  });
});

describe('NoteLedger releaseAll', () => {
  it("releases every Hold of one source, one entry per Hold, leaving other sources' Holds", () => {
    const ledger = new NoteLedger();
    ledger.press('device', 60);
    ledger.press('device', 60);
    ledger.press('device', 64);
    ledger.press('keyboard', 64);

    const released = ledger.releaseAll('device');

    expect(released).toEqual([
      { note: 60, result: 'remaining' },
      { note: 60, result: 'last' },
      { note: 64, result: 'remaining' },
    ]);
    expect([...ledger.held]).toEqual([64]);
    expect(ledger.release('keyboard', 64)).toBe('last');
  });

  it('returns nothing for a source with no Holds', () => {
    const ledger = new NoteLedger();
    ledger.press('device', 60);
    expect(ledger.releaseAll('pointer')).toEqual([]);
    expect(ledger.held.has(60)).toBe(true);
  });

  it('leaves the source free to hold notes again', () => {
    const ledger = new NoteLedger();
    ledger.press('device', 60);
    ledger.releaseAll('device');
    expect(ledger.press('device', 60)).toBe('first');
  });
});

describe('NoteLedger held', () => {
  it('is a live view of the notes with at least one Hold', () => {
    const ledger = new NoteLedger();
    const { held } = ledger;
    ledger.press('device', 60);
    ledger.press('pointer', 62);
    expect([...held].sort()).toEqual([60, 62]);
    ledger.release('device', 60);
    expect([...held]).toEqual([62]);
  });
});
