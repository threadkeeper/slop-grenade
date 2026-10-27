import { describe, expect, it } from 'vitest';
import {
  computeBarChartBuckets,
  computeInOutGauges,
  computeTopFiveLists,
  bucketKeyForReport,
  filterReports,
  formatLedgerTimestamp,
  gaugeWhiteToPurpleColor,
  isAutomatedReport,
  LEDGER_PAGE_SIZE,
  paginateLedger,
  rankGridReports,
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
      timeSpan: '7d', teams: false, outlook: false,
      tiers: { human_sparkle: true, peaceful_cloud: true, innocent_fruit: true, slop_splat: true, slop_grenade: true }
    };
    expect(filterReports(reports, filters, '2026-10-23').map((r) => r.app)).toEqual(['gmail']);
    expect(filterReports(reports, { ...filters, gmail: false }, '2026-10-23')).toEqual([]);
    expect(filterReports(reports, { ...filters, gmail: false, outlook: true }, '2026-10-23').map((r) => r.app)).toEqual(['outlook']);
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

  const allSourcesAndTiers = {
    teams: true, outlook: true, gmail: true,
    tiers: { human_sparkle: true, peaceful_cloud: true, innocent_fruit: true, slop_splat: true, slop_grenade: true }
  };

  it.each([
    { received: true, sent: true, expected: ['in', 'out'] },
    { received: true, sent: false, expected: ['in'] },
    { received: false, sent: true, expected: ['out'] },
    { received: false, sent: false, expected: [] }
  ])('filters incoming and outgoing messages consistently: %j', ({ received, sent, expected }) => {
    const samples = [
      report('Incoming', 75, { messageId: 'in' }),
      report('Outgoing', 45, { messageId: 'out', direction: 'sent', monitorSide: 'right' })
    ];
    const rows = filterReports(samples, { ...allSourcesAndTiers, timeSpan: '7d', received, sent }, '2026-10-23');
    expect(rows.map((row) => row.messageId)).toEqual(expected);
    const gauges = computeInOutGauges(rows);
    expect(gauges.received.messageCount).toBe(received ? 1 : 0);
    expect(gauges.sent.messageCount).toBe(sent ? 1 : 0);
    expect(computeBarChartBuckets(rows, '7d').reduce((sum, bucket) => sum + bucket.totalCount, 0)).toBe(expected.length);
    expect(computeTopFiveLists(rows).topSloppers.map((person) => person.name).sort()).toEqual(
      samples.filter((row) => expected.includes(row.messageId)).map((row) => row.sender).sort()
    );
  });

  it.each([3, 7] as const)('limits the last %i days to the exact rolling window, not the newest loaded message', (days) => {
    const now = new Date('2026-10-26T12:00:00Z');
    const cutoff = now.getTime() - days * 86400000;
    const samples = [
      report('Inside', 40, { messageId: 'inside', timestamp: new Date(cutoff + 1).toISOString() }),
      report('Boundary', 50, { messageId: 'boundary', timestamp: new Date(cutoff).toISOString() }),
      report('Old', 60, { messageId: 'old', timestamp: new Date(cutoff - 1).toISOString() }),
      report('Future', 70, { messageId: 'future', timestamp: new Date(now.getTime() + 1).toISOString() })
    ];
    const result = filterReports(samples, { ...allSourcesAndTiers, timeSpan: days === 3 ? '3d' : '7d' }, now.toISOString());
    expect(result.map((row) => row.messageId)).toEqual(['inside', 'boundary']);
  });

  it('uses local midnight for Today and does not show yesterday as today when that is the newest report', () => {
    const now = new Date(2026, 9, 26, 12, 0, 0);
    const midnight = new Date(2026, 9, 26).getTime();
    const samples = [
      report('Yesterday', 40, { messageId: 'yesterday', timestamp: new Date(midnight - 1).toISOString() }),
      report('Today', 40, { messageId: 'today', timestamp: new Date(midnight).toISOString() })
    ];
    expect(filterReports(samples, { ...allSourcesAndTiers, timeSpan: 'today' }, now.toISOString()).map((row) => row.messageId)).toEqual(['today']);
    expect(filterReports(samples.slice(0, 1), { ...allSourcesAndTiers, timeSpan: 'today' }, now.toISOString())).toEqual([]);
  });

  it('sorts the entire filtered ledger by slop or timestamp in either direction without changing the snapshot', () => {
    const samples = [
      report('A', 65, { messageId: 'a', timestamp: '2026-10-25T09:00:00Z' }),
      report('B', 95, { messageId: 'b', timestamp: '2026-10-24T09:00:00Z' }),
      report('C', 65, { messageId: 'c', timestamp: '2026-10-26T09:00:00Z' }),
      report('D', 5, { messageId: 'd', timestamp: '2026-10-23T09:00:00Z' })
    ];
    const ids = (column: 'slop' | 'timestamp', direction: 'asc' | 'desc') =>
      rankGridReports(samples, null, null, '7d', { column, direction }).map((row) => row.messageId);
    expect(ids('slop', 'desc')).toEqual(['b', 'c', 'a', 'd']);
    expect(ids('slop', 'asc')).toEqual(['d', 'c', 'a', 'b']);
    expect(ids('timestamp', 'desc')).toEqual(['c', 'a', 'b', 'd']);
    expect(ids('timestamp', 'asc')).toEqual(['d', 'b', 'a', 'c']);
    expect(samples.map((row) => row.messageId)).toEqual(['a', 'b', 'c', 'd']);
    const bucket = bucketKeyForReport(samples[0], '7d');
    expect(rankGridReports(samples, bucket, 'A', '7d', { column: 'timestamp', direction: 'desc' }).map((row) => row.messageId)).toEqual(['a']);
  });

  it('shows exactly 50 records per page without losing or duplicating the final record', () => {
    const rows = Array.from({ length: 101 }, (_, index) => report('Fixture', index % 100, { messageId: `row-${index}` }));
    const pages = [0, 1, 2].map((page) => paginateLedger(rows, page));
    expect(LEDGER_PAGE_SIZE).toBe(50);
    expect(pages.map((page) => page.rows.length)).toEqual([50, 50, 1]);
    expect(pages.map((page) => [page.start, page.end])).toEqual([[1, 50], [51, 100], [101, 101]]);
    expect(pages.every((page) => page.pageCount === 3 && page.totalRows === 101)).toBe(true);
    expect(pages.flatMap((page) => page.rows.map((row) => row.messageId))).toEqual(rows.map((row) => row.messageId));
    expect(paginateLedger(rows, 99)).toMatchObject({ pageIndex: 2, start: 101, end: 101 });
    expect(paginateLedger([], 4)).toMatchObject({ rows: [], pageIndex: 0, pageCount: 1, start: 0, end: 0 });
  });

  it.each([50, 100])('does not add a blank page after %i records', (count) => {
    const rows = Array.from({ length: count }, (_, index) => report('Fixture', 40, { messageId: `${index}` }));
    expect(paginateLedger(rows, 99)).toMatchObject({ pageCount: count / 50, pageIndex: count / 50 - 1, end: count });
  });

  it.each([-1, 0.5, Number.NaN])('rejects an invalid page index %s', (index) => {
    expect(() => paginateLedger([], index)).toThrow('Page must be a nonnegative integer');
  });

  it('formats a full local date and time, including seconds, and visibly identifies invalid timestamps', () => {
    const label = formatLedgerTimestamp('2026-10-26T12:34:56Z');
    expect(label).toContain('2026');
    expect(label).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(formatLedgerTimestamp('invalid')).toBe('Invalid timestamp');
  });
});
