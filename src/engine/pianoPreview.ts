import type { P5Like } from './types';
import { keyboardKeys, whiteKeyWidth } from './keyboardGeometry';
import { CRYSTAL_COLORS } from './crystals';

type RgbColor = readonly [number, number, number];

/** A held key's shorter, narrower black-key silhouette vs. a full-band white key. */
const BLACK_KEY_WIDTH_RATIO = 0.6;
const BLACK_KEY_HEIGHT_RATIO = 0.62;

const WHITE_KEY_FILL: RgbColor = [255, 255, 255];
const BLACK_KEY_FILL: RgbColor = [25, 25, 25];
const KEY_STROKE: RgbColor = [60, 60, 60];
const LABEL_FILL: RgbColor = [70, 70, 70];
const LABEL_FILL_HELD: RgbColor = [255, 255, 255];

/**
 * Draws the Piano Preview Overlay: a full-band reactive keyboard standing in
 * for the piano-hands footage. Shares the Crystal columns' geometry so each
 * key sits directly below the column its Crystal falls in; a held key lights
 * up in that column's half-colour (purple left, orange right).
 */
export function drawPianoPreview(
  p: P5Like,
  width: number,
  bandTop: number,
  bandHeight: number,
  heldNotes: ReadonlySet<number>,
): void {
  const keys = keyboardKeys(width);
  const whiteWidth = whiteKeyWidth(width);
  const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO;
  const blackHeight = bandHeight * BLACK_KEY_HEIGHT_RATIO;

  p.strokeWeight(1);
  p.stroke(...KEY_STROKE);
  // White keys first, then black keys on top, matching the original piano's draw order.
  for (const key of keys) {
    if (!key.isWhite) continue;
    drawKeyRect(p, key.x, key.note, width, bandTop, whiteWidth, bandHeight, heldNotes, WHITE_KEY_FILL);
  }
  for (const key of keys) {
    if (key.isWhite) continue;
    drawKeyRect(p, key.x, key.note, width, bandTop, blackWidth, blackHeight, heldNotes, BLACK_KEY_FILL);
  }

  p.noStroke();
  p.textAlign('center', 'center');
  p.textSize(whiteWidth * 0.4);
  for (const key of keys) {
    if (!key.isWhite || key.label === null) continue;
    const [r, g, b] = heldNotes.has(key.note) ? LABEL_FILL_HELD : LABEL_FILL;
    p.fill(r, g, b);
    p.text(key.label, key.x + whiteWidth / 2, bandTop + bandHeight - whiteWidth * 0.5);
  }
}

function drawKeyRect(
  p: P5Like,
  x: number,
  note: number,
  fullWidth: number,
  bandTop: number,
  keyWidth: number,
  keyHeight: number,
  heldNotes: ReadonlySet<number>,
  restFill: RgbColor,
): void {
  const held = heldNotes.has(note);
  const [r, g, b] = held ? (x < fullWidth / 2 ? CRYSTAL_COLORS.left : CRYSTAL_COLORS.right) : restFill;
  p.fill(r, g, b);
  p.rect(x, bandTop, keyWidth, keyHeight);
}
