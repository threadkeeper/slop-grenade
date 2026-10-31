import { requestApi } from './transport';
import type { MonitorSide } from './types';

/** Send a live wipe command, rather than wiping only the test-range preview. */
export async function squeegeeOverlay(
  side: MonitorSide,
  fetcher: typeof fetch = requestApi,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetcher('/api/v1/squeegee', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ side }), signal
  });
  if (!response.ok) throw new Error(`Squeegee unavailable (HTTP ${response.status}).`);
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new Error('Invalid squeegee response.'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      !('ok' in value) || value.ok !== true || !('side' in value) || value.side !== side ||
      !('sequence' in value) || typeof value.sequence !== 'number' ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    throw new Error('Invalid squeegee response.');
  }
}
