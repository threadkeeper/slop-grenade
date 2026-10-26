import type { AnimationTier, M365App, PersonLeaderboardEntry, SlopReport } from './types';

export type TimeSpanFilter = 'today' | '7d' | '30d' | 'all';

export interface DashboardFilterState {
  timeSpan: TimeSpanFilter;
  teams: boolean;
  outlook: boolean;
  gmail?: boolean;
  tiers: Record<AnimationTier, boolean>;
}

/** Reports at or above this score read as AI-written (the `sprinkled` tier and up). */
export const AI_WRITTEN_THRESHOLD = 40;

const AUTOMATED_SUMMARY_PREFIX = 'Automated / machine-generated response';
const PLACEHOLDER_SENDERS = new Set(['unknown sender', 'teams colleague']);

/** Automated mail (no-reply, calendar responses, bots) is scored by rule, not by writing style. */
export function isAutomatedReport(r: SlopReport): boolean {
  return (r.summary ?? '').startsWith(AUTOMATED_SUMMARY_PREFIX);
}

/** `true` when a report reads as AI-written (score of 40 or more). */
export function isAiWritten(r: SlopReport): boolean {
  return r.slopScore >= AI_WRITTEN_THRESHOLD;
}

export interface GaugeMetrics {
  /** Share (0-100) of person-written messages that read as AI-written. */
  aiPercent: number;
  /** Person-written messages that read as AI-written (score of 40 or more). */
  aiWrittenCount: number;
  /** Average 0-100 slop score across all messages. */
  averageScore: number;
  messageCount: number;
  grenadeCount: number;
}

/** Leaderboard row computed on the dashboard, with the person's AI-written share. */
export interface RankedPerson extends PersonLeaderboardEntry {
  /** Messages that read as AI-written (score of 40 or more). */
  aiMessages: number;
  /** Share (0-100) of the person's messages that read as AI-written. */
  aiSharePercent: number;
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
 * Compute In (Received) and Out (Sent) gauge metrics from filtered reports. The needle reads
 * the share of person-written messages that read as AI-written; automated mail is left out of
 * that share but still counted as a message.
 */
export function computeInOutGauges(reports: SlopReport[]): {
  received: GaugeMetrics;
  sent: GaugeMetrics;
} {
  const tally = () => ({ count: 0, sum: 0, grenades: 0, scored: 0, ai: 0 });
  const received = tally();
  const sent = tally();

  for (const r of reports) {
    const t = r.direction === 'received' ? received : sent;
    t.count++;
    t.sum += r.slopScore;
    if (r.tier === 'slop_grenade') t.grenades++;
    if (!isAutomatedReport(r)) {
      t.scored++;
      if (isAiWritten(r)) t.ai++;
    }
  }

  const toGauge = (t: ReturnType<typeof tally>): GaugeMetrics => ({
    aiPercent: t.scored > 0 ? Math.round((100 * t.ai) / t.scored) : 0,
    aiWrittenCount: t.ai,
    averageScore: t.count > 0 ? Math.round(t.sum / t.count) : 0,
    messageCount: t.count,
    grenadeCount: t.grenades
  });
  return { received: toGauge(received), sent: toGauge(sent) };
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
 * Compute the Most Wanted (Top 5 Sloppers) and Hand-Crafted Heroes (Top 5 P-Doomers) lists
 * from a report slice, ranked by each person's share of AI-written messages.
 *
 * Both lists fill to five whenever five people are known. With fewer than ten people a person
 * can appear on both lists; with ten or more the lists never overlap. Automated mail and
 * placeholder senders are left out.
 */
export function computeTopFiveLists(reports: SlopReport[]): {
  topSloppers: RankedPerson[];
  topPDoomers: RankedPerson[];
} {
  const bySender = new Map<
    string,
    { count: number; sum: number; ai: number; grenades: number; human: number }
  >();

  for (const r of reports) {
    const name = r.sender.trim();
    if (!name || PLACEHOLDER_SENDERS.has(name.toLowerCase()) || isAutomatedReport(r)) continue;
    const cur = bySender.get(name) ?? { count: 0, sum: 0, ai: 0, grenades: 0, human: 0 };
    cur.count++;
    cur.sum += r.slopScore;
    if (isAiWritten(r)) cur.ai++;
    if (r.tier === 'slop_grenade') cur.grenades++;
    if (r.tier === 'human_sparkle') cur.human++;
    bySender.set(name, cur);
  }

  const entries: RankedPerson[] = Array.from(bySender.entries()).map(([name, v]) => ({
    name,
    messageCount: v.count,
    averageSlopScore: Math.round(v.sum / Math.max(1, v.count)),
    slopGrenades: v.grenades,
    humanMessages: v.human,
    aiMessages: v.ai,
    aiSharePercent: Math.round((100 * v.ai) / Math.max(1, v.count))
  }));
  const share = (p: RankedPerson) => p.aiMessages / Math.max(1, p.messageCount);

  const topSloppers = [...entries]
    .sort(
      (a, b) =>
        share(b) - share(a) ||
        b.averageSlopScore - a.averageSlopScore ||
        b.messageCount - a.messageCount
    )
    .slice(0, 5);

  const wanted = new Set(topSloppers.map((p) => p.name));
  const topPDoomers = [...entries]
    .sort(
      (a, b) =>
        share(a) - share(b) ||
        a.averageSlopScore - b.averageSlopScore ||
        b.messageCount - a.messageCount
    )
    .filter((p) => entries.length < 10 || !wanted.has(p.name))
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
