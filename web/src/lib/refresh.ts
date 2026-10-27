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

/** Stages of a desktop history refresh. */
export type RefreshPhase = 'connecting' | 'outlook' | 'teams' | 'analyzing' | 'completed' | 'failed';

/** Metadata-only history counters; contains no messages or account identities. */
export interface RefreshProgress {
  refreshId: string | null;
  lookbackDays: number;
  phase: RefreshPhase;
  outlookScanned: number;
  outlookTotal: number | null;
  teamsScanned: number;
  teamsTotal: number | null;
  teamsChatsDiscovered: number;
  teamsChatsScanned: number;
  teamsChatsTotal: number | null;
  analyzedCount: number;
  analysisTotal: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTotal(value: unknown, scanned: number): value is number | null {
  return value === null || (isCount(value) && value >= scanned);
}

function validRefreshId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);
}

function validateDays(days: number): void {
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_REFRESH_DAYS) {
    throw new RangeError(`A refresh reads 1 to ${MAX_REFRESH_DAYS} days.`);
  }
}

async function responseJson(response: Response, invalidMessage: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(invalidMessage, { cause: error });
    throw error;
  }
}

function isProgress(value: unknown, id: string, days: number): value is RefreshProgress {
  if (
    !isRecord(value) || value.refreshId !== id || value.lookbackDays !== days ||
    typeof value.phase !== 'string' ||
    !['connecting', 'outlook', 'teams', 'analyzing', 'completed', 'failed'].includes(value.phase) ||
    !isCount(value.outlookScanned) || !isCount(value.teamsScanned) ||
    !isCount(value.teamsChatsDiscovered) || !isCount(value.teamsChatsScanned) ||
    !isCount(value.analyzedCount)
  ) return false;
  if (
    !isTotal(value.outlookTotal, value.outlookScanned) ||
    !isTotal(value.teamsTotal, value.teamsScanned) ||
    !isTotal(value.teamsChatsTotal, value.teamsChatsScanned) ||
    !isTotal(value.analysisTotal, value.analyzedCount) ||
    (value.phase === 'analyzing' && value.analysisTotal === null)
  ) return false;
  return value.phase !== 'completed' || (
    value.outlookTotal === value.outlookScanned && value.teamsTotal === value.teamsScanned &&
    value.teamsChatsTotal === value.teamsChatsScanned && value.analysisTotal === value.analyzedCount
  );
}

/** Format actual page counts without inventing a total while it is still being discovered. */
export function formatRefreshCount(scanned: number, total: number | null): string {
  if (!isCount(scanned) || !isTotal(total, scanned)) throw new RangeError('Invalid refresh count.');
  return total === null
    ? `${scanned.toLocaleString()} scanned \u00b7 discovering total`
    : `${scanned.toLocaleString()} / ${total.toLocaleString()} scanned`;
}

/** Poll only this pending desktop refresh; slow requests never overlap and disposal aborts them. */
export function createRefreshProgress(
  refreshId: string,
  days: number,
  update: (progress: RefreshProgress) => void,
  reportError: (message: string | null) => void,
  fetcher: typeof fetch = requestApi
) {
  validateDays(days);
  if (!validRefreshId(refreshId)) throw new RangeError('Invalid refresh ID.');
  let disposed = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: AbortController | undefined;
  const poll = async () => {
    if (disposed) return;
    const controller = new AbortController();
    pending = controller;
    try {
      const response = await fetcher(`/api/v1/scan/progress?refreshId=${encodeURIComponent(refreshId)}`, {
        signal: controller.signal, cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Refresh progress failed (HTTP ${response.status}).`);
      const payload = await responseJson(response, 'Invalid refresh progress response.');
      if (disposed) return;
      if (!isRecord(payload) || (payload.progress !== null && !isProgress(payload.progress, refreshId, days))) {
        throw new Error('Invalid refresh progress response.');
      }
      if (payload.progress !== null) {
        update(payload.progress);
        finished = payload.progress.phase === 'completed' || payload.progress.phase === 'failed';
      }
      reportError(null);
    } catch (error) {
      if (!disposed) reportError(error instanceof Error ? error.message : 'Cannot read refresh progress.');
    } finally {
      pending = undefined;
      if (!disposed && !finished) timer = setTimeout(() => { void poll(); }, 1000);
    }
  };
  void poll();
  return {
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      pending?.abort();
    }
  };
}

/**
 * Days of history for Today, last three days or last seven days.
 * The Android app always reads seven days.
 */
export function refreshDaysForSpan(span: TimeSpanFilter, mobile = false): number {
  if (mobile) return 7;
  switch (span) {
    case 'today':
      return 1;
    case '3d':
      return 3;
    case '7d':
      return 7;
  }
}

/** Refresh the last `days` days (1-30) locally, surfacing HTTP and application failures. */
export async function refreshHistory(
  days: number, fetcher: typeof fetch = requestApi, refreshId?: string
): Promise<RefreshSummary> {
  validateDays(days);
  if (refreshId !== undefined && !validRefreshId(refreshId)) throw new RangeError('Invalid refresh ID.');
  const response = await fetcher('/api/v1/scan/now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookbackDays: days, useLuna: false, ...(refreshId === undefined ? {} : { refreshId }) })
  });
  if (!response.ok) throw new Error(`Refresh failed (HTTP ${response.status}).`);

  const payload = await responseJson(response, 'Invalid refresh response.');
  if (isRecord(payload) && payload.ok === false && typeof payload.error === 'string' && payload.error.trim()) {
    throw new Error(payload.error);
  }
  if (!isRecord(payload) || payload.ok !== true || payload.lookbackDays !== days || !isRecord(payload.batch)) {
    throw new Error('Invalid refresh response.');
  }
  const batch = payload.batch;
  if (
    !isCount(batch.fetchedCount) || !isCount(batch.newMessagesAnalyzed) ||
    batch.newMessagesAnalyzed > batch.fetchedCount ||
    !isCount(batch.grenadesTriggered) || batch.grenadesTriggered > batch.newMessagesAnalyzed
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
