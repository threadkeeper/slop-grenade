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
import {
  computeBarChartBuckets,
  computeInOutGauges,
  computeTopFiveLists,
  filterReports,
  gaugeWhiteToPurpleColor,
  rankGridReports,
  tierDisplayName,
  type DashboardFilterState
} from './dashboard';
import type { SlopReport } from './types';

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
    expect(incoming.blobs.length).toBeGreaterThanOrEqual(8);
    expect(incoming.drips.length).toBeGreaterThanOrEqual(5);

    // Step midway through flight (0.3s)
    stepAnimation(incoming, 0.25);
    stepAnimation(incoming, 0.05);
    expect(incoming.phase).toBe('flight');
    expect(incoming.currentX).toBeLessThan(incoming.startX);

    // Step into bezel impact (0.75s total)
    stepAnimation(incoming, 0.25);
    stepAnimation(incoming, 0.2);
    expect(incoming.phase).toBe('impact');
    expect(incoming.currentX).toBe(14);
    expect(incoming.shakeIntensity).toBeGreaterThan(0);

    // Step into dripping goop and then permanent accumulated buildup
    const initialY = incoming.impactY;
    const initialDripY = incoming.drips[0].currentY;
    for (let i = 0; i < 60; i++) {
      stepAnimation(incoming, 0.25);
    }
    expect(incoming.phase).toBe('accumulated');
    expect(incoming.slideDistance).toBeGreaterThan(25);
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

  it('creates subtle rising sparkle plumes for authentic human messages', () => {
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

    expect(anim.sparkles.length).toBe(10);
    for (const sp of anim.sparkles) {
      expect(sp.alpha).toBeLessThanOrEqual(0.65);
    }

    const startSparkleY = anim.sparkles[0].y;
    stepAnimation(anim, 0.2);
    expect(anim.sparkles[0].y).toBeLessThan(startSparkleY);
  });

  it('sticks sprinkled (fruit), polish (cloud), and human (sparkles) to the monitor edge until squeegeed', () => {
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

      expect(anim.persistentSlop).toBe(true);
      for (let i = 0; i < 20; i++) {
        stepAnimation(anim, 0.2);
      }
      expect(anim.phase).toBe('accumulated');
    }

    expect(tierDisplayName('slop_grenade')).toBe('slop-grenade');
    expect(tierDisplayName('slop_splat')).toBe('ai-cannon');
    expect(tierDisplayName('innocent_fruit')).toBe('sprinkled');
    expect(tierDisplayName('peaceful_cloud')).toBe('polish');
    expect(tierDisplayName('human_sparkle')).toBe('human');
    expect(gaugeWhiteToPurpleColor(0)).toBe('rgb(255, 255, 255)');
    expect(gaugeWhiteToPurpleColor(100)).toBe('rgb(147, 51, 234)');
  });

  it('filters reports by time span, Teams/Outlook source, and computes Daily Gauges + Top 5 Sloppers & P-Doomers', () => {
    const sampleReports: SlopReport[] = [
      {
        messageId: '1',
        app: 'teams',
        direction: 'received',
        sender: 'Chad Slopper',
        subjectOrTopic: 'Sync',
        timestamp: '2026-10-23T09:00:00Z',
        wordCount: 120,
        slopScore: 94,
        heuristicScore: 94,
        lunaScore: null,
        tier: 'slop_grenade',
        isSlopGrenade: true,
        monitorSide: 'left',
        breakdown: { lexicalScore: 90, structuralScore: 40, burstinessScore: 0, handoffScore: 20, lunaScore: null },
        signals: [],
        summary: '',
        selfAwarenessTip: '',
        redactedPreview: ''
      },
      {
        messageId: '2',
        app: 'outlook',
        direction: 'sent',
        sender: 'You',
        subjectOrTopic: 'Update',
        timestamp: '2026-10-23T10:00:00Z',
        wordCount: 60,
        slopScore: 52,
        heuristicScore: 52,
        lunaScore: null,
        tier: 'innocent_fruit',
        isSlopGrenade: false,
        monitorSide: 'right',
        breakdown: { lexicalScore: 52, structuralScore: 0, burstinessScore: 0, handoffScore: 0, lunaScore: null },
        signals: [],
        summary: '',
        selfAwarenessTip: '',
        redactedPreview: ''
      },
      {
        messageId: '3',
        app: 'teams',
        direction: 'received',
        sender: 'Linus Stallman',
        subjectOrTopic: 'Patch',
        timestamp: '2026-10-20T11:00:00Z',
        wordCount: 12,
        slopScore: 4,
        heuristicScore: 4,
        lunaScore: null,
        tier: 'human_sparkle',
        isSlopGrenade: false,
        monitorSide: 'left',
        breakdown: { lexicalScore: 0, structuralScore: 0, burstinessScore: 0, handoffScore: 0, lunaScore: null },
        signals: [],
        summary: '',
        selfAwarenessTip: '',
        redactedPreview: ''
      }
    ];

    const filters: DashboardFilterState = {
      timeSpan: 'today',
      teams: true,
      outlook: true,
      tiers: {
        slop_grenade: true,
        slop_splat: true,
        innocent_fruit: true,
        peaceful_cloud: true,
        human_sparkle: true
      }
    };

    const todaySlice = filterReports(sampleReports, filters, '2026-10-23');
    expect(todaySlice.length).toBe(2);

    const gauges = computeInOutGauges(todaySlice);
    expect(gauges.received.averageScore).toBe(94);
    expect(gauges.received.grenadeCount).toBe(1);
    expect(gauges.sent.averageScore).toBe(52);

    const allSlice = filterReports(sampleReports, { ...filters, timeSpan: '7d' }, '2026-10-23');
    expect(allSlice.length).toBe(3);

    const buckets = computeBarChartBuckets(allSlice, '7d');
    expect(buckets.length).toBe(2);

    const { topSloppers, topPDoomers } = computeTopFiveLists(allSlice);
    expect(topSloppers[0].name).toBe('Chad Slopper');
    expect(topPDoomers[0].name).toBe('Linus Stallman');
  });
});
