import type { TimeSpanFilter } from './dashboard';
import { requestApi } from './transport';

/** Longest history window a refresh can request. */
export const MAX_REFRESH_DAYS = 30;

/** Counts returned after merging a history refresh. */
export interface RefreshSummary {
  fetchedCount: number;
  newMessagesAnalyzed: number;
  grenadesTriggered: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Days of history a refresh reads for the selected dashboard span: Today 1, 7d 7, 30d and All
 * 30 (the maximum). The Android app always reads seven days.
 */
export function refreshDaysForSpan(span: TimeSpanFilter, mobile = false): number {
  if (mobile) return 7;
  switch (span) {
    case 'today':
      return 1;
    case '7d':
      return 7;
    default:
      return MAX_REFRESH_DAYS;
  }
}

/** Refresh the last `days` days (1-30) locally, surfacing HTTP and application failures. */
export async function refreshHistory(days: number, fetcher: typeof fetch = requestApi): Promise<RefreshSummary> {
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_REFRESH_DAYS) {
    throw new RangeError(`A refresh reads 1 to ${MAX_REFRESH_DAYS} days.`);
  }
  const response = await fetcher('/api/v1/scan/now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookbackDays: days, useLuna: false })
  });
  if (!response.ok) throw new Error(`Refresh failed (HTTP ${response.status}).`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Invalid refresh response.', { cause: error });
    throw error;
  }
  if (isRecord(payload) && payload.ok === false && typeof payload.error === 'string' && payload.error.trim()) {
    throw new Error(payload.error);
  }
  if (!isRecord(payload) || payload.ok !== true || payload.lookbackDays !== days || !isRecord(payload.batch)) {
    throw new Error('Invalid refresh response.');
  }
  const batch = payload.batch;
  if (
    typeof batch.fetchedCount !== 'number' || !Number.isSafeInteger(batch.fetchedCount) || batch.fetchedCount < 0 ||
    typeof batch.newMessagesAnalyzed !== 'number' || !Number.isSafeInteger(batch.newMessagesAnalyzed) ||
    batch.newMessagesAnalyzed < 0 || batch.newMessagesAnalyzed > batch.fetchedCount ||
    typeof batch.grenadesTriggered !== 'number' || !Number.isSafeInteger(batch.grenadesTriggered) ||
    batch.grenadesTriggered < 0 || batch.grenadesTriggered > batch.newMessagesAnalyzed
  ) {
    throw new Error('Invalid refresh response.');
  }
  return {
    fetchedCount: batch.fetchedCount,
    newMessagesAnalyzed: batch.newMessagesAnalyzed,
    grenadesTriggered: batch.grenadesTriggered
  };
}

/** Refresh the last seven days (the window the Android app supports). */
export function refreshSevenDays(fetcher: typeof fetch = requestApi): Promise<RefreshSummary> {
  return refreshHistory(7, fetcher);
}
