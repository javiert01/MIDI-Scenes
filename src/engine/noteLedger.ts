/**
 * The record of every Hold (see `CONTEXT.md`): which source keeps which note
 * number down, and how many times. It only answers questions; the engine turns
 * its answers into Crystals, key lighting and sound. A note's first Hold and its
 * last release are the edges that matter, so one source letting go never cuts a
 * note another still holds (ADR-0005).
 */

/** Where a Hold comes from: the Device, or one of the Virtual Input's two surfaces. */
export type NoteSource = 'device' | 'keyboard' | 'pointer';

/** `'first'` when the note had no Hold before this press, otherwise `'added'`. */
export type PressResult = 'first' | 'added';

/**
 * `'last'` when this release ended the note's final Hold, `'remaining'` when other
 * Holds still keep it down, and `'unmatched'` when the source held nothing on that
 * note, so the release took nobody's Hold.
 */
export type ReleaseResult = 'last' | 'remaining' | 'unmatched';

/** One Hold ended by `releaseAll`. */
export interface Release {
  note: number;
  result: Exclude<ReleaseResult, 'unmatched'>;
}

export class NoteLedger {
  /** Hold counts per note, then per source. A note is present only while it has a Hold. */
  private readonly holds = new Map<number, Map<NoteSource, number>>();
  private readonly heldNotes = new Set<number>();

  /** The notes with at least one Hold. A live view: it changes as the ledger does. */
  get held(): ReadonlySet<number> {
    return this.heldNotes;
  }

  /** Records one more Hold of `note` by `source`. */
  press(source: NoteSource, note: number): PressResult {
    let bySource = this.holds.get(note);
    const first = !bySource;
    if (!bySource) {
      bySource = new Map();
      this.holds.set(note, bySource);
      this.heldNotes.add(note);
    }
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
    return first ? 'first' : 'added';
  }

  /** Ends one of `source`'s Holds on `note`, if it has any. */
  release(source: NoteSource, note: number): ReleaseResult {
    const bySource = this.holds.get(note);
    const count = bySource?.get(source) ?? 0;
    if (!bySource || count === 0) return 'unmatched';
    return this.endHold(source, note, bySource, count);
  }

  /**
   * Ends every Hold `source` has, one entry per Hold, so a caller can react
   * exactly as it would to that many separate releases.
   */
  releaseAll(source: NoteSource): Release[] {
    const owed: Array<[number, Map<NoteSource, number>, number]> = [];
    for (const [note, bySource] of this.holds) {
      const count = bySource.get(source);
      if (count) owed.push([note, bySource, count]);
    }

    const released: Release[] = [];
    for (const [note, bySource, count] of owed) {
      for (let left = count; left > 0; left -= 1) {
        released.push({ note, result: this.endHold(source, note, bySource, left) });
      }
    }
    return released;
  }

  /** Ends one of the `count` Holds `source` has on `note`, whose per-source counts are `bySource`. */
  private endHold(
    source: NoteSource,
    note: number,
    bySource: Map<NoteSource, number>,
    count: number,
  ): Release['result'] {
    if (count > 1) bySource.set(source, count - 1);
    else bySource.delete(source);

    if (bySource.size > 0) return 'remaining';
    this.holds.delete(note);
    this.heldNotes.delete(note);
    return 'last';
  }
}
