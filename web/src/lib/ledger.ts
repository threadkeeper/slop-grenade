/** Latest-wins dashboard snapshots, including native quiet background hydration. */
import type { AwarenessScorecard } from './types';
import { isNativeMobile, requestApi } from './transport';

/** Load once on mount; native dashboards also poll independently of animations. */
export function createLedger(
  update: (snapshot: AwarenessScorecard) => void,
  reportError: (error: string | null) => void,
  options: { native?: boolean; fetcher?: typeof fetch } = {}
) {
  const fetcher = options.fetcher ?? requestApi;
  let disposed = false;
  let generation = 0;
  let pending: AbortController | undefined;

  const refresh = async (): Promise<boolean> => {
    if (disposed) return false;
    const request = ++generation;
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    try {
      const response = await fetcher('/api/v1/ledger', { signal: controller.signal });
      if (!response.ok) throw new Error(`Dashboard reload failed (HTTP ${response.status}).`);
      const snapshot = await response.json() as AwarenessScorecard;
      if (disposed || request !== generation) return false;
      // Never clear historical data while an account operation or reload is pending.
      update(snapshot);
      reportError(null);
      return true;
    } catch (error) {
      if (!disposed && request === generation) {
        reportError(error instanceof Error ? error.message : 'Cannot reach the local daemon.');
      }
      return false;
    } finally {
      if (request === generation) pending = undefined;
    }
  };

  void refresh();
  const timer = (options.native ?? isNativeMobile()) ? setInterval(() => {
    // Slow background requests must not overlap or continually abort each other.
    if (!pending) void refresh();
  }, 5000) : undefined;

  return {
    refresh,
    dispose: () => {
      disposed = true;
      ++generation;
      clearInterval(timer);
      pending?.abort();
    }
  };
}
