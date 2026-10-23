import type { AnimationTier, M365App, PersonLeaderboardEntry, SlopReport } from './types';

export type TimeSpanFilter = 'today' | '7d' | '30d' | 'all';

export interface DashboardFilterState {
  timeSpan: TimeSpanFilter;
  teams: boolean;
  outlook: boolean;
  tiers: Record<AnimationTier, boolean>;
}

export interface GaugeMetrics {
  averageScore: number;
  messageCount: number;
  grenadeCount: number;
}

export interface BarBucket {
  label: string;
  receivedScore: number;
  sentScore: number;
  receivedCount: number;
  sentCount: number;
}

/**
 * Filter reports according to the active time span, channel (Teams / Outlook),
 * and slop / non-slop tier toggles.
 */
export function filterReports(
  reports: SlopReport[],
  filters: DashboardFilterState,
  referenceIsoDate?: string
): SlopReport[] {
  const refDay = (
    referenceIsoDate ??
    reports[0]?.timestamp?.slice(0, 10) ??
    new Date().toISOString().slice(0, 10)
  ).slice(0, 10);
  const refMs = Date.parse(`${refDay}T23:59:59Z`);

  return reports.filter((r) => {
    // 1. Channel filter (Teams vs Outlook)
    const app: M365App = r.app;
    if (app === 'teams' && !filters.teams) return false;
    if (app === 'outlook' && !filters.outlook) return false;

    // 2. Slop / Non-Slop tier filter
    if (!filters.tiers[r.tier]) return false;

    // 3. Time span filter (Today resets at midnight)
    const dayStr = r.timestamp.slice(0, 10);
    if (filters.timeSpan === 'today') {
      return dayStr === refDay;
    }
    const msgMs = Date.parse(r.timestamp);
    if (Number.isNaN(msgMs) || Number.isNaN(refMs)) return true;
    const diffDays = (refMs - msgMs) / (1000 * 60 * 60 * 24);
    if (filters.timeSpan === '7d') return diffDays <= 7 && diffDays >= -1;
    if (filters.timeSpan === '30d') return diffDays <= 30 && diffDays >= -1;
    return true;
  });
}

/**
 * Compute In (Received) and Out (Sent) gauge metrics from filtered reports.
 */
export function computeInOutGauges(reports: SlopReport[]): {
  received: GaugeMetrics;
  sent: GaugeMetrics;
} {
  let recSum = 0;
  let recCount = 0;
  let recGrenades = 0;

  let sentSum = 0;
  let sentCount = 0;
  let sentGrenades = 0;

  for (const r of reports) {
    if (r.direction === 'received') {
      recCount++;
      recSum += r.slopScore;
      if (r.tier === 'slop_grenade') recGrenades++;
    } else {
      sentCount++;
      sentSum += r.slopScore;
      if (r.tier === 'slop_grenade') sentGrenades++;
    }
  }

  return {
    received: {
      averageScore: recCount > 0 ? Math.round(recSum / recCount) : 0,
      messageCount: recCount,
      grenadeCount: recGrenades
    },
    sent: {
      averageScore: sentCount > 0 ? Math.round(sentSum / sentCount) : 0,
      messageCount: sentCount,
      grenadeCount: sentGrenades
    }
  };
}

/**
 * Group filtered reports into chronological bar-chart buckets comparing
 * Received (In) vs. Sent (Out) slop.
 */
export function computeBarChartBuckets(
  reports: SlopReport[],
  timeSpan: TimeSpanFilter
): BarBucket[] {
  const bucketMap = new Map<
    string,
    { recSum: number; recCount: number; sentSum: number; sentCount: number }
  >();

  const ordered = [...reports].reverse();
  for (const r of ordered) {
    const key =
      timeSpan === 'today'
        ? `${r.timestamp.slice(11, 13) || '12'}:00`
        : r.timestamp.slice(5, 10) || '10-23';

    const cur = bucketMap.get(key) ?? { recSum: 0, recCount: 0, sentSum: 0, sentCount: 0 };
    if (r.direction === 'received') {
      cur.recSum += r.slopScore;
      cur.recCount++;
    } else {
      cur.sentSum += r.slopScore;
      cur.sentCount++;
    }
    bucketMap.set(key, cur);
  }

  return Array.from(bucketMap.entries())
    .slice(-10)
    .map(([label, v]) => ({
      label,
      receivedScore: v.recCount > 0 ? Math.round(v.recSum / v.recCount) : 0,
      sentScore: v.sentCount > 0 ? Math.round(v.sentSum / v.sentCount) : 0,
      receivedCount: v.recCount,
      sentCount: v.sentCount
    }));
}

/**
 * Compute Top 5 Sloppers and Top 5 P-Doomers (refuse to use AI) from a report slice.
 */
export function computeTopFiveLists(reports: SlopReport[]): {
  topSloppers: PersonLeaderboardEntry[];
  topPDoomers: PersonLeaderboardEntry[];
} {
  const bySender = new Map<
    string,
    { count: number; sum: number; grenades: number; human: number }
  >();

  for (const r of reports) {
    const name = r.sender.trim();
    if (!name) continue;
    const cur = bySender.get(name) ?? { count: 0, sum: 0, grenades: 0, human: 0 };
    cur.count++;
    cur.sum += r.slopScore;
    if (r.tier === 'slop_grenade') cur.grenades++;
    if (r.tier === 'human_sparkle') cur.human++;
    bySender.set(name, cur);
  }

  const entries: PersonLeaderboardEntry[] = Array.from(bySender.entries()).map(([name, v]) => ({
    name,
    messageCount: v.count,
    averageSlopScore: Math.round(v.sum / Math.max(1, v.count)),
    slopGrenades: v.grenades,
    humanMessages: v.human
  }));

  const topSloppers = entries
    .filter((e) => e.averageSlopScore >= 40)
    .sort(
      (a, b) =>
        b.averageSlopScore - a.averageSlopScore ||
        b.slopGrenades - a.slopGrenades ||
        b.messageCount - a.messageCount
    )
    .slice(0, 5);

  const topPDoomers = entries
    .filter((e) => e.averageSlopScore < 40)
    .sort(
      (a, b) =>
        a.averageSlopScore - b.averageSlopScore ||
        b.humanMessages - a.humanMessages ||
        b.messageCount - a.messageCount
    )
    .slice(0, 5);

  return { topSloppers, topPDoomers };
}
