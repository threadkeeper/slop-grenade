/** Latest-wins dashboard snapshots, including native quiet background hydration. */
import type { AwarenessScorecard } from './types';
import { isNativeMobile, requestApi } from './transport';
import { ResetBoundary } from './resetBoundary';

function emptyScorecard(resetGeneration: number): AwarenessScorecard {
  const stats = () => ({
    totalMessages: 0, averageSlopScore: 0, humanSparkles: 0, peacefulClouds: 0,
    innocentFruits: 0, slopSplats: 0, slopGrenades: 0, cleanHumanStreak: 0
  });
  return {
    resetGeneration, sentByMe: stats(), receivedByMe: stats(), dailySent: stats(), dailyReceived: stats(),
    topSloppers: [], topPDoomers: [], selfAwarenessVerdict: '', recentReports: []
  };
}

/** Load once on mount; native dashboards also poll independently of animations. */
export function createLedger(
  update: (snapshot: AwarenessScorecard) => void,
  reportError: (error: string | null) => void,
  options: { native?: boolean; fetcher?: typeof fetch; onReset?: () => void } = {}
) {
  const fetcher = options.fetcher ?? requestApi;
  let disposed = false;
  let generation = 0;
  let pending: AbortController | undefined;
  const boundary = new ResetBoundary(() => {
    update(emptyScorecard(boundary.generation));
    reportError(null);
    options.onReset?.();
  });

  const refresh = async (): Promise<boolean> => {
    if (disposed) return false;
    const request = ++generation;
    const epoch = boundary.epoch;
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    try {
      const response = await fetcher('/api/v1/ledger', { signal: controller.signal });
      if (!response.ok) throw new Error(`Dashboard reload failed (HTTP ${response.status}).`);
      const snapshot = await response.json() as AwarenessScorecard;
      if (disposed || request !== generation) return false;
      if (!boundary.snapshot(snapshot.resetGeneration, epoch)) return false;
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
    restart: (confirmed = true) => {
      if (disposed) return;
      if (confirmed) boundary.restart();
      else boundary.reconnect();
      ++generation;
      pending?.abort();
      pending = undefined;
    },
    reset: (resetGeneration?: number) => {
      if (disposed || !boundary.wipe(resetGeneration)) return false;
      ++generation;
      pending?.abort();
      pending = undefined;
      return true;
    },
    acceptsEvent: (resetGeneration?: number) => boundary.event(resetGeneration),
    dispose: () => {
      disposed = true;
      ++generation;
      clearInterval(timer);
      pending?.abort();
    }
  };
}
