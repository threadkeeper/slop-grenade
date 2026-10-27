import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMailbox, GMAIL_READONLY_SCOPE, type GmailStatus, type MailboxState } from './mailbox';

const firstAccount = {
  id: 'synthetic-account-1', label: 'Synthetic Gmail account', connected: true,
  reconnectRequired: false, lastSuccessfulScan: '2026-10-24T06:00:00Z'
};
const scanResult = {
  fetchedCount: 4, newMessagesAnalyzed: 2, animationsTriggered: 1,
  successfulAccounts: 1, failedAccounts: 0, errors: []
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const controllers: ReturnType<typeof createMailbox>[] = [];
const streams: StatusSource[] = [];
class StatusSource extends EventTarget {
  close = vi.fn();
  constructor(public url: string) { super(); streams.push(this); }
}
let host: EventTarget & { open: ReturnType<typeof vi.fn> };
let documentHost: EventTarget & { visibilityState: string };
let popup: { closed: boolean; opener: unknown; location: { replace: ReturnType<typeof vi.fn> }; close: ReturnType<typeof vi.fn> };
let status: GmailStatus;
function consent(overrides: Record<string, unknown> = {}) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
  url.searchParams.set('state', 'synthetic-state');
  return {
    authorizationUrl: url.href,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    ...overrides
  };
}
function setup(fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(status))) {
  let state: MailboxState;
  const changed = vi.fn();
  const controller = createMailbox((next) => { state = next; }, fetcher, changed, false);
  controllers.push(controller);
  return { controller, fetcher, changed, state: () => state! };
}
async function settled() { await vi.advanceTimersByTimeAsync(0); }
function notify(data: unknown, type = 'gmail-status') {
  streams[0].dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T18:00:00Z'));
  status = { enabled: true, configured: true, accounts: [firstAccount] };
  popup = { closed: false, opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
  host = Object.assign(new EventTarget(), { open: vi.fn().mockReturnValue(popup) });
  documentHost = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', host);
  vi.stubGlobal('document', documentHost);
  vi.stubGlobal('EventSource', StatusSource);
});
afterEach(() => {
  controllers.splice(0).forEach((item) => item.dispose());
  streams.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('desktop Gmail mailbox', () => {
  it('clears communication state from the HTTP wipe acknowledgement before a slow account refresh', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(status))
      .mockResolvedValueOnce(json({
        ok: true, dataWiped: true, resetGeneration: 7, message: 'All communication data wiped.'
      }))
      .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const wiped = vi.fn();
    const controller = createMailbox(vi.fn(), fetcher, vi.fn(), false, wiped);
    controllers.push(controller);
    await controller.refresh();
    const disconnect = controller.disconnect(firstAccount.id);
    await settled();
    expect(wiped).toHaveBeenCalledExactlyOnceWith(7);
    finish(json({ ...status, accounts: [] }));
    await disconnect;
  });

  it('loads multiple accounts, preserving only display metadata and sanitizing transient errors', async () => {
    status.accounts = [firstAccount, {
      ...firstAccount, id: 'synthetic-account-2', label: 'Second synthetic mailbox',
      connected: false, reconnectRequired: true, lastSuccessfulScan: null,
      error: 'unsafe remote response with synthetic-secret'
    }];
    const { controller, state, fetcher } = setup();
    await controller.refresh();
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/gmail/accounts');
    expect(state()).toMatchObject({ enabled: true, configured: true, loading: false });
    expect(state().accounts).toHaveLength(2);
    expect(state().accounts[1]).toMatchObject({ connected: false, reconnectRequired: true });
    expect(state().accounts[1].error).toContain('Try Scan now or Reconnect');
    expect(JSON.stringify(state())).not.toContain('synthetic-secret');
  });

  it.each([
    {}, { enabled: true, configured: 'true', accounts: [] },
    { enabled: true, configured: true, accounts: [{}] },
    { enabled: true, configured: true, accounts: [firstAccount, firstAccount] },
    { enabled: true, configured: true, accounts: [], authorizationPending: 'true' }
  ])('rejects malformed status without exposing the response: %j', async (value) => {
    const { controller, state } = setup(vi.fn<typeof fetch>().mockResolvedValue(json(value)));
    await controller.refresh();
    expect(state().error).toContain('Gmail status unavailable');
    expect(state().loading).toBe(false);
    expect(state().enabled).toBe(false);
  });

  it.each([{ enabled: false, configured: true }, { enabled: true, configured: false }])(
    'does not authorize when Gmail is disabled or not configured: %j', async (flags) => {
      Object.assign(status, flags);
      const { controller, fetcher } = setup();
      await controller.add();
      await controller.refresh();
      await controller.add();
      await controller.reconnect(firstAccount.id);
      await controller.disconnect(firstAccount.id);
      await controller.scan();
      expect(host.open).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('opens a detached blank popup synchronously before posting, then navigates only to Google', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (!init?.method) return json(status);
      expect(host.open).toHaveBeenCalledWith('about:blank', '_blank');
      expect(popup.opener).toBeNull();
      return new Promise((resolve) => { finish = resolve; });
    });
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    const pending = controller.add();
    expect(host.open).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ busy: true, operation: 'authorize', authorizationPending: true });
    await controller.add();
    await controller.reconnect(firstAccount.id);
    await controller.disconnect(firstAccount.id);
    await controller.scan();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const value = consent();
    finish(json(value));
    await pending;
    expect(fetcher.mock.calls[1]).toMatchObject(['/api/v1/gmail/authorize', { method: 'POST' }]);
    expect(popup.location.replace).toHaveBeenCalledWith(value.authorizationUrl);
    expect(state()).toMatchObject({ busy: false, operation: null, authorizationPending: true, authorizationExpiresAt: value.expiresAt });
    await controller.add();
    expect(host.open).toHaveBeenCalledTimes(1);
  });

  it('reports blocked popups actionably and never starts server OAuth when blocked', async () => {
    const { controller, state, fetcher } = setup();
    await controller.refresh();
    host.open.mockReturnValue(null);
    await controller.add();
    expect(state().error).toContain('Allow popups for this local dashboard');
    expect(state().authorizationPending).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  const unsafeUrls = [
    'http://accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com.example.invalid/auth',
    'https://accounts.google.com@untrusted.invalid/auth',
    'https://synthetic-user:synthetic-secret@accounts.google.com/auth',
    'https://accounts.google.com:8443/auth',
    'javascript:alert("synthetic-secret")',
    'https://accounts.google.com/auth?scope=https://www.googleapis.com/auth/gmail.modify',
    `https://accounts.google.com/auth?scope=${encodeURIComponent(GMAIL_READONLY_SCOPE)}%20https://www.googleapis.com/auth/gmail.send`,
    `https://accounts.google.com/auth?scope=${encodeURIComponent(GMAIL_READONLY_SCOPE)}&scope=${encodeURIComponent(GMAIL_READONLY_SCOPE)}`
  ];
  it.each(unsafeUrls)('never opens an unsafe consent URL or echoes it: %s', async (url) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method ? json(consent({ authorizationUrl: url })) : json(status));
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    await controller.add();
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
    expect(state().error).toContain('could not open safely');
    expect(state().error).not.toContain(url);
    expect(state().error).not.toContain('synthetic-secret');
  });

  it.each(['invalid', '2026-10-27T17:59:59Z', '2026-10-27T19:00:00Z'])(
    'rejects invalid or unbounded authorization expiry: %s', async (expiresAt) => {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
        init?.method ? json(consent({ expiresAt })) : json(status));
      const { controller, state } = setup(fetcher);
      await controller.refresh();
      await controller.add();
      expect(popup.location.replace).not.toHaveBeenCalled();
      expect(state().error).toContain('could not open safely');
    }
  );

  it('refreshes callback completion through named status SSE and enables connecting another account', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (!init?.method) return json(status);
      status.authorizationPending = true;
      return json(consent());
    });
    const { controller, state, changed } = setup(fetcher);
    await controller.refresh();
    await controller.add();
    expect(streams[0].url).toBe('/api/v1/gmail/events');
    notify({ changed: true });
    await settled();
    expect(state().authorizationPending).toBe(true);
    const before = changed.mock.calls.length;
    status = { ...status, authorizationPending: false, accounts: [
      firstAccount, { ...firstAccount, id: 'synthetic-account-2', label: 'Second synthetic mailbox' }
    ] };
    notify({ changed: true });
    await settled();
    expect(state().accounts).toHaveLength(2);
    expect(state().authorizationPending).toBe(false);
    expect(changed.mock.calls.length).toBeGreaterThan(before);
    await controller.add();
    expect(host.open).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed SSE, default messages and notifications containing account data', async () => {
    const { controller, fetcher } = setup();
    await controller.refresh();
    notify({ changed: true }, 'message');
    notify({ changed: false });
    notify({ changed: true, label: 'Synthetic account' });
    streams[0].dispatchEvent(new MessageEvent('gmail-status', { data: 'invalid' }));
    await settled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('hydrates pending state from the daemon so another dashboard cannot start a second consent', async () => {
    status.authorizationPending = true;
    const { controller, state } = setup();
    await controller.refresh();
    await controller.add();
    expect(state().authorizationPending).toBe(true);
    expect(host.open).not.toHaveBeenCalled();
    status.authorizationPending = false;
    host.dispatchEvent(new Event('focus'));
    await settled();
    expect(state().authorizationPending).toBe(false);
  });

  it('expires the local pending guard and refreshes status after five minutes', async () => {
    documentHost.visibilityState = 'hidden';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method ? json(consent()) : json(status));
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    await controller.add();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(state().authorizationPending).toBe(false);
    expect(state().notice).toContain('expired');
    await controller.add();
    expect(host.open).toHaveBeenCalledTimes(2);
  });

  it('handles a server-side pending conflict without exposing its raw error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (!init?.method) return json(status);
      status.authorizationPending = true;
      return json({ error: 'synthetic-secret' }, 409);
    });
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    await controller.add();
    expect(state().authorizationPending).toBe(true);
    expect(state().error).toContain('already pending');
    expect(state().error).not.toContain('synthetic-secret');
    expect(popup.close).toHaveBeenCalled();
  });

  it('keeps a conservative pending guard on a lost authorization response and exposes no exception details', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (init?.method) throw new Error('https://unsafe.invalid/?token=synthetic-secret');
      return json(status);
    });
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    await controller.add();
    expect(state().error).not.toContain('synthetic-secret');
    expect(state().error).toContain('wait five minutes');
    expect(state().authorizationPending).toBe(true);
    await controller.add();
    expect(host.open).toHaveBeenCalledTimes(1);
    await controller.refresh();
    expect(state().authorizationPending).toBe(false);
  });

  it('uses desktop reconnect, disconnect and scan routes with no tokens or payloads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (!init?.method) return json(status);
      if (String(path).endsWith('/reconnect')) return json(consent());
      if (init.method === 'DELETE') {
        status.accounts = [];
        return json({
          ok: true,
          dataWiped: true,
          message: 'Signed out of Gmail. All communication data wiped.'
        });
      }
      return json(scanResult);
    });
    const { controller, state, changed } = setup(fetcher);
    await controller.refresh();
    await controller.scan();
    expect(state().notice).toContain('scan complete');
    expect(state().notice).toContain('2 added / 4 fetched');
    expect(state().error).toBeNull();
    await controller.reconnect('id with space');
    expect(popup.location.replace).toHaveBeenCalled();
    await controller.refresh(); // Synthetic callback completion.
    await controller.disconnect('id with space');
    expect(state().accounts).toEqual([]);
    expect(state().notice).toBe('Signed out of Gmail. All communication data wiped.');
    expect(changed).toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method).map(([path, init]) =>
      [path, init?.method, init?.body])).toEqual([
      ['/api/v1/gmail/scan', 'POST', undefined],
      ['/api/v1/gmail/accounts/id%20with%20space/reconnect', 'POST', undefined],
      ['/api/v1/gmail/accounts/id%20with%20space', 'DELETE', undefined]
    ]);
  });

  it('does not scan disconnected or reconnect-required accounts', async () => {
    status.accounts = [{ ...firstAccount, connected: false, reconnectRequired: true }];
    const { controller, fetcher } = setup();
    await controller.refresh();
    await controller.scan();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([1, 0])('reports account failures without discarding successful scan results (%i successful)', async (successfulAccounts) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (!init?.method) return json(status);
      status.accounts = [
        firstAccount, { ...firstAccount, id: 'synthetic-account-2', connected: false, reconnectRequired: true }
      ];
      return json({
        ...scanResult, successfulAccounts, failedAccounts: 1,
        errors: [{ id: 'synthetic-account-2', error: 'unsafe provider response with synthetic-secret' }]
      });
    });
    const { controller, state, changed } = setup(fetcher);
    await controller.refresh();
    changed.mockClear();
    await controller.scan();
    expect(state().notice).toContain('2 added / 4 fetched');
    expect(state().notice).not.toContain('scan complete');
    expect(state().error).toContain('1 account');
    expect(state().accounts[1].reconnectRequired).toBe(true);
    expect(changed).toHaveBeenCalled();
    expect(JSON.stringify(state())).not.toContain('synthetic-secret');
  });

  it.each([
    { fetchedCount: 4, newMessagesAnalyzed: 2 },
    { ...scanResult, fetchedCount: -1 },
    { ...scanResult, animationsTriggered: 1.5 },
    { ...scanResult, successfulAccounts: '1' },
    { ...scanResult, failedAccounts: null },
    { ...scanResult, errors: 'synthetic-secret' },
    { ...scanResult, errors: [{ id: 'synthetic-id' }] }
  ])('does not claim scan success for malformed results: %j', async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method ? json(value) : json(status));
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    await controller.scan();
    expect(state().error).toContain('Gmail scan failed');
    expect(state().notice).toBeNull();
    expect(state().error).not.toContain('synthetic-secret');
  });

  it('does not claim a scan succeeded without a result body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method ? new Response(null, { status: 204 }) : json(status));
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    await controller.scan();
    expect(state().error).toContain('Gmail scan failed');
    expect(state().notice).toBeNull();
  });

  it.each([json({ error: 'synthetic-secret' }, 503), json({ error: 'synthetic-secret' }), json({ ok: false })])(
    'reports failed scans and refreshes reconnect state without claiming success', async (response) => {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
        if (!init?.method) return json(status);
        status.accounts = [{ ...firstAccount, connected: false, reconnectRequired: true }];
        return response;
      });
      const { controller, state } = setup(fetcher);
      await controller.refresh();
      await controller.scan();
      expect(state().error).toContain('Gmail scan failed');
      expect(state().notice).toBeNull();
      expect(state().accounts[0].reconnectRequired).toBe(true);
      expect(state().error).not.toContain('synthetic-secret');
    }
  );

  it('refreshes on focus, visibility, polling and SSE reconnection; disposes every listener and timer', async () => {
    const { controller, fetcher } = setup();
    host.dispatchEvent(new Event('focus'));
    await settled();
    documentHost.dispatchEvent(new Event('visibilitychange'));
    await settled();
    streams[0].dispatchEvent(new Event('open'));
    await settled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    controller.dispose();
    host.dispatchEvent(new Event('focus'));
    notify({ changed: true });
    streams[0].dispatchEvent(new Event('open'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(streams[0].close).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes an in-flight consent without opening Google or publishing after unmount', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method ? new Promise((resolve) => { finish = resolve; }) : json(status));
    const { controller, state } = setup(fetcher);
    await controller.refresh();
    const pending = controller.add();
    const before = state();
    controller.dispose();
    finish(json(consent()));
    await pending;
    expect(state()).toBe(before);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.replace).not.toHaveBeenCalled();
  });

  it('ignores stale status responses and does not persist or log labels or consent URLs', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const storage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const finish: ((response: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      new Promise((resolve) => { finish.push(resolve); }));
    const { controller, state } = setup(fetcher);
    const older = controller.refresh();
    const newer = controller.refresh();
    finish[1](json({ ...status, accounts: [] }));
    await newer;
    finish[0](json(status));
    await older;
    expect(state().accounts).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();
    logs.forEach((log) => expect(log).not.toHaveBeenCalled());
  });

  it('selects the native controller for an injected Android bridge and never opens desktop SSE or OAuth', async () => {
    Object.assign(host, { SlopAndroid: { postMessage: vi.fn(), onmessage: null } });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) =>
      path === '/api/v1/accounts' ? json({
        accounts: [], backgroundStatus: 'Ready', overlayGranted: false,
        overlayActive: false, notificationsGranted: true
      }) : json({ ok: true }));
    const controller = createMailbox(vi.fn(), fetcher);
    controllers.push(controller);
    await controller.add();
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/v1/accounts/add', '/api/v1/accounts']);
    expect(streams).toHaveLength(0);
    expect(host.open).not.toHaveBeenCalled();
  });
});
