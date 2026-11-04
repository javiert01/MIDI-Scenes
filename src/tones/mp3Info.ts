// Reads what the Tone pipeline needs from an MP3's first frame: its format, and its
// gapless length from the Xing/Info and LAME tags. Only MPEG-1 Layer III, which is
// what libmp3lame writes at 32, 44.1 and 48 kHz.

export interface Mp3Info {
  sampleRate: number;
  channels: 1 | 2;
  bitrateKbps: number;
  /** "Info" marks a CBR file, "Xing" a VBR one. */
  tag: 'Info' | 'Xing';
  /** Whether the LAME tag, which carries the encoder delay and padding, is present. */
  lameTag: boolean;
  /** The decoded length once the encoder delay and padding are removed. */
  durationSeconds: number;
}

const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SAMPLE_RATES = [44100, 48000, 32000];
const SAMPLES_PER_FRAME = 1152;

export function readMp3Info(bytes: Uint8Array): Mp3Info {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));

  let at = 0;
  if (text(0, 3) === 'ID3') {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    at = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }

  const b1 = bytes[at + 1];
  const b2 = bytes[at + 2];
  const isMpeg1Layer3 = bytes[at] === 0xff && (b1 & 0xfe) === 0xfa;
  const bitrateKbps = BITRATES_KBPS[b2 >> 4];
  const sampleRate = SAMPLE_RATES[(b2 >> 2) & 0x3];
  if (!isMpeg1Layer3 || !bitrateKbps || !sampleRate) {
    throw new Error('not an MPEG-1 Layer III MP3');
  }
  const channels = bytes[at + 3] >> 6 === 3 ? 1 : 2;

  let p = at + 4 + (channels === 1 ? 17 : 32);
  const tag = text(p, 4);
  if (tag !== 'Info' && tag !== 'Xing') throw new Error('MP3 has no Xing/Info tag');
  const flags = view.getUint32(p + 4);
  p += 8;
  let frames = 0;
  if (flags & 0x1) {
    frames = view.getUint32(p);
    p += 4;
  }
  if (flags & 0x2) p += 4;
  if (flags & 0x4) p += 100;
  if (flags & 0x8) p += 4;

  // The LAME tag starts with a 9-byte encoder name ("LAME3.100", or "Lavc…" when
  // FFmpeg wraps libmp3lame) and holds the 12-bit delay and padding 21 bytes in.
  const lameTag = /^(LAME|Lavc|Lavf)/.test(text(p, 4));
  let delay = 0;
  let padding = 0;
  if (lameTag) {
    delay = (bytes[p + 21] << 4) | (bytes[p + 22] >> 4);
    padding = ((bytes[p + 22] & 0xf) << 8) | bytes[p + 23];
  }

  return {
    sampleRate,
    channels,
    bitrateKbps,
    tag,
    lameTag,
    durationSeconds: (frames * SAMPLES_PER_FRAME - delay - padding) / sampleRate,
  };
}
