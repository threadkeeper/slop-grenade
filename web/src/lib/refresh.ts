import { requestApi } from './transport';

/** Counts returned after merging a seven-day history refresh. */
export interface RefreshSummary {
  fetchedCount: number;
  newMessagesAnalyzed: number;
  grenadesTriggered: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Refresh the last seven days locally, surfacing HTTP and application failures. */
export async function refreshSevenDays(fetcher: typeof fetch = requestApi): Promise<RefreshSummary> {
  const response = await fetcher('/api/v1/scan/now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookbackDays: 7, useLuna: false })
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
  if (!isRecord(payload) || payload.ok !== true || payload.lookbackDays !== 7 || !isRecord(payload.batch)) {
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
