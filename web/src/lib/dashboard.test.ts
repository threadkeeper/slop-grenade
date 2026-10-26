import { describe, expect, it } from 'vitest';
import {
  computeBarChartBuckets,
  computeInOutGauges,
  computeTopFiveLists,
  filterReports,
  gaugeWhiteToPurpleColor,
  tierDisplayName,
  type DashboardFilterState
} from './dashboard';
import type { SlopReport } from './types';

describe('Slop Grenade dashboard', () => {
  it('keeps Gmail distinct from Outlook and Teams with a backward-compatible optional filter', () => {
    const reports = ['gmail', 'outlook', 'teams'].map((app) => ({
      app, tier: 'human_sparkle', timestamp: '2026-10-23T09:00:00Z'
    })) as SlopReport[];
    const filters: DashboardFilterState = {
      timeSpan: 'all', teams: false, outlook: false,
      tiers: { human_sparkle: true, peaceful_cloud: true, innocent_fruit: true, slop_splat: true, slop_grenade: true }
    };
    expect(filterReports(reports, filters).map((r) => r.app)).toEqual(['gmail']);
    expect(filterReports(reports, { ...filters, gmail: false })).toEqual([]);
    expect(filterReports(reports, { ...filters, gmail: false, outlook: true }).map((r) => r.app)).toEqual(['outlook']);
  });
  it('names the five message types and colours the gauge from white to purple', () => {
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
