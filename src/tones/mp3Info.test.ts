import { describe, expect, it } from 'vitest';
import { readMp3Info } from './mp3Info';

interface Fake {
  mono?: boolean;
  tag?: 'Info' | 'Xing';
  frames?: number;
  lame?: { delay: number; padding: number } | null;
  id3Bytes?: number;
}

/** The first frame of an MPEG-1 Layer III file at 128 kbps, 44.1 kHz, carrying the tag. */
function fakeMp3({
  mono = false,
  tag = 'Info',
  frames = 100,
  lame = { delay: 576, padding: 1000 },
  id3Bytes = 0,
}: Fake) {
  const bytes: number[] = [];
  if (id3Bytes > 0) {
    // ID3v2 header: "ID3", version, flags, then a syncsafe size.
    bytes.push(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, (id3Bytes >> 7) & 0x7f, id3Bytes & 0x7f);
    bytes.push(...new Array(id3Bytes).fill(0));
  }
  bytes.push(0xff, 0xfb, 0x90, mono ? 0xc0 : 0x00);
  bytes.push(...new Array(mono ? 17 : 32).fill(0));
  bytes.push(...[...tag].map((c) => c.charCodeAt(0)));
  bytes.push(0, 0, 0, 0x01); // flags: frame count only
  bytes.push((frames >>> 24) & 0xff, (frames >>> 16) & 0xff, (frames >>> 8) & 0xff, frames & 0xff);
  if (lame) {
    bytes.push(...[...'LAME3.100'].map((c) => c.charCodeAt(0)));
    bytes.push(...new Array(12).fill(0));
    bytes.push(
      lame.delay >> 4,
      ((lame.delay & 0xf) << 4) | (lame.padding >> 8),
      lame.padding & 0xff,
    );
  }
  bytes.push(...new Array(400).fill(0));
  return Uint8Array.from(bytes);
}

describe('readMp3Info', () => {
  it('reads the format and the gapless length from the Info and LAME tags', () => {
    const info = readMp3Info(fakeMp3({}));
    expect(info).toMatchObject({
      sampleRate: 44100,
      channels: 2,
      bitrateKbps: 128,
      tag: 'Info',
      lameTag: true,
    });
    expect(info.durationSeconds).toBeCloseTo((100 * 1152 - 576 - 1000) / 44100);
  });

  it('reads a mono file', () => {
    expect(readMp3Info(fakeMp3({ mono: true })).channels).toBe(1);
  });

  it('skips an ID3v2 tag', () => {
    expect(readMp3Info(fakeMp3({ id3Bytes: 300 })).sampleRate).toBe(44100);
  });

  it('tells a VBR Xing tag from a CBR Info tag', () => {
    expect(readMp3Info(fakeMp3({ tag: 'Xing' })).tag).toBe('Xing');
  });

  it('reports a missing LAME tag, counting whole frames', () => {
    const info = readMp3Info(fakeMp3({ lame: null }));
    expect(info.lameTag).toBe(false);
    expect(info.durationSeconds).toBeCloseTo((100 * 1152) / 44100);
  });

  it('rejects bytes that are not an MP3', () => {
    expect(() => readMp3Info(new Uint8Array(64))).toThrow(/MP3/);
  });
});
