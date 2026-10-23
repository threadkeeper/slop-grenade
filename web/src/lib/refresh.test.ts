import { describe, expect, it, vi } from 'vitest';
import { refreshSevenDays } from './refresh';

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
