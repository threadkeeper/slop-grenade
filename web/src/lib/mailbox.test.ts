import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMailbox, type MailboxState } from './mailbox';

const account = {
  id: 'local-account', label: 'Test mailbox', connected: true,
  lastSuccessfulScan: '2026-10-24T06:00:00Z', reconnectRequired: false
};
const status = { accounts: [account], backgroundStatus: 'Ready', overlayGranted: false };
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });
const controllers: ReturnType<typeof createMailbox>[] = [];
let host: EventTarget;
let documentHost: EventTarget & { visibilityState: string };
function setup(fetcher: typeof fetch) {
  let state: MailboxState;
  const controller = createMailbox((value) => { state = value; }, fetcher);
  controllers.push(controller);
  return { controller, state: () => state! };
}

beforeEach(() => {
  vi.useFakeTimers();
  host = new EventTarget();
  documentHost = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', host);
  vi.stubGlobal('document', documentHost);
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native mailbox controller', () => {
  it('notifies the dashboard after successful add, reconnect and disconnect, not on failure', async () => {
    const changed = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) =>
      path === '/api/v1/accounts' ? json(status) : json({ ok: true }));
    const controller = createMailbox(vi.fn(), fetcher, changed);
    controllers.push(controller);
    await controller.add();
    await controller.reconnect('local-account');
    await controller.disconnect('local-account');
    expect(changed).toHaveBeenCalledTimes(3);
    fetcher.mockResolvedValueOnce(json({}, 503));
    await controller.add();
    expect(changed).toHaveBeenCalledTimes(3);
  });
  it('loads account connection, reconnect, last scan, background and overlay status', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(status));
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    expect(state()).toMatchObject({ ...status, error: null, busy: false });
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/accounts');
  });

  it('supports repeated Add Gmail account and refreshes only after native OAuth completion', async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === '/api/v1/accounts/add') return new Promise((resolve) => { finish = resolve; });
      return json(status);
    });
    const { controller, state } = setup(fetcher);
    const first = controller.add();
    expect(state().busy).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(new Response(null, { status: 204 }));
    await first;
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/accounts');
    expect(state().busy).toBe(false);
    const second = controller.add();
    finish(json({ ok: true }));
    await second;
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/v1/accounts/add')).toHaveLength(2);
  });

  it('uses the reconnect, disconnect and overlay permission operations without payloads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) =>
      path === '/api/v1/accounts' ? json(status) : json({ ok: true }));
    const { controller } = setup(fetcher);
    await controller.reconnect('id with space');
    await controller.disconnect('local-account');
    await controller.requestOverlay();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method).map(([path, init]) => [path, init?.method, init?.body]))
      .toEqual([
        ['/api/v1/accounts/id%20with%20space/reconnect', 'POST', undefined],
        ['/api/v1/accounts/local-account', 'DELETE', undefined],
        ['/api/v1/overlay/permission', 'POST', undefined]
      ]);
  });

  it('refreshes on returning to the app and stops refresh listeners/timers on cleanup', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(status));
    const { controller } = setup(fetcher);
    host.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    documentHost.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    controller.dispose();
    host.dispatchEvent(new Event('focus'));
    documentHost.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it.each([{}, { ...status, accounts: [{}] }, { ...status, overlayGranted: 'true' }])(
    'rejects malformed account status: %j', async (body) => {
      const { controller, state } = setup(vi.fn<typeof fetch>().mockResolvedValue(json(body)));
      await controller.refresh();
      expect(state().error).toBe('Invalid mailbox response.');
    }
  );

  it('surfaces HTTP and application failures and never reports successful add on an error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ ok: false }));
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    expect(state().error).toContain('HTTP 503');
    await controller.add();
    expect(state().error).toBe('Mailbox operation failed.');
    expect(state().busy).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not publish an in-flight response after disposal', async () => {
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const update = vi.fn();
    const controller = createMailbox(update, fetcher);
    controllers.push(controller);
    const pending = controller.refresh();
    const count = update.mock.calls.length;
    controller.dispose();
    finish(json(status));
    await pending;
    expect(update).toHaveBeenCalledTimes(count);
  });

  it('does not let an older refresh overwrite newer status', async () => {
    const finishes: ((response: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
    const { controller, state } = setup(fetcher);
    const first = controller.refresh();
    const second = controller.refresh();
    finishes[1](json({ ...status, backgroundStatus: 'Latest' }));
    await second;
    finishes[0](json(status));
    await first;
    expect(state().backgroundStatus).toBe('Latest');
  });
});
