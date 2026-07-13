import { describe, expect, it } from 'vitest';
import { drawPianoPreview } from '@/engine/pianoPreview';
import { CRYSTAL_COLORS } from '@/engine/crystals';
import { KEYBOARD_BASE_NOTE, keyColumnX, whiteKeyWidth } from '@/engine/keyboardGeometry';
import type { P5Like } from '@/engine/types';

const WIDTH = 900;
const BAND_TOP = 600;
const BAND_HEIGHT = 300;

interface RecordedCall {
  name: string;
  args: unknown[];
}

class RecordingP5 implements Partial<P5Like> {
  calls: RecordedCall[] = [];
  noStroke = () => this.calls.push({ name: 'noStroke', args: [] });
  stroke = (...args: number[]) => this.calls.push({ name: 'stroke', args });
  strokeWeight = (weight: number) => this.calls.push({ name: 'strokeWeight', args: [weight] });
  fill = (...args: number[]) => this.calls.push({ name: 'fill', args });
  rect = (...args: number[]) => this.calls.push({ name: 'rect', args });
  text = (...args: unknown[]) => this.calls.push({ name: 'text', args });
  textAlign = (...args: unknown[]) => this.calls.push({ name: 'textAlign', args });
  textSize = (size: number) => this.calls.push({ name: 'textSize', args: [size] });
}

function rects(p: RecordingP5): RecordedCall[] {
  return p.calls.filter((c) => c.name === 'rect');
}

describe('drawPianoPreview', () => {
  it('draws a rect for every white and black key across the board', () => {
    const p = new RecordingP5();

    drawPianoPreview(p as unknown as P5Like, WIDTH, BAND_TOP, BAND_HEIGHT, new Set());

    // 35 white keys + 25 black keys (5 per octave * 5 octaves).
    expect(rects(p)).toHaveLength(60);
  });

  it("aligns each key's column with keyColumnX, so it sits below its Crystal", () => {
    const p = new RecordingP5();

    drawPianoPreview(p as unknown as P5Like, WIDTH, BAND_TOP, BAND_HEIGHT, new Set());

    const baseNoteRect = rects(p).find((c) => (c.args as number[])[0] === 0);
    expect(baseNoteRect).toBeTruthy();
    expect((baseNoteRect!.args as number[])[0]).toBeCloseTo(keyColumnX(KEYBOARD_BASE_NOTE, WIDTH));
  });

  it('draws every key within the band, never above bandTop or below bandTop + bandHeight', () => {
    const p = new RecordingP5();

    drawPianoPreview(p as unknown as P5Like, WIDTH, BAND_TOP, BAND_HEIGHT, new Set());

    for (const call of rects(p)) {
      const [, y, , h] = call.args as number[];
      expect(y).toBeGreaterThanOrEqual(BAND_TOP);
      expect(y + h).toBeLessThanOrEqual(BAND_TOP + BAND_HEIGHT);
    }
  });

  it('fills a held key in its half-colour: purple on the left half, orange on the right', () => {
    const p = new RecordingP5();
    // C2 (36) sits at column 0, the left half; a note far to the right lands on the right half.
    const rightNote = 36 + 40; // well past the halfway point of a 5-octave board
    expect(keyColumnX(rightNote, WIDTH)).toBeGreaterThan(WIDTH / 2);

    drawPianoPreview(p as unknown as P5Like, WIDTH, BAND_TOP, BAND_HEIGHT, new Set([36, rightNote]));

    const fills = p.calls.filter((c) => c.name === 'fill').map((c) => c.args as number[]);
    expect(fills.some((args) => args.slice(0, 3).join(',') === CRYSTAL_COLORS.left.join(','))).toBe(
      true,
    );
    expect(
      fills.some((args) => args.slice(0, 3).join(',') === CRYSTAL_COLORS.right.join(',')),
    ).toBe(true);
  });

  it('does not light up an unheld key', () => {
    const p = new RecordingP5();

    drawPianoPreview(p as unknown as P5Like, WIDTH, BAND_TOP, BAND_HEIGHT, new Set());

    const fills = p.calls.filter((c) => c.name === 'fill').map((c) => c.args as number[]);
    const usesCrystalColor = fills.some(
      (args) =>
        args.slice(0, 3).join(',') === CRYSTAL_COLORS.left.join(',') ||
        args.slice(0, 3).join(',') === CRYSTAL_COLORS.right.join(','),
    );
    expect(usesCrystalColor).toBe(false);
  });

  it('labels white keys with a note letter, and skips labels for black keys', () => {
    const p = new RecordingP5();

    drawPianoPreview(p as unknown as P5Like, WIDTH, BAND_TOP, BAND_HEIGHT, new Set());

    const texts = p.calls.filter((c) => c.name === 'text').map((c) => c.args[0] as string);
    // 35 white keys are labelled; black keys never call text().
    expect(texts).toHaveLength(35);
    expect(texts).toContain('C2');
    expect(texts).toContain('D');
  });

  it('sizes black keys narrower and shorter than white keys', () => {
    const p = new RecordingP5();

    drawPianoPreview(p as unknown as P5Like, WIDTH, BAND_TOP, BAND_HEIGHT, new Set());

    const whiteWidth = whiteKeyWidth(WIDTH);
    const allRects = rects(p).map((c) => c.args as number[]);
    const whiteRect = allRects.find(([, , w]) => Math.abs(w - whiteWidth) < 0.01)!;
    const blackRect = allRects.find(([, , w]) => w < whiteWidth)!;

    expect(blackRect[2]).toBeLessThan(whiteRect[2]); // narrower
    expect(blackRect[3]).toBeLessThan(whiteRect[3]); // shorter
  });
});
