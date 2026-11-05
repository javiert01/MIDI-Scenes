// `npm run tones:build [toneId…]`: rebuilds sampled Tones' committed assets from their
// pinned sources. Each Tone gets a folder in src/tones/ holding its MP3s and a
// generated regions.json, checked against the same rules as the contract test.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkToneAssets, type ToneAssets } from '../../src/tones/toneAssets';
import { encodeMp3, requireFfmpeg } from './ffmpeg';
import type { Recipe } from './recipe';
import { accordion } from './recipes/accordion';
import { grandPiano } from './recipes/grandPiano';

const RECIPES: Recipe[] = [grandPiano, accordion];
const TONES_DIR = fileURLToPath(new URL('../../src/tones', import.meta.url));

async function buildTone(recipe: Recipe): Promise<boolean> {
  const built = await recipe.build();
  const dir = path.join(TONES_DIR, recipe.toneId);

  // Start clean, so a file the recipe stopped producing doesn't linger.
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.mp3') || name === 'regions.json') rmSync(path.join(dir, name));
  }
  for (const [name, audio] of built.files) encodeMp3(audio, path.join(dir, name));

  const assets: ToneAssets = {
    toneId: recipe.toneId,
    sources: built.sources,
    regions: built.regions,
  };
  writeFileSync(path.join(dir, 'regions.json'), `${JSON.stringify(assets, null, 2)}\n`);

  const check = checkToneAssets(assets, (name) => {
    const file = path.join(dir, name);
    return existsSync(file) ? readFileSync(file) : undefined;
  });
  console.log(
    `${recipe.toneId}: ${built.files.size} files, ${check.heldStereoSeconds.toFixed(1)} s held (stereo), ${check.mib.toFixed(2)} MiB`,
  );
  for (const problem of check.problems) console.error(`  ✗ ${problem}`);
  return check.problems.length === 0;
}

async function main() {
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((id) => !RECIPES.some((r) => r.toneId === id));
  if (unknown.length > 0) {
    console.error(
      `No recipe for ${unknown.join(', ')}. Known: ${RECIPES.map((r) => r.toneId).join(', ')}`,
    );
    process.exit(1);
  }
  requireFfmpeg();

  let ok = true;
  for (const recipe of RECIPES.filter((r) => wanted.length === 0 || wanted.includes(r.toneId))) {
    ok = (await buildTone(recipe)) && ok;
  }
  if (!ok) process.exit(1);
}

await main();
