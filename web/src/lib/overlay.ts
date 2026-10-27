import { ResetBoundary } from './resetBoundary';
import { requestApi, subscribeAnimations } from './transport';
import type { AnimationEvent, AwarenessScorecard, SlopReport } from './types';
import type { Stage } from './engine';

/** Shared by browser overlays and the macOS WKWebView. */
export function connectOverlay(
  stage: Stage,
  sourceEnabled: (report: SlopReport) => boolean,
  fetcher: typeof fetch = requestApi,
  subscribe: (receive: (event: AnimationEvent) => void, onSession?: (restarted: boolean) => void) => () => void = subscribeAnimations
) {
  const seenIds = new Set<string>();
  const boundary = new ResetBoundary(() => {
    seenIds.clear();
    stage.reset();
  });
  let stopped = false;
  const abort = new AbortController();
  const refresh = () => {
    const epoch = boundary.epoch;
    return fetcher('/api/v1/ledger', { signal: abort.signal })
      .then((res) => res.ok ? res.json() as Promise<AwarenessScorecard> : null)
      .then((card) => {
        if (stopped || !card || !boundary.snapshot(card.resetGeneration, epoch)) return;
        for (const pass of [0, 1]) {
          const reports = card.recentReports ?? [];
          for (let i = reports.length - 1; i >= 0; i--) {
            const r = reports[i];
            const splat = r.tier === 'slop_grenade' || r.tier === 'slop_splat';
            if (!sourceEnabled(r) || (!splat && r.tier !== 'innocent_fruit') ||
                (pass === 0) !== splat || seenIds.has(r.messageId)) continue;
            seenIds.add(r.messageId);
            stage.world.trigger(r.tier, r.monitorSide);
          }
        }
      }).catch(() => {});
  };
  const initial = refresh();
  const stopEvents = subscribe((event) => {
    if (stopped) return;
    if (event.dataWiped) {
      if (boundary.wipe(event.resetGeneration)) void refresh();
    } else if (boundary.event(event.resetGeneration)) {
      if (event.squeegeeSide) stage.world.squeegee(event.squeegeeSide);
      else if (sourceEnabled(event.report) && !seenIds.has(event.report.messageId)) {
        seenIds.add(event.report.messageId);
        stage.world.trigger(event.report.tier, event.report.monitorSide);
      }
    }
  }, (restarted) => {
    if (stopped) return;
    if (restarted) boundary.restart();
    else boundary.reconnect();
    void refresh();
  });
  return {
    initial,
    dispose() {
      stopped = true;
      abort.abort();
      stopEvents();
    }
  };
}
