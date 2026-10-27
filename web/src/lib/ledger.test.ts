import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLedger } from './ledger';
import { createMailbox } from './mailbox';
import type { AwarenessScorecard } from './types';

const stats = (count = 0) => ({
  totalMessages: count, averageSlopScore: 0, humanSparkles: count,
  peacefulClouds: 0, innocentFruits: 0, slopSplats: 0, slopGrenades: 0, cleanHumanStreak: count
});
const snapshot = (count: number): AwarenessScorecard => ({
  recentReports: [], sentByMe: stats(count), receivedByMe: stats(),
  dailySent: stats(count), dailyReceived: stats(), topSloppers: [], topPDoomers: [],
  selfAwarenessVerdict: ''
});
const response = (count: number) => new Response(JSON.stringify(snapshot(count)));
const controllers: ReturnType<typeof createLedger>[] = [];
function setup(native: boolean, fetcher: typeof fetch) {
  const update = vi.fn();
  const error = vi.fn();
  const controller = createLedger(update, error, { native, fetcher });
  controllers.push(controller);
  return { controller, update, error };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('dashboard ledger snapshots', () => {
  it('resets the process-local generation on reconnect, so a restarted daemon can repopulate at zero', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot(4), resetGeneration: 7 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot(2), resetGeneration: 0 })));
    const { controller, update } = setup(false, fetcher);
    await vi.advanceTimersByTimeAsync(0);
    controller.restart();
    expect(update.mock.lastCall?.[0].sentByMe.totalMessages).toBe(0);
    await expect(controller.refresh()).resolves.toBe(true);
    expect(update).toHaveBeenLastCalledWith({ ...snapshot(2), resetGeneration: 0 });
    expect(controller.acceptsEvent(0)).toBe(true);
  });

  it('does not clear existing metrics merely because SSE reconnects to the same generation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ ...snapshot(4), resetGeneration: 7 })));
    const { controller, update } = setup(false, fetcher);
    await vi.advanceTimersByTimeAsync(0);
    const count = update.mock.calls.length;
    controller.restart(false);
    expect(update).toHaveBeenCalledTimes(count);
    await expect(controller.refresh()).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(count + 1);
    expect(controller.reset(7)).toBe(false);
  });

  it('clears immediately and rejects delayed pre-wipe HTTP snapshots even without generation metadata', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish = resolve; }));
    const { controller, update, error } = setup(false, fetcher);
    controller.reset();
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.lastCall?.[0].sentByMe.totalMessages).toBe(0);
    finish(response(99));
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledOnce();
    expect(error).toHaveBeenLastCalledWith(null);
  });

  it('reconciles a missed wipe via the snapshot generation and rejects older post-wipe responses', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(9))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot(2), resetGeneration: 4 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot(99), resetGeneration: 3 })))
      .mockResolvedValueOnce(response(99));
    const onReset = vi.fn();
    const update = vi.fn();
    const controller = createLedger(update, vi.fn(), { native: false, fetcher, onReset });
    controllers.push(controller);
    await vi.advanceTimersByTimeAsync(0);
    await expect(controller.refresh()).resolves.toBe(true);
    expect(onReset).toHaveBeenCalledOnce();
    expect(update.mock.calls.at(-2)?.[0].recentReports).toEqual([]);
    expect(update).toHaveBeenLastCalledWith({ ...snapshot(2), resetGeneration: 4 });
    await expect(controller.refresh()).resolves.toBe(false);
    await expect(controller.refresh()).resolves.toBe(false);
    expect(update).toHaveBeenLastCalledWith({ ...snapshot(2), resetGeneration: 4 });
    expect(controller.reset(4)).toBe(false);
  });

  it('reloads native quiet background hydration without any animation events', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(0)).mockResolvedValueOnce(response(7));
    const { update } = setup(true, fetcher);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenLastCalledWith(snapshot(0));
    await vi.advanceTimersByTimeAsync(5000);
    expect(update).toHaveBeenLastCalledWith(snapshot(7));
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/v1/ledger', '/api/v1/ledger']);
  });

  it('keeps desktop refresh animation/manual driven, with no polling', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(1));
    setup(false, fetcher);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 503])('prevents stale in-flight snapshots and errors from overwriting a newer reload (HTTP %s)', async (status) => {
    const finishes: ((response: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    const { controller, update, error } = setup(true, fetcher);
    const fresh = controller.refresh();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finishes[1](response(8));
    await fresh;
    finishes[0](status === 200 ? response(0) : new Response(null, { status }));
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledExactlyOnceWith(snapshot(8));
    expect(error).toHaveBeenLastCalledWith(null);
  });

  it('reloads after account operations and shows an empty ledger after disconnect wipes data', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    let count = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (path === '/api/v1/ledger') return response(count);
      if (path === '/api/v1/accounts') return new Response(JSON.stringify({
        accounts: [], backgroundStatus: 'Ready', overlayGranted: true
      }));
      if (init?.method === 'DELETE') {
        count = 0;
        return new Response(JSON.stringify({
          ok: true,
          dataWiped: true,
          message: 'Signed out of Gmail. All communication data wiped.'
        }));
      }
      return new Response(null, { status: 204 });
    });
    const { controller, update } = setup(true, fetcher);
    const mailbox = createMailbox(vi.fn(), fetcher, () => { void controller.refresh(); }, true);
    try {
      await vi.advanceTimersByTimeAsync(0);
      await mailbox.add();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher.mock.calls.filter(([path]) => path === '/api/v1/ledger')).toHaveLength(2);
      expect(update).toHaveBeenLastCalledWith(snapshot(0));
      // The native responder completed OAuth, but its quiet background scan
      // finishes later, with no animation event to drive the dashboard.
      count = 7;
      await vi.advanceTimersByTimeAsync(5000);
      expect(update).toHaveBeenLastCalledWith(snapshot(7));
      await mailbox.disconnect('local-account');
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher.mock.calls.filter(([path]) => path === '/api/v1/ledger')).toHaveLength(4);
      expect(update).toHaveBeenLastCalledWith(snapshot(0));
    } finally {
      mailbox.dispose();
    }
  });

  it('retains historical stats until a fresh disconnect snapshot arrives, including on failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(9))
      .mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(response(9));
    const { controller, update, error } = setup(true, fetcher);
    await vi.advanceTimersByTimeAsync(0);
    await expect(controller.refresh()).resolves.toBe(false);
    expect(update).toHaveBeenCalledExactlyOnceWith(snapshot(9));
    expect(error).toHaveBeenLastCalledWith('Dashboard reload failed (HTTP 503).');
    await expect(controller.refresh()).resolves.toBe(true);
    expect(update).toHaveBeenLastCalledWith(snapshot(9));
  });

  it('does not overlap background polls and cancels timers/in-flight work on cleanup', async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { controller, update } = setup(true, fetcher);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetcher).toHaveBeenCalledOnce();
    controller.dispose();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish(response(10));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(update).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
