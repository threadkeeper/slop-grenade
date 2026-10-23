import { describe, expect, it } from 'vitest';
import { createAnimationInstance, stepAnimation } from './physics';

describe('Slop Grenade & 5-Tier Monitor Physics Engine', () => {
  it('simulates Slop Grenade flight, bezel impact, and squishy sliding goop down the monitor edge', () => {
    const anim = createAnimationInstance({
      id: 1,
      tier: 'slop_grenade',
      side: 'left',
      score: 92,
      sender: 'Chad',
      subject: 'Q4 Synergy',
      viewportWidth: 1920,
      viewportHeight: 1080
    });

    expect(anim.phase).toBe('flight');
    expect(anim.blobs.length).toBeGreaterThanOrEqual(12);
    expect(anim.drips.length).toBeGreaterThanOrEqual(8);

    // Step midway through flight (0.3s)
    stepAnimation(anim, 0.25);
    stepAnimation(anim, 0.05);
    expect(anim.phase).toBe('flight');
    expect(anim.currentX).toBeLessThan(anim.startX);

    // Step into bezel impact (0.7s total)
    stepAnimation(anim, 0.2);
    stepAnimation(anim, 0.2);
    expect(anim.phase).toBe('impact');
    expect(anim.currentX).toBe(28);
    expect(anim.shakeIntensity).toBeGreaterThan(0);

    // Step into squishy sliding goop phase (2.5s total)
    const initialY = anim.impactY;
    const initialDripY = anim.drips[0].currentY;
    for (let i = 0; i < 10; i++) {
      stepAnimation(anim, 0.2);
    }
    expect(anim.phase).toBe('sliding_goop');
    expect(anim.slideDistance).toBeGreaterThan(40);
    expect(anim.currentY).toBeGreaterThan(initialY);
    expect(anim.drips[0].currentY).toBeGreaterThan(initialDripY);
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
      // Must remain subtle and barely visible (<= 0.42 alpha)
      expect(sp.alpha).toBeLessThanOrEqual(0.42);
    }

    const startSparkleY = anim.sparkles[0].y;
    stepAnimation(anim, 0.2);
    expect(anim.sparkles[0].y).toBeLessThan(startSparkleY);
  });

  it('simulates peaceful cloud, innocent fruit, and slop splat lifecycles cleanly to completion', () => {
    for (const tier of ['peaceful_cloud', 'innocent_fruit', 'slop_splat'] as const) {
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
