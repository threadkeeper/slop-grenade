import { describe, expect, it, vi } from 'vitest';
import { squeegeeOverlay } from './overlayControls';

describe('live overlay controls', () => {
  it.each(['left', 'right'] as const)('sends an explicit %s squeegee command', async (side) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, side, sequence: 4 })));
    await squeegeeOverlay(side, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/squeegee');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ side }) });
  });

  it('surfaces transport and malformed-response failures', async () => {
    await expect(squeegeeOverlay('left', vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', { status: 503 })))).rejects.toThrow('Squeegee unavailable');
    await expect(squeegeeOverlay('left', vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, side: 'right', sequence: 2 }))))).rejects.toThrow('Invalid squeegee response');
  });
});
