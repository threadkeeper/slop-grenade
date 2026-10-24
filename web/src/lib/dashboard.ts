import type { AnimationTier, M365App, PersonLeaderboardEntry, SlopReport } from './types';

export type TimeSpanFilter = 'today' | '7d' | '30d' | 'all';

export interface DashboardFilterState {
  timeSpan: TimeSpanFilter;
  teams: boolean;
  outlook: boolean;
  gmail?: boolean;
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
  slopGrenadeCount: number;
  aiCannonCount: number;
  sprinkledCount: number;
  polishCount: number;
  humanCount: number;
  totalCount: number;
}

/**
 * Filter reports according to the active time span, channel (Teams / Outlook / Gmail),
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
    // 1. Distinct channel identities; omitted Gmail toggle preserves existing callers.
    const app: M365App = r.app;
    if (app === 'teams' && !filters.teams) return false;
    if (app === 'outlook' && !filters.outlook) return false;
    if (app === 'gmail' && filters.gmail === false) return false;

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
 * Group filtered reports into per-day stacked bar-chart buckets with counts for each
 * of the 5 types (`slop-grenade`, `ai-cannon`, `sprinkled`, `polish`, `human`).
 */
export function computeBarChartBuckets(
  reports: SlopReport[],
  timeSpan: TimeSpanFilter
): BarBucket[] {
  const bucketMap = new Map<
    string,
    {
      recSum: number;
      recCount: number;
      sentSum: number;
      sentCount: number;
      slopGrenadeCount: number;
      aiCannonCount: number;
      sprinkledCount: number;
      polishCount: number;
      humanCount: number;
    }
  >();

  const ordered = [...reports].reverse();
  for (const r of ordered) {
    const key =
      timeSpan === 'today'
        ? `${r.timestamp.slice(11, 13) || '12'}:00`
        : r.timestamp.slice(5, 10) || '10-23';

    const cur = bucketMap.get(key) ?? {
      recSum: 0,
      recCount: 0,
      sentSum: 0,
      sentCount: 0,
      slopGrenadeCount: 0,
      aiCannonCount: 0,
      sprinkledCount: 0,
      polishCount: 0,
      humanCount: 0
    };
    if (r.direction === 'received') {
      cur.recSum += r.slopScore;
      cur.recCount++;
    } else {
      cur.sentSum += r.slopScore;
      cur.sentCount++;
    }

    if (r.tier === 'slop_grenade') cur.slopGrenadeCount++;
    else if (r.tier === 'slop_splat') cur.aiCannonCount++;
    else if (r.tier === 'innocent_fruit') cur.sprinkledCount++;
    else if (r.tier === 'peaceful_cloud') cur.polishCount++;
    else cur.humanCount++;

    bucketMap.set(key, cur);
  }

  return Array.from(bucketMap.entries())
    .slice(-12)
    .map(([label, v]) => ({
      label,
      receivedScore: v.recCount > 0 ? Math.round(v.recSum / v.recCount) : 0,
      sentScore: v.sentCount > 0 ? Math.round(v.sentSum / v.sentCount) : 0,
      receivedCount: v.recCount,
      sentCount: v.sentCount,
      slopGrenadeCount: v.slopGrenadeCount,
      aiCannonCount: v.aiCannonCount,
      sprinkledCount: v.sprinkledCount,
      polishCount: v.polishCount,
      humanCount: v.humanCount,
      totalCount:
        v.slopGrenadeCount +
        v.aiCannonCount +
        v.sprinkledCount +
        v.polishCount +
        v.humanCount
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

/**
 * Canonical display label for each tier:
 * `slop-grenade`, `ai-cannon`, `sprinkled`, `polish`, `human`.
 */
export function tierDisplayName(tier: AnimationTier): string {
  switch (tier) {
    case 'slop_grenade':
      return 'slop-grenade';
    case 'slop_splat':
      return 'ai-cannon';
    case 'innocent_fruit':
      return 'sprinkled';
    case 'peaceful_cloud':
      return 'polish';
    case 'human_sparkle':
      return 'human';
  }
}

/**
 * Interpolate gauge color from White (#ffffff at 0%) to Fully Purple (#9333ea at 100%).
 */
export function gaugeWhiteToPurpleColor(scorePercent: number): string {
  const t = Math.max(0, Math.min(100, scorePercent)) / 100;
  // White (255, 255, 255) -> Deep Purple (147, 51, 234)
  const r = Math.round(255 + (147 - 255) * t);
  const g = Math.round(255 + (51 - 255) * t);
  const b = Math.round(255 + (234 - 255) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Compute the chart bucket key for a single report so clicking a bar filters the bottom grid.
 */
export function bucketKeyForReport(r: SlopReport, timeSpan: TimeSpanFilter): string {
  return timeSpan === 'today'
    ? `${r.timestamp.slice(11, 13) || '12'}:00`
    : r.timestamp.slice(5, 10) || '10-23';
}

/**
 * Filter by optional chart selection (bucket / person) and sort descending by slopScore
 * for the Power BI-style drill-down grid at the bottom of the dashboard.
 */
export function rankGridReports(
  reports: SlopReport[],
  selectedBucket: string | null,
  selectedPerson: string | null,
  timeSpan: TimeSpanFilter
): SlopReport[] {
  return reports
    .filter((r) => {
      if (selectedBucket && bucketKeyForReport(r, timeSpan) !== selectedBucket) return false;
      if (selectedPerson && r.sender.trim() !== selectedPerson) return false;
      return true;
    })
    .slice()
    .sort((a, b) => b.slopScore - a.slopScore);
}
