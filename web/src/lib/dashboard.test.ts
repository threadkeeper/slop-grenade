import { describe, expect, it } from 'vitest';
import {
  computeBarChartBuckets,
  computeInOutGauges,
  computeTopFiveLists,
  filterReports,
  gaugeWhiteToPurpleColor,
  isAutomatedReport,
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
    expect(gauges.received.aiPercent).toBe(100);
    expect(gauges.sent.averageScore).toBe(52);
    expect(gauges.sent.aiPercent).toBe(100);

    const allSlice = filterReports(sampleReports, { ...filters, timeSpan: '7d' }, '2026-10-23');
    expect(allSlice.length).toBe(3);

    const buckets = computeBarChartBuckets(allSlice, '7d');
    expect(buckets.length).toBe(2);

    const { topSloppers, topPDoomers } = computeTopFiveLists(allSlice);
    expect(topSloppers[0].name).toBe('Chad Slopper');
    expect(topPDoomers[0].name).toBe('Linus Stallman');
  });

  function report(sender: string, slopScore: number, extra: Partial<SlopReport> = {}): SlopReport {
    const tier =
      slopScore >= 80 ? 'slop_grenade'
      : slopScore >= 60 ? 'slop_splat'
      : slopScore >= 40 ? 'innocent_fruit'
      : slopScore >= 20 ? 'peaceful_cloud'
      : 'human_sparkle';
    return {
      messageId: `${sender}-${slopScore}-${Math.random()}`,
      app: 'teams',
      direction: 'received',
      sender,
      subjectOrTopic: 'Chat',
      timestamp: '2026-10-23T09:00:00Z',
      wordCount: 20,
      slopScore,
      heuristicScore: slopScore,
      lunaScore: null,
      tier,
      isSlopGrenade: tier === 'slop_grenade',
      monitorSide: 'left',
      breakdown: { lexicalScore: 0, structuralScore: 0, burstinessScore: 0, handoffScore: 0, lunaScore: null },
      signals: [],
      summary: '',
      selfAwarenessTip: '',
      redactedPreview: '',
      ...extra
    } as SlopReport;
  }

  it('reads the gauges as the share of AI-written messages, leaving automated mail out of the share', () => {
    const gauges = computeInOutGauges([
      report('Ava', 85),
      report('Ben', 45),
      report('Cal', 39),
      report('Dee', 5),
      report('Calendar', 4, { summary: 'Automated / machine-generated response classified as sparkle (human).' }),
      report('You', 62, { direction: 'sent', monitorSide: 'right' }),
      report('You', 12, { direction: 'sent', monitorSide: 'right' })
    ]);
    expect(gauges.received).toMatchObject({ aiPercent: 50, aiWrittenCount: 2, messageCount: 5, grenadeCount: 1 });
    expect(gauges.sent).toMatchObject({ aiPercent: 50, aiWrittenCount: 1, messageCount: 2, grenadeCount: 0 });
    expect(computeInOutGauges([]).received.aiPercent).toBe(0);
  });

  it('ranks both leaderboards by AI share and always fills five rows', () => {
    const reports = [
      ...[90, 85, 70, 60].map((s) => report('Ava', s)),
      ...[90, 85, 70, 10].map((s) => report('Ben', s)),
      ...[90, 45, 10, 5].map((s) => report('Cal', s)),
      ...[41, 10, 5, 5].map((s) => report('Dee', s)),
      ...[30, 10, 5, 2].map((s) => report('Eli', s)),
      report('Fay', 3),
      ...[95, 3].map((s) => report('Gus', s)),
      report('Unknown Sender', 99),
      report('Teams Colleague', 1),
      report('no-reply', 4, { summary: 'Automated / machine-generated response classified as sparkle (human).' })
    ];
    const { topSloppers, topPDoomers } = computeTopFiveLists(reports);
    expect(topSloppers.map((p) => p.name)).toEqual(['Ava', 'Ben', 'Gus', 'Cal', 'Dee']);
    expect(topSloppers.map((p) => p.aiSharePercent)).toEqual([100, 75, 50, 50, 25]);
    expect(topPDoomers.map((p) => p.name)).toEqual(['Fay', 'Eli', 'Dee', 'Cal', 'Gus']);
    expect(topPDoomers[0]).toMatchObject({ aiSharePercent: 0, messageCount: 1 });
  });

  it('keeps the two leaderboards apart once ten people are known', () => {
    const reports = Array.from({ length: 12 }, (_, i) => report(`Person ${i}`, i * 8));
    const { topSloppers, topPDoomers } = computeTopFiveLists(reports);
    expect(topSloppers).toHaveLength(5);
    expect(topPDoomers).toHaveLength(5);
    const wanted = new Set(topSloppers.map((p) => p.name));
    expect(topPDoomers.some((p) => wanted.has(p.name))).toBe(false);
  });

  it('recognises automated reports by their summary', () => {
    expect(isAutomatedReport(report('x', 4, { summary: 'Automated / machine-generated response classified as sparkle (human).' }))).toBe(true);
    expect(isAutomatedReport(report('x', 4))).toBe(false);
  });
});
