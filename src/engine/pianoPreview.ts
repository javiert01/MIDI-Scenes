import type { P5Like } from './types';
import { type KeyboardKey, keyboardKeys, whiteKeyWidth } from './keyboardGeometry';
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
 * The Piano Preview's band rectangle: 35 white keys tile the full canvas
 * `width`, from `top` (the visualization area's bottom edge) down `height` px
 * (the Chroma Key band). Drawing and hit-testing share this one geometry.
 */
export interface PianoBand {
  width: number;
  top: number;
  height: number;
}

/** The per-key geometry both drawing and hit-testing derive from a band. */
interface KeyMetrics {
  keys: KeyboardKey[];
  whiteWidth: number;
  blackWidth: number;
  blackHeight: number;
}

/** Derives the shared key geometry from a band — one source for both surfaces. */
function keyMetrics(band: PianoBand): KeyMetrics {
  const whiteWidth = whiteKeyWidth(band.width);
  return {
    keys: keyboardKeys(band.width),
    whiteWidth,
    blackWidth: whiteWidth * BLACK_KEY_WIDTH_RATIO,
    blackHeight: band.height * BLACK_KEY_HEIGHT_RATIO,
  };
}

/** Per-call context threaded through every key draw: unchanged across a single frame's keys. */
interface RenderContext {
  p: P5Like;
  band: PianoBand;
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
  band: PianoBand,
  heldNotes: ReadonlySet<number>,
  colors: { left: RgbColor; right: RgbColor } = CRYSTAL_COLORS,
): void {
  const ctx: RenderContext = { p, band, heldNotes, colors };
  const { keys, whiteWidth, blackWidth, blackHeight } = keyMetrics(band);

  p.strokeWeight(1);
  p.stroke(...KEY_STROKE);
  // White keys first, then black keys on top, matching the original piano's draw order.
  for (const key of keys) {
    if (!key.isWhite) continue;
    drawKeyRect(ctx, key.x, key.note, whiteWidth, band.height, WHITE_KEY_FILL);
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
    p.text(key.label, key.x + whiteWidth / 2, band.top + band.height - whiteWidth * 0.5);
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
  const [r, g, b] = held ? (x < ctx.band.width / 2 ? ctx.colors.left : ctx.colors.right) : restFill;
  ctx.p.fill(r, g, b);
  ctx.p.rect(x, ctx.band.top, keyWidth, keyHeight);
}

/**
 * The note whose Piano Preview key covers canvas point (x, y), or null if none.
 * Black keys are tested first — they render on top of and shorter than the white
 * keys, so a point over a black key belongs to it, not the white key beneath.
 * The click surface of the Virtual Input; shares drawPianoPreview's geometry via keyMetrics.
 */
export function noteAtCanvasPoint(x: number, y: number, band: PianoBand): number | null {
  if (y < band.top || y > band.top + band.height) return null;
  const { keys, whiteWidth, blackWidth, blackHeight } = keyMetrics(band);

  for (const key of keys) {
    if (key.isWhite) continue;
    if (x >= key.x && x <= key.x + blackWidth && y <= band.top + blackHeight) return key.note;
  }
  for (const key of keys) {
    if (!key.isWhite) continue;
    if (x >= key.x && x <= key.x + whiteWidth) return key.note;
  }
  return null;
}
