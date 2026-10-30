import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_CUES, SAMPLE_DURATION_MS, playBarrage, playSample } from './samplePlayback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('typical activity sample', () => {
  it('shows every effect on the correct edge with at least five seconds between cues', () => {
    expect(SAMPLE_CUES).toEqual([
      { atMs: 800, tier: 'slop_grenade', side: 'left' },
      { atMs: 6300, tier: 'human_sparkle', side: 'right' },
      { atMs: 11800, tier: 'slop_splat', side: 'right' },
      { atMs: 17300, tier: 'innocent_fruit', side: 'left' },
      { atMs: 22800, tier: 'peaceful_cloud', side: 'right' }
    ]);
    for (let i = 1; i < SAMPLE_CUES.length; i++) {
      expect(SAMPLE_CUES[i].atMs - SAMPLE_CUES[i - 1].atMs).toBeGreaterThanOrEqual(5000);
    }

    const trigger = vi.fn();
    const complete = vi.fn();
    playSample(trigger, complete);
    vi.advanceTimersByTime(799);
    expect(trigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(trigger).toHaveBeenNthCalledWith(1, 'slop_grenade', 'left');
    vi.advanceTimersByTime(22000);
    expect(trigger.mock.calls).toEqual(SAMPLE_CUES.map(({ tier, side }) => [tier, side]));
    expect(complete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAMPLE_DURATION_MS - 22800);
    expect(complete).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending effects and completion without undoing effects already fired', () => {
    const trigger = vi.fn();
    const complete = vi.fn();
    const cancel = playSample(trigger, complete);
    vi.advanceTimersByTime(800);
    cancel();
    cancel();
    vi.advanceTimersByTime(SAMPLE_DURATION_MS);
    expect(trigger).toHaveBeenCalledExactlyOnceWith('slop_grenade', 'left');
    expect(complete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the existing barrage available and lets it be cancelled before a sample', () => {
    const trigger = vi.fn();
    const complete = vi.fn();
    const cancel = playBarrage(trigger, complete);
    vi.advanceTimersByTime(900);
    expect(trigger.mock.calls).toEqual([
      ['peaceful_cloud', 'right'],
      ['slop_grenade', 'left'],
      ['slop_splat', 'right']
    ]);
    cancel();
    vi.advanceTimersByTime(6000);
    expect(trigger).toHaveBeenCalledTimes(3);
    expect(complete).not.toHaveBeenCalled();
  });
});
