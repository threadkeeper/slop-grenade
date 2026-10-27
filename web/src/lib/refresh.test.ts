import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRefreshProgress, formatRefreshCount, MAX_REFRESH_DAYS,
  refreshDaysForSpan, refreshHistory, refreshSevenDays
} from './refresh';

describe('seven-day history refresh', () => {
  it('requests exactly seven days with local scoring and returns the batch counts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        lookbackDays: 7,
        batch: { fetchedCount: 420, newMessagesAnalyzed: 365, grenadesTriggered: 12 }
      }))
    );

    await expect(refreshSevenDays(fetcher)).resolves.toEqual({
      fetchedCount: 420, newMessagesAnalyzed: 365, grenadesTriggered: 12
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('/api/v1/scan/now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookbackDays: 7, useLuna: false })
    });
  });

  it('accepts a genuinely empty successful scan', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true, lookbackDays: 7, batch: { fetchedCount: 0, newMessagesAnalyzed: 0, grenadesTriggered: 0 }
      }))
    );
    await expect(refreshSevenDays(fetcher)).resolves.toEqual({
      fetchedCount: 0, newMessagesAnalyzed: 0, grenadesTriggered: 0
    });
  });

  it('surfaces an application failure even when HTTP status is 200', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'WorkIQ needs sign-in.' }))
    );
    await expect(refreshSevenDays(fetcher)).rejects.toThrow('WorkIQ needs sign-in.');
  });

  it('reports HTTP failures even when the error body is not JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('Unavailable', { status: 502 })
    );
    await expect(refreshSevenDays(fetcher)).rejects.toThrow('HTTP 502');
  });

  it.each([
    {},
    { ok: false, error: '' },
    { ok: true },
    { ok: true, batch: { fetchedCount: 1, newMessagesAnalyzed: 1, grenadesTriggered: 0 } },
    { ok: true, lookbackDays: 1, batch: { fetchedCount: 1, newMessagesAnalyzed: 1, grenadesTriggered: 0 } },
    { ok: true, lookbackDays: 7, batch: { fetchedCount: -1, newMessagesAnalyzed: 0, grenadesTriggered: 0 } },
    { ok: true, lookbackDays: 7, batch: { fetchedCount: 1, newMessagesAnalyzed: 2, grenadesTriggered: 0 } },
    { ok: true, lookbackDays: 7, batch: { fetchedCount: 1, newMessagesAnalyzed: 1, grenadesTriggered: 2 } },
    { ok: true, lookbackDays: 7, batch: { fetchedCount: '420', newMessagesAnalyzed: 1, grenadesTriggered: 0 } }
  ])('rejects an invalid response instead of reporting success: %j', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(refreshSevenDays(fetcher)).rejects.toThrow('Invalid refresh response');
  });

  it('propagates a network failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network unavailable'));
    await expect(refreshSevenDays(fetcher)).rejects.toThrow('Network unavailable');
  });
});

describe('span-based history refresh', () => {
  it('maps the three dashboard spans to one, three or seven days', () => {
    expect(refreshDaysForSpan('today')).toBe(1);
    expect(refreshDaysForSpan('3d')).toBe(3);
    expect(refreshDaysForSpan('7d')).toBe(7);
    expect(MAX_REFRESH_DAYS).toBe(30);
  });

  it('keeps the Android app on its seven-day window', () => {
    for (const span of ['today', '3d', '7d'] as const) {
      expect(refreshDaysForSpan(span, true)).toBe(7);
    }
  });

  it.each([1, 3, 7, 30])('requests %i days with local scoring', async (days) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true, lookbackDays: days, batch: { fetchedCount: 9, newMessagesAnalyzed: 4, grenadesTriggered: 1 }
      }))
    );
    await expect(refreshHistory(days, fetcher)).resolves.toEqual({
      fetchedCount: 9, newMessagesAnalyzed: 4, grenadesTriggered: 1
    });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/scan/now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookbackDays: days, useLuna: false })
    });
  });

  describe('live history refresh progress', () => {
    let dispose: (() => void) | undefined;
    afterEach(() => {
      dispose?.();
      dispose = undefined;
      vi.useRealTimers();
    });

    const snapshot = (overrides: Record<string, unknown> = {}) => ({
      refreshId: 'fixture-refresh', lookbackDays: 7, phase: 'outlook',
      outlookScanned: 345, outlookTotal: 982, teamsScanned: 0, teamsTotal: null,
      teamsChatsDiscovered: 0, teamsChatsScanned: 0, teamsChatsTotal: null,
      analyzedCount: 0, analysisTotal: null, ...overrides
    });
    const response = (progress: unknown) => new Response(JSON.stringify({ progress }));
    const watch = (fetcher: typeof fetch) => {
      const update = vi.fn();
      const reportError = vi.fn();
      const controller = createRefreshProgress('fixture-refresh', 7, update, reportError, fetcher);
      dispose = controller.dispose;
      return { controller, update, reportError };
    };

    it('correlates the enhanced desktop refresh without changing legacy or Android requests', async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        ok: true, lookbackDays: 7, batch: { fetchedCount: 0, newMessagesAnalyzed: 0, grenadesTriggered: 0 }
      })));
      await refreshHistory(7, fetcher, 'fixture-refresh');
      expect(fetcher).toHaveBeenCalledWith('/api/v1/scan/now', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 7, useLuna: false, refreshId: 'fixture-refresh' })
      });
    });

    it.each(['', 'x'.repeat(65), 'private@example.invalid'])('rejects invalid correlation IDs before fetching: %s', async (id) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(refreshHistory(7, fetcher, id)).rejects.toThrow('refresh ID');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('formats reliable and unknown totals without inventing a denominator', () => {
      expect(formatRefreshCount(345, 982)).toBe('345 / 982 scanned');
      expect(formatRefreshCount(345, null)).toBe('345 scanned \u00b7 discovering total');
      expect(formatRefreshCount(0, 0)).toBe('0 / 0 scanned');
    });

    it.each<[number, number | null]>([[-1, null], [2, 1], [1.5, null], [1, Number.NaN]])('rejects invalid counter values: %s / %s', (scanned, total) => {
      expect(() => formatRefreshCount(scanned, total)).toThrow('Invalid refresh count');
    });

    it('shows both providers while pending and stops automatically on completion', async () => {
      vi.useFakeTimers();
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(response(snapshot()))
        .mockResolvedValueOnce(response(snapshot({
          phase: 'teams', teamsScanned: 78, teamsChatsDiscovered: 3, teamsChatsScanned: 1, teamsChatsTotal: 3
        })))
        .mockResolvedValueOnce(response(snapshot({
          phase: 'completed', outlookScanned: 982, teamsScanned: 83, teamsTotal: 83,
          teamsChatsDiscovered: 3, teamsChatsScanned: 3, teamsChatsTotal: 3,
          analyzedCount: 20, analysisTotal: 20
        })));
      const { update, reportError } = watch(fetcher);
      await vi.advanceTimersByTimeAsync(0);
      expect(update).toHaveBeenLastCalledWith(snapshot());
      expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/scan/progress?refreshId=fixture-refresh');
      expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(update.mock.lastCall?.[0]).toMatchObject({ teamsScanned: 78, teamsTotal: null });
      await vi.advanceTimersByTimeAsync(10000);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(update.mock.lastCall?.[0].phase).toBe('completed');
      expect(reportError).toHaveBeenLastCalledWith(null);
    });

    it('waits for its own job to start and stops on a failed job', async () => {
      vi.useFakeTimers();
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(response(null))
        .mockResolvedValueOnce(response(snapshot({ phase: 'failed' })));
      const { update } = watch(fetcher);
      await vi.advanceTimersByTimeAsync(0);
      expect(update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10000);
      expect(update).toHaveBeenCalledOnce();
      expect(update.mock.lastCall?.[0].phase).toBe('failed');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('surfaces a temporary progress failure and recovers without failing the refresh', async () => {
      vi.useFakeTimers();
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
        .mockResolvedValueOnce(response(snapshot()));
      const { update, reportError } = watch(fetcher);
      await vi.advanceTimersByTimeAsync(0);
      expect(reportError).toHaveBeenLastCalledWith('Refresh progress failed (HTTP 503).');
      expect(update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(update).toHaveBeenCalledWith(snapshot());
      expect(reportError).toHaveBeenLastCalledWith(null);
    });

    it.each([
      {},
      { progress: [] },
      { progress: snapshot({ refreshId: 'another-job' }) },
      { progress: snapshot({ lookbackDays: 3 }) },
      { progress: snapshot({ phase: 'unknown' }) },
      { progress: snapshot({ outlookScanned: -1 }) },
      { progress: snapshot({ outlookTotal: 1 }) },
      { progress: snapshot({ teamsScanned: 1.5 }) },
      { progress: snapshot({ teamsChatsTotal: '20' }) },
      { progress: snapshot({ analyzedCount: 3, analysisTotal: 2 }) },
      { progress: snapshot({ phase: 'analyzing' }) },
      { progress: snapshot({ phase: 'completed' }) }
    ])('rejects stale or invalid progress rather than rendering it: %j', async (payload) => {
      vi.useFakeTimers();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
      const { update, reportError } = watch(fetcher);
      await vi.advanceTimersByTimeAsync(0);
      expect(update).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenLastCalledWith('Invalid refresh progress response.');
    });

    it('never overlaps slow progress requests', async () => {
      vi.useFakeTimers();
      let release: (response: Response) => void = () => { throw new Error('The fixture request has not started.'); };
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
      const { controller } = watch(fetcher);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetcher).toHaveBeenCalledOnce();
      release(response(snapshot()));
      await vi.advanceTimersByTimeAsync(999);
      expect(fetcher).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      controller.dispose();
      release(response(snapshot()));
      await vi.advanceTimersByTimeAsync(0);
    });

    it('aborts on disposal and ignores late replies and errors', async () => {
      vi.useFakeTimers();
      let release: (response: Response) => void = () => { throw new Error('The fixture request has not started.'); };
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
      const { controller, update, reportError } = watch(fetcher);
      const signal = fetcher.mock.calls[0]?.[1]?.signal;
      expect(signal?.aborted).toBe(false);
      controller.dispose();
      expect(signal?.aborted).toBe(true);
      release(response(snapshot()));
      await vi.advanceTimersByTimeAsync(5000);
      expect(update).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledOnce();
    });
  });

  it.each([0, 31, 2.5, Number.NaN])('rejects a %s-day window without calling the server', async (days) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(refreshHistory(days, fetcher)).rejects.toThrow('1 to 30 days');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a response for a different window', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true, lookbackDays: 7, batch: { fetchedCount: 1, newMessagesAnalyzed: 1, grenadesTriggered: 0 }
      }))
    );
    await expect(refreshHistory(30, fetcher)).rejects.toThrow('Invalid refresh response');
  });
});
