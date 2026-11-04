// The Tone loader (ADR-0009): downloads and decodes a sampled Tone's files. It's
// injected into the engine like `createMidi`, so engine tests use a fake.
//
// Every file is imported through `import.meta.glob`, so Vite gives each a hashed
// URL that Vercel serves with an immutable cache header. The browser's HTTP cache
// is the only cache: picking a Tone again downloads nothing new.

import type { AudioBufferLike } from '@/engine/audio';
import type { DecodedTone } from '@/engine/sampledTone';
import type { ToneDefinition } from './catalogue';
import type { ToneAssets } from './toneAssets';

export interface ToneLoadOptions {
  /** Decodes one downloaded file; the Tone Player's context does this. */
  decode(data: ArrayBuffer): Promise<AudioBufferLike>;
  /** Aborted when a newer pick replaces this load. */
  signal?: AbortSignal;
  /** Files downloaded so far, out of the Tone's total. Decoding starts once every file is in. */
  onProgress?(filesDone: number, filesTotal: number): void;
}

/** Ready only once every file has downloaded and decoded. Any one failure fails the whole Tone. */
export type ToneLoader = (tone: ToneDefinition, options: ToneLoadOptions) => Promise<DecodedTone>;

/** Downloads one file's bytes. */
export type FileFetcher = (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;

/** Every committed Tone's `regions.json` and its samples' URLs, keyed `<folder>/<file>`. */
interface BundledTones {
  regions: Record<string, ToneAssets>;
  urls: Record<string, string>;
}

/** Keys glob results by path under `src/tones/`, minus `suffix`: `./accordion/A4.mp3` → `accordion/A4.mp3`. */
function byFolder<T>(modules: Record<string, T>, suffix = ''): Record<string, T> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, value]) => [path.slice(2).replace(suffix, ''), value]),
  );
}

const BUNDLED: BundledTones = {
  regions: byFolder(
    import.meta.glob<ToneAssets>('./*/regions.json', { eager: true, import: 'default' }),
    '/regions.json',
  ),
  urls: byFolder(
    import.meta.glob<string>('./*/*.mp3', { eager: true, query: '?url', import: 'default' }),
  ),
};

const fetchFile: FileFetcher = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
};

/** A loader for the committed Tones, downloading each file with `fetcher`. */
export function createToneLoader(fetcher: FileFetcher = fetchFile): ToneLoader {
  return async (tone, { decode, signal, onProgress }) => {
    const assets = tone.assets === undefined ? undefined : BUNDLED.regions[tone.assets];
    if (!assets) throw new Error(`${tone.id} has no assets`);
    const files = [...new Set(assets.regions.map((r) => r.file))];
    const urls = files.map((file) => {
      const url = BUNDLED.urls[`${tone.assets}/${file}`];
      if (!url) throw new Error(`${tone.id}: ${file} is not bundled`);
      return url;
    });

    let done = 0;
    onProgress?.(done, files.length);
    const data = await Promise.all(
      urls.map(async (url) => {
        const bytes = await fetcher(url, signal);
        done += 1;
        onProgress?.(done, files.length);
        return bytes;
      }),
    );
    signal?.throwIfAborted();

    const buffers = await Promise.all(data.map((bytes) => decode(bytes)));
    signal?.throwIfAborted();
    return { regions: assets.regions, buffers: new Map(files.map((f, i) => [f, buffers[i]])) };
  };
}

/** The app's loader: the committed Tones, over the network. */
export const loadTone: ToneLoader = createToneLoader();
