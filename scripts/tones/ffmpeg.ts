// The pipeline's only contact with the system ffmpeg: decoding sources to float PCM,
// and encoding prepared audio as CBR 128 kbps MP3.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MP3_BITRATE_KBPS } from '../../src/tones/toneAssets';
import { deinterleave, interleave, type Channels } from './dsp';

export interface Audio {
  sampleRate: number;
  channels: Channels;
}

const MAX_BUFFER = 1 << 30;

/** Exits with install instructions when ffmpeg or ffprobe isn't on the PATH. */
export function requireFfmpeg(): void {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const result = spawnSync(tool, ['-version'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
      console.error(
        `${tool} was not found. The Tone pipeline needs a system ffmpeg:\n\n  brew install ffmpeg\n`,
      );
      process.exit(1);
    }
  }
}

/** Decodes any file ffmpeg reads, at its own sample rate and channel count. */
export function decode(file: string): Audio {
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_streams', '-of', 'json', file],
      {
        encoding: 'utf8',
      },
    ),
  ) as { streams: { sample_rate: string; channels: number }[] };
  const stream = probe.streams[0];
  if (!stream) throw new Error(`${file} has no audio stream`);

  const pcm = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'],
    {
      maxBuffer: MAX_BUFFER,
    },
  );
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
  return {
    sampleRate: Number(stream.sample_rate),
    channels: deinterleave(samples, stream.channels),
  };
}

/**
 * Encodes CBR 128 kbps MP3 through libmp3lame at the audio's own rate and channel
 * count. The Info frame and LAME tag stay in, so browsers can drop the encoder delay
 * and padding and loop points stay sample-accurate. No ID3 tags, so the output only
 * changes when the audio does.
 */
export function encodeMp3(audio: Audio, out: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'tone-pcm-'));
  try {
    const raw = path.join(dir, 'audio.f32le');
    const pcm = interleave(audio.channels);
    writeFileSync(raw, new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    // prettier-ignore
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'f32le', '-ar', String(audio.sampleRate), '-ac', String(audio.channels.length), '-i', raw,
      '-c:a', 'libmp3lame', '-b:a', `${MP3_BITRATE_KBPS}k`,
      '-write_xing', '1', '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0',
      out,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
