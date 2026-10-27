import type { AnimationTier, M365App, PersonLeaderboardEntry, SlopReport } from './types';

export type TimeSpanFilter = 'today' | '3d' | '7d';

export interface DashboardFilterState {
  timeSpan: TimeSpanFilter;
  teams: boolean;
  outlook: boolean;
  gmail?: boolean;
  received?: boolean;
  sent?: boolean;
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
 * Apply the local Today or rolling three/seven-day window, direction, channel and tiers.
 */
export function filterReports(
  reports: SlopReport[],
  filters: DashboardFilterState,
  referenceIsoDate?: string
): SlopReport[] {
  const reference = referenceIsoDate
    ? new Date(referenceIsoDate.length === 10 ? `${referenceIsoDate}T23:59:59.999` : referenceIsoDate)
    : new Date();
  const refMs = reference.getTime();
  if (!Number.isFinite(refMs)) throw new RangeError('Invalid dashboard reference date.');
  const startMs = filters.timeSpan === 'today'
    ? new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime()
    : refMs - (filters.timeSpan === '3d' ? 3 : 7) * 86400000;

  return reports.filter((r) => {
    // 1. Distinct channel identities; omitted Gmail toggle preserves existing callers.
    const app: M365App = r.app;
    if (app === 'teams' && !filters.teams) return false;
    if (app === 'outlook' && !filters.outlook) return false;
    if (app === 'gmail' && filters.gmail === false) return false;
    if (r.direction === 'received' && filters.received === false) return false;
    if (r.direction === 'sent' && filters.sent === false) return false;

    // 2. Slop / Non-Slop tier filter
    if (!filters.tiers[r.tier]) return false;

    const msgMs = Date.parse(r.timestamp);
    return msgMs >= startMs && msgMs <= refMs;
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
    const key = bucketKeyForReport(r, timeSpan);

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
  const date = new Date(r.timestamp);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid chart timestamp.');
  const pad = (value: number) => String(value).padStart(2, '0');
  return timeSpan === 'today'
    ? `${pad(date.getHours())}:00`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface LedgerSort {
  column: 'slop' | 'timestamp';
  direction: 'asc' | 'desc';
}

export const LEDGER_PAGE_SIZE = 50;

const ledgerDateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

export function formatLedgerTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? ledgerDateTime.format(date) : 'Invalid timestamp';
}

/** Apply cross-filters and sort the full result before pagination, without mutating it. */
export function rankGridReports(
  reports: SlopReport[],
  selectedBucket: string | null,
  selectedPerson: string | null,
  timeSpan: TimeSpanFilter,
  sort: LedgerSort = { column: 'slop', direction: 'desc' }
): SlopReport[] {
  return reports
    .filter((r) => {
      if (selectedBucket && bucketKeyForReport(r, timeSpan) !== selectedBucket) return false;
      if (selectedPerson && r.sender.trim() !== selectedPerson) return false;
      return true;
    })
    .sort((a, b) => {
      const time = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      const primary = sort.column === 'slop' ? a.slopScore - b.slopScore : time;
      return (sort.direction === 'desc' ? -primary : primary) ||
        -time || b.slopScore - a.slopScore || a.messageId.localeCompare(b.messageId);
    });
}

/** Clamp the current page after data changes and retain every record across 50-row pages. */
export function paginateLedger(rows: SlopReport[], pageIndex: number) {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new RangeError('Page must be a nonnegative integer.');
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / LEDGER_PAGE_SIZE));
  const current = Math.min(pageIndex, pageCount - 1);
  const offset = current * LEDGER_PAGE_SIZE;
  return {
    rows: rows.slice(offset, offset + LEDGER_PAGE_SIZE),
    pageIndex: current,
    pageCount,
    totalRows: rows.length,
    start: rows.length ? offset + 1 : 0,
    end: Math.min(offset + LEDGER_PAGE_SIZE, rows.length)
  };
}
