import { describe, expect, it } from 'vitest';
import {
  FRUIT_LABELS,
  FRUIT_VARIETIES,
  createAnimationInstance,
  createSqueegeeWipe,
  pickFruitVariety,
  stepAnimation,
  stepSqueegeeWipe
} from './physics';

describe('Slop Grenade & 5-Tier Monitor Physics Engine', () => {
  it('simulates Slop Grenade flight, bezel impact, brown-red incoming vs brown-blue outgoing poop-slop, and permanent buildup', () => {
    const incoming = createAnimationInstance({
      id: 1,
      tier: 'slop_grenade',
      side: 'left',
      direction: 'received',
      score: 92,
      sender: 'Chad',
      subject: 'Q4 Synergy',
      viewportWidth: 1920,
      viewportHeight: 1080
    });

    const outgoing = createAnimationInstance({
      id: 2,
      tier: 'slop_grenade',
      side: 'right',
      direction: 'sent',
      score: 95,
      sender: 'You',
      subject: 'My Draft',
      viewportWidth: 1920,
      viewportHeight: 1080
    });

    expect(incoming.slopPalette).toBe('brown_red');
    expect(outgoing.slopPalette).toBe('brown_blue');
    expect(incoming.persistentSlop).toBe(true);
    expect(outgoing.persistentSlop).toBe(true);

    expect(incoming.phase).toBe('flight');
    expect(incoming.blobs.length).toBeGreaterThanOrEqual(16);
    expect(incoming.drips.length).toBeGreaterThanOrEqual(10);

    // Step midway through flight (0.3s)
    stepAnimation(incoming, 0.25);
    stepAnimation(incoming, 0.05);
    expect(incoming.phase).toBe('flight');
    expect(incoming.currentX).toBeLessThan(incoming.startX);

    // Step into bezel impact (0.75s total)
    stepAnimation(incoming, 0.25);
    stepAnimation(incoming, 0.2);
    expect(incoming.phase).toBe('impact');
    expect(incoming.currentX).toBe(28);
    expect(incoming.shakeIntensity).toBeGreaterThan(0);

    // Step into dripping goop and then permanent accumulated buildup
    const initialY = incoming.impactY;
    const initialDripY = incoming.drips[0].currentY;
    for (let i = 0; i < 60; i++) {
      stepAnimation(incoming, 0.25);
    }
    expect(incoming.phase).toBe('accumulated');
    expect(incoming.slideDistance).toBeGreaterThan(60);
    expect(incoming.currentY).toBeGreaterThan(initialY);
    expect(incoming.drips[0].currentY).toBeGreaterThan(initialDripY);
  });

  it('clears accumulated slop on a single monitor side when squeegeed while preserving the opposite side', () => {
    const leftSlop = createAnimationInstance({
      id: 10,
      tier: 'slop_grenade',
      side: 'left',
      direction: 'received',
      score: 88,
      sender: 'Left Sender',
      subject: 'Incoming Slop',
      viewportWidth: 1920,
      viewportHeight: 1080
    });
    const rightSlop = createAnimationInstance({
      id: 11,
      tier: 'slop_splat',
      side: 'right',
      direction: 'sent',
      score: 72,
      sender: 'Right Sender',
      subject: 'Outgoing Slop',
      viewportWidth: 1920,
      viewportHeight: 1080
    });

    // Advance both into settled state
    for (let i = 0; i < 20; i++) {
      stepAnimation(leftSlop, 0.25);
      stepAnimation(rightSlop, 0.25);
    }

    let animations = [leftSlop, rightSlop];
    let wipe = createSqueegeeWipe('left', 1080);

    while (!wipe.done) {
      const res = stepSqueegeeWipe(wipe, animations, 0.2);
      wipe = res.wipe;
      animations = res.remaining;
    }

    // Left slop must be scraped away; right slop must remain untouched
    expect(animations.some((a) => a.side === 'left')).toBe(false);
    expect(animations.some((a) => a.side === 'right')).toBe(true);
  });

  it('provides 20 distinct realistic fruit varieties and selects across all 20', () => {
    expect(FRUIT_VARIETIES.length).toBe(20);
    const uniqueSet = new Set(FRUIT_VARIETIES);
    expect(uniqueSet.size).toBe(20);

    for (let i = 0; i < FRUIT_VARIETIES.length; i++) {
      const variety = pickFruitVariety(() => i / FRUIT_VARIETIES.length);
      expect(variety).toBe(FRUIT_VARIETIES[i]);
      expect(FRUIT_LABELS[variety].length).toBeGreaterThan(3);
    }
  });

  it('creates subtle low-opacity rising sparkle plumes for authentic human messages', () => {
    const anim = createAnimationInstance({
      id: 2,
      tier: 'human_sparkle',
      side: 'right',
      score: 8,
      sender: 'Sarah',
      subject: 'PR #42',
      viewportWidth: 1920,
      viewportHeight: 1080
    });

    expect(anim.sparkles.length).toBe(16);
    for (const sp of anim.sparkles) {
      expect(sp.alpha).toBeLessThanOrEqual(0.42);
    }

    const startSparkleY = anim.sparkles[0].y;
    stepAnimation(anim, 0.2);
    expect(anim.sparkles[0].y).toBeLessThan(startSparkleY);
  });

  it('completes transient animations (peaceful_cloud, innocent_fruit, human_sparkle) while keeping slop persistent', () => {
    for (const tier of ['peaceful_cloud', 'innocent_fruit', 'human_sparkle'] as const) {
      const anim = createAnimationInstance({
        id: 3,
        tier,
        side: 'left',
        score: 45,
        sender: 'Tester',
        subject: 'Check',
        viewportWidth: 1440,
        viewportHeight: 900
      });

      let safety = 0;
      while (anim.phase !== 'done' && safety < 60) {
        stepAnimation(anim, 0.2);
        safety++;
      }
      expect(anim.phase).toBe('done');
    }
  });
});
