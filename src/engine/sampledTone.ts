/**
 * A sampled Tone (see **Tone** in `CONTEXT.md` and ADR-0009): plays a Tone's
 * decoded samples by its `regions.json`, with the gain, envelope and velocity
 * response its catalogue entry fixes.
 *
 * Each voice is one buffer source per matching region, through the region's pan
 * and level, then one envelope shared by the voice. A release sample skips the
 * envelope: its 30 ms fade-in is baked into the file (#55), and it plays out on
 * its own after the key comes up.
 */
import {
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioNodeLike,
  dbToGain,
} from './audio';
import type { Tone, ToneVoice } from './tonePlayer';
import type { ToneDefinition } from '@/tones/catalogue';
import type { ToneRegion } from '@/tones/toneAssets';

/** A sampled Tone once every one of its files has downloaded and decoded. */
export interface DecodedTone {
  regions: readonly ToneRegion[];
  /** Each file a region names, decoded, by file name. */
  buffers: ReadonlyMap<string, AudioBufferLike>;
}

/** The level velocity leaves a region at: 1 − t + t · (v/127)², where t is the Tone's velocity tracking. */
function velocityScale(tracking: number, velocity: number): number {
  return 1 - tracking + tracking * (velocity / 127) ** 2;
}

/** How fast to play a region's sample so it sounds `note`: from its keycentre, plus its `tune` in cents. */
function playbackRate(region: ToneRegion, note: number): number {
  return 2 ** (((note - region.keycentre) * 100 + region.tune) / 1200);
}

export function createSampledTone(definition: ToneDefinition, decoded: DecodedTone): Tone {
  const { attackSeconds, releaseSeconds, velocityTracking } = definition;

  /** The regions that sound `note` at `velocity`: sustaining ones, or the release samples. */
  const matching = (note: number, velocity: number, release: boolean) =>
    decoded.regions.filter(
      (r) =>
        r.release === release &&
        r.keyLo <= note &&
        note <= r.keyHi &&
        r.velLo <= velocity &&
        velocity <= r.velHi,
    );

  /** Starts `region`'s sample at `note`'s pitch, through its pan and level, into `destination`. */
  function play(
    ctx: AudioContextLike,
    region: ToneRegion,
    note: number,
    velocity: number,
    destination: AudioNodeLike,
  ): AudioBufferSourceNodeLike {
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = decoded.buffers.get(region.file) ?? null;
    source.playbackRate.setValueAtTime(playbackRate(region, note), now);
    if (region.loop) {
      source.loop = true;
      source.loopStart = region.loop.start;
      source.loopEnd = region.loop.end;
    }
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(region.pan, now);
    const level = ctx.createGain();
    level.gain.setValueAtTime(
      dbToGain(region.gainDb) * velocityScale(velocityTracking, velocity),
      now,
    );
    source.connect(panner);
    panner.connect(level);
    level.connect(destination);
    source.start(now);
    return source;
  }

  return {
    id: definition.id,
    gainDb: definition.gainDb,
    sounds: (note, velocity) => matching(note, velocity, false).length > 0,
    startVoice(ctx, note, velocity, output): ToneVoice {
      const now = ctx.currentTime;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(1, now + attackSeconds);
      envelope.connect(output);
      const sustaining = matching(note, velocity, false).map((region) =>
        play(ctx, region, note, velocity, envelope),
      );
      const tails: AudioBufferSourceNodeLike[] = [];

      const stop = (time: number) => {
        for (const source of [...sustaining, ...tails]) source.stop(time);
      };

      return {
        release(time) {
          const fadeEnd = time + releaseSeconds;
          envelope.gain.cancelScheduledValues(time);
          envelope.gain.setValueAtTime(envelope.gain.value, time);
          envelope.gain.linearRampToValueAtTime(0, fadeEnd);
          for (const source of sustaining) source.stop(fadeEnd);

          // The release samples play out in full, so the voice lasts as long as
          // the longest of them: it counts as a release tail until then.
          let endTime = fadeEnd;
          for (const region of matching(note, velocity, true)) {
            const tail = play(ctx, region, note, velocity, output);
            tails.push(tail);
            // Computed, not read back: a real param shows a scheduled value only once rendered.
            const duration = (tail.buffer?.duration ?? 0) / playbackRate(region, note);
            endTime = Math.max(endTime, time + duration);
          }
          return endTime;
        },
        stop,
      };
    },
  };
}
