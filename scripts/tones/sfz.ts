// Reads the parts of SFZ that the pipeline's sources use, and turns an SFZ region into
// a `regions.json` region.

import type { ToneRegion } from '../../src/tones/toneAssets';

export type SfzOpcodes = Record<string, string>;

const LEVELS = ['control', 'global', 'master', 'group'] as const;
type Level = (typeof LEVELS)[number];

/**
 * Flattens an SFZ file into one opcode map per region, each holding the opcodes it
 * inherits from its control, global, master and group headers. A new header clears
 * its own level and every level below it, as in the SFZ format.
 */
export function parseSfz(text: string): SfzOpcodes[] {
  const source = text.replace(/\/\/[^\n]*/g, '');
  // A value runs until the next opcode or header, so sample paths may hold spaces.
  const tokens = [...source.matchAll(/<(\w+)>|([A-Za-z_][\w$]*)=/g)];
  const levels: Record<Level, SfzOpcodes> = { control: {}, global: {}, master: {}, group: {} };
  const regions: SfzOpcodes[] = [];
  let current: SfzOpcodes = {};
  let inRegion = false;

  const flush = () => {
    if (inRegion) regions.push(Object.assign({}, ...LEVELS.map((l) => levels[l]), current));
  };

  tokens.forEach((token, i) => {
    const header = token[1];
    if (header !== undefined) {
      flush();
      inRegion = header === 'region';
      const level = LEVELS.indexOf(header as Level);
      if (level !== -1) {
        for (const l of LEVELS.slice(level)) levels[l] = {};
        current = levels[header as Level];
      } else {
        current = {};
      }
      return;
    }
    const valueStart = token.index + token[0].length;
    const valueEnd = tokens[i + 1]?.index ?? source.length;
    current[token[2]] = source.slice(valueStart, valueEnd).trim();
  });
  flush();
  return regions;
}

const NOTE_OFFSETS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** An SFZ key: a MIDI number, or a note name with C4 = 60. */
export function sfzKey(value: string): number {
  const v = value.trim().toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^([a-g])(#|b)?(-?\d+)$/.exec(v);
  if (!m) throw new Error(`not an SFZ key: ${value}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return NOTE_OFFSETS[m[1]] + accidental + (Number(m[3]) + 1) * 12;
}

/** The keys an SFZ region sounds on: lokey..hikey, or `key`, or just its keycentre. */
export function keyRange(op: SfzOpcodes): { lo: number; hi: number } {
  const keycentre = op.pitch_keycenter ?? op.key ?? '60';
  return {
    lo: sfzKey(op.lokey ?? op.key ?? keycentre),
    hi: sfzKey(op.hikey ?? op.key ?? keycentre),
  };
}

const LOOPING_MODES = ['loop_continuous', 'loop_sustain'];

/**
 * Converts one SFZ region. `cut` is how many frames the recipe removed from the start
 * of the source sample (an SFZ `offset` it baked in, plus the trim), so loop points
 * land in the right place in the shipped file.
 */
export function regionFromSfz(
  op: SfzOpcodes,
  { file, cut, sampleRate }: { file: string; cut: number; sampleRate: number },
): ToneRegion {
  const keycentre = sfzKey(op.pitch_keycenter ?? op.key ?? '60');
  const opcodeNumber = (name: string, fallback: number) =>
    op[name] === undefined ? fallback : Number(op[name]);

  let loop: ToneRegion['loop'] = null;
  const loops = op.loop_mode === undefined || LOOPING_MODES.includes(op.loop_mode);
  if (loops && op.loop_start !== undefined && op.loop_end !== undefined) {
    const start = Number(op.loop_start);
    if (start < cut)
      throw new Error(`${file}: cutting ${cut} frames eats into the loop at ${start}`);
    // SFZ's loop_end is the last frame of the loop. Web Audio's loopEnd is exclusive.
    loop = { start: (start - cut) / sampleRate, end: (Number(op.loop_end) + 1 - cut) / sampleRate };
  }

  const keys = keyRange(op);
  return {
    file,
    keycentre,
    keyLo: keys.lo,
    keyHi: keys.hi,
    velLo: Math.max(1, opcodeNumber('lovel', 1)),
    velHi: opcodeNumber('hivel', 127),
    tune: opcodeNumber('tune', 0),
    gainDb: opcodeNumber('volume', 0),
    pan: opcodeNumber('pan', 0) / 100,
    loop,
    release: op.trigger === 'release',
  };
}

/**
 * Stretches the outermost regions so the Tone sounds across lo..hi. Every region that
 * starts at the lowest key is widened down, and every one ending at the highest key is
 * widened up, so velocity layers and release samples stay in step.
 */
export function widenToCover(regions: ToneRegion[], lo: number, hi: number): ToneRegion[] {
  const lowest = Math.min(...regions.map((r) => r.keyLo));
  const highest = Math.max(...regions.map((r) => r.keyHi));
  return regions.map((r) => ({
    ...r,
    keyLo: r.keyLo === lowest ? Math.min(r.keyLo, lo) : r.keyLo,
    keyHi: r.keyHi === highest ? Math.max(r.keyHi, hi) : r.keyHi,
  }));
}
