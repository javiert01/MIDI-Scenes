import { describe, expect, it } from 'vitest';
import type { AudioBufferLike } from '@/engine/audio';
import { toneById } from '@/tones/catalogue';
import { createToneLoader, type ToneLoadOptions } from '@/tones/toneLoader';
import accordion from '@/tones/accordion/regions.json';

const ACCORDION = toneById('accordion');
const FILES = [...new Set(accordion.regions.map((r) => r.file))];

/** A decoded buffer that remembers which fetched bytes it came from. */
const bufferFor = (data: ArrayBuffer) => ({ duration: 1, from: new TextDecoder().decode(data) });

/** A fetch that answers each URL with its own text as bytes, failing any URL `fails` matches. */
function fakeFetch(events: string[] = [], fails?: RegExp) {
  return (url: string) => {
    events.push(`fetch ${url}`);
    if (fails?.test(url)) return Promise.reject(new Error(`404 ${url}`));
    return Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer);
  };
}

function options(events: string[] = [], over: Partial<ToneLoadOptions> = {}): ToneLoadOptions {
  return {
    decode: (data) => {
      events.push('decode');
      return Promise.resolve(bufferFor(data) as AudioBufferLike);
    },
    ...over,
  };
}

describe('the Tone loader', () => {
  it("fetches every file the Tone's regions name, once each, through its bundled URL", async () => {
    const events: string[] = [];
    const load = createToneLoader(fakeFetch(events));

    await load(ACCORDION, options());

    const fetched = events.map((e) => e.replace('fetch ', ''));
    expect(fetched).toHaveLength(FILES.length);
    expect(FILES.length).toBe(34); // 17 sustains and their release samples
    // Under Vitest, Vite resolves each import to its source path rather than a hashed one.
    expect(fetched.map((url) => url.split('/').at(-1)).sort()).toEqual([...FILES].sort());
  });

  it('decodes them all, and is ready with every region and a buffer for each file', async () => {
    const load = createToneLoader(fakeFetch());

    const tone = await load(ACCORDION, options());

    expect(tone.regions).toEqual(accordion.regions);
    expect([...tone.buffers.keys()].sort()).toEqual([...FILES].sort());
    const c5 = tone.buffers.get('C5.mp3') as unknown as ReturnType<typeof bufferFor>;
    expect(c5.from).toMatch(/\/C5\.mp3$/);
  });

  it('reports progress as files done out of the total, and decodes only once every file is in', async () => {
    const events: string[] = [];
    const load = createToneLoader(fakeFetch(events));

    await load(
      ACCORDION,
      options(events, { onProgress: (done, total) => events.push(`${done}/${total}`) }),
    );

    const progress = events.filter((e) => /^\d+\/\d+$/.test(e));
    expect(progress[0]).toBe('0/34');
    expect(progress.at(-1)).toBe('34/34');
    expect(progress).toHaveLength(35);
    expect(events.indexOf('decode')).toBeGreaterThan(events.indexOf('34/34'));
    expect(events.filter((e) => e === 'decode')).toHaveLength(34);
  });

  it('fails the whole Tone when any one file fails to download, decoding nothing', async () => {
    const events: string[] = [];
    const load = createToneLoader(fakeFetch(events, /G5-release/));

    await expect(load(ACCORDION, options(events))).rejects.toThrow(/G5-release/);
    expect(events).not.toContain('decode');
  });

  it('fails the whole Tone when any one file fails to decode', async () => {
    const load = createToneLoader(fakeFetch());
    let decodes = 0;

    const loading = load(ACCORDION, {
      decode: (data) => {
        decodes += 1;
        return decodes === 20
          ? Promise.reject(new Error('EncodingError'))
          : Promise.resolve(bufferFor(data) as AudioBufferLike);
      },
    });

    await expect(loading).rejects.toThrow('EncodingError');
  });

  it('stops before decoding once aborted, so a load a newer pick replaced never finishes', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const load = createToneLoader((url, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return fakeFetch(events)(url);
    });

    await expect(load(ACCORDION, options(events, { signal: controller.signal }))).rejects.toThrow();
    expect(events).not.toContain('decode');
  });

  it('fails a Tone that has no assets', async () => {
    const load = createToneLoader(fakeFetch());

    await expect(load(toneById('warm-analog'), options())).rejects.toThrow(/no assets/);
  });
});
