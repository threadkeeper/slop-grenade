import type { EffectTier, Side } from './engine';

interface TimedCue {
  atMs: number;
  tier: EffectTier;
  side: Side;
}

export const SAMPLE_CUES: readonly TimedCue[] = [
  { atMs: 800, tier: 'slop_grenade', side: 'left' },
  { atMs: 6300, tier: 'human_sparkle', side: 'right' },
  { atMs: 11800, tier: 'slop_splat', side: 'right' },
  { atMs: 17300, tier: 'innocent_fruit', side: 'left' },
  { atMs: 22800, tier: 'peaceful_cloud', side: 'right' }
];

export const SAMPLE_DURATION_MS = 27000;

const BARRAGE_CUES: readonly TimedCue[] = [
  { atMs: 0, tier: 'peaceful_cloud', side: 'right' },
  { atMs: 250, tier: 'slop_grenade', side: 'left' },
  { atMs: 900, tier: 'slop_splat', side: 'right' },
  { atMs: 1500, tier: 'human_sparkle', side: 'left' },
  { atMs: 3200, tier: 'innocent_fruit', side: 'left' },
  { atMs: 3700, tier: 'innocent_fruit', side: 'right' },
  { atMs: 4300, tier: 'slop_grenade', side: 'right' },
  { atMs: 5200, tier: 'innocent_fruit', side: 'left' }
];

function playSequence(
  cues: readonly TimedCue[],
  durationMs: number,
  trigger: (tier: EffectTier, side: Side) => void,
  complete: () => void
): () => void {
  let index = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;

  function next() {
    if (cancelled) return;
    const cue = cues[index++];
    trigger(cue.tier, cue.side);
    if (cancelled) return;
    const nextCue = cues[index];
    timer = nextCue
      ? setTimeout(next, nextCue.atMs - cue.atMs)
      : setTimeout(complete, durationMs - cue.atMs);
  }

  timer = setTimeout(next, cues[0].atMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/** Play a representative, spaced-out set of effects without recording messages. */
export function playSample(
  trigger: (tier: EffectTier, side: Side) => void,
  complete: () => void
): () => void {
  return playSequence(SAMPLE_CUES, SAMPLE_DURATION_MS, trigger, complete);
}

/** Keep the existing stress test separately cancellable from the sample. */
export function playBarrage(
  trigger: (tier: EffectTier, side: Side) => void,
  complete: () => void
): () => void {
  return playSequence(BARRAGE_CUES, 5200, trigger, complete);
}
