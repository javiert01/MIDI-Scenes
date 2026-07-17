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

/** Per-call context threaded through every key draw: unchanged across a single frame's keys. */
interface RenderContext {
  p: P5Like;
  width: number;
  bandTop: number;
  heldNotes: ReadonlySet<number>;
  colors: { left: RgbColor; right: RgbColor };
}

/**
 * Draws the Piano Preview Overlay: a full-band reactive keyboard standing in
 * for the piano-hands footage. Shares the Crystal columns' geometry so each
 * key sits directly below the column its Crystal falls in; a held key lights
 * up in that column's half-colour, matching the current Crystal colors.
 */
export function drawPianoPreview(
  p: P5Like,
  width: number,
  bandTop: number,
  bandHeight: number,
  heldNotes: ReadonlySet<number>,
  colors: { left: RgbColor; right: RgbColor } = CRYSTAL_COLORS,
): void {
  const ctx: RenderContext = { p, width, bandTop, heldNotes, colors };
  const keys = keyboardKeys(width);
  const whiteWidth = whiteKeyWidth(width);
  const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO;
  const blackHeight = bandHeight * BLACK_KEY_HEIGHT_RATIO;

  p.strokeWeight(1);
  p.stroke(...KEY_STROKE);
  // White keys first, then black keys on top, matching the original piano's draw order.
  for (const key of keys) {
    if (!key.isWhite) continue;
    drawKeyRect(ctx, key.x, key.note, whiteWidth, bandHeight, WHITE_KEY_FILL);
  }
  for (const key of keys) {
    if (key.isWhite) continue;
    drawKeyRect(ctx, key.x, key.note, blackWidth, blackHeight, BLACK_KEY_FILL);
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
  ctx: RenderContext,
  x: number,
  note: number,
  keyWidth: number,
  keyHeight: number,
  restFill: RgbColor,
): void {
  const held = ctx.heldNotes.has(note);
  const [r, g, b] = held ? (x < ctx.width / 2 ? ctx.colors.left : ctx.colors.right) : restFill;
  ctx.p.fill(r, g, b);
  ctx.p.rect(x, ctx.bandTop, keyWidth, keyHeight);
}
