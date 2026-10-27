import { describe, expect, it, vi } from 'vitest';
import { createM365, type M365State } from './m365';

const workiq = {
  binaryFound: true, binaryPath: 'workiq', version: '1.0', mcpReady: true,
  authenticated: true, mcpToolCount: 4, account: null, message: 'Ready'
};
const status = { adminAppRequired: false, workiq, githubLuna: {} };
const response = (body: unknown, ok = true) => ({
  ok, json: async () => body
}) as Response;

describe('Microsoft 365 account controller', () => {
  it('loads status and uses explicit WorkIQ sign-in and sign-out routes', async () => {
    const states: M365State[] = [];
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response({ ok: true, message: 'signed in', status }))
      .mockResolvedValueOnce(response({
        ok: true, message: 'signed out', dataWiped: true, resetGeneration: 7,
        status: { ...status, workiq: { ...workiq, authenticated: false } }
      }));
    const wiped = vi.fn();
    const controller = createM365((state) => states.push(state), fetcher, wiped);

    await controller.refresh();
    await controller.signIn();
    await controller.signOut();

    expect(fetcher.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([
      ['/api/v1/auth/status', 'GET'],
      ['/api/v1/auth/workiq-login', 'POST'],
      ['/api/v1/auth/workiq-logout', 'POST']
    ]);
    expect(wiped).toHaveBeenCalledOnce();
    expect(wiped).toHaveBeenCalledWith(7);
    expect(states.at(-1)?.status?.authenticated).toBe(false);
    expect(states.at(-1)?.notice).toBe('Signed out of Microsoft 365. All communication data wiped.');
  });

  it('fails closed for malformed status and sanitized operation failures', async () => {
    let current: M365State | undefined;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ workiq: { authenticated: 'yes' } }))
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response({
        error: 'private provider output', dataWiped: true
      }, false));
    const controller = createM365((state) => { current = state; }, fetcher);

    await controller.refresh();
    expect(current?.error).toContain('status unavailable');
    await controller.refresh();
    await controller.signOut();
    expect(current?.notice).toBe('Communication data wiped.');
    expect(current?.error).toBe('Microsoft 365 sign-out failed. Try again or run workiq logout locally.');
    expect(JSON.stringify(current)).not.toContain('private provider output');
  });
});
