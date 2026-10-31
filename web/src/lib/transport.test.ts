import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeMobile, requestApi, subscribeAnimations } from './transport';
import { refreshSevenDays } from './refresh';

class TestWindow extends EventTarget {
  SlopAndroid = {
    postMessage: vi.fn<(data: string) => void>(),
    onmessage: null as ((event: { data: string }) => void) | null
  };
}

let host: TestWindow;
function sent(index = 0) {
  return JSON.parse(host.SlopAndroid.postMessage.mock.calls[index][0]);
}
function reply(id: string, body: unknown, status = 200) {
  host.SlopAndroid.onmessage?.({ data: JSON.stringify({ id, status, body }) });
}
const event = (sequence: number) => ({
  sequence, report: { tier: 'human_sparkle', monitorSide: 'left' }
});

beforeEach(() => {
  vi.useFakeTimers();
  host = new TestWindow();
  vi.stubGlobal('window', host);
});
afterEach(() => {
  host.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local API transport', () => {
  it.each([
    ['GET', '/api/v1/gmail/accounts'],
    ['POST', '/api/v1/gmail/authorize'],
    ['POST', '/api/v1/gmail/accounts/synthetic-id/reconnect'],
    ['DELETE', '/api/v1/gmail/accounts/synthetic-id'],
    ['POST', '/api/v1/gmail/scan'],
    ['GET', '/api/v1/gmail/events'],
    ['GET', '/api/v1/auth/google/callback']
  ])('never exposes desktop Gmail OAuth routes through Android: %s %s', async (method, path) => {
    await expect(requestApi(path, { method })).rejects.toThrow('Unsupported native API operation');
    expect(host.SlopAndroid.postMessage).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/overlay/permission', '/api/v1/overlay/stop'])(
    'forwards explicit overlay lifecycle operations without payloads: %s', async (path) => {
      const pending = requestApi(path, { method: 'POST' });
      expect(sent()).toMatchObject({ method: 'POST', path, body: null });
      reply(sent().id, { ok: true });
      expect((await pending).ok).toBe(true);
    }
  );

  it('correlates concurrent, out-of-order replies and preserves HTTP errors as Responses', async () => {
    const first = requestApi('/api/v1/ledger');
    const second = requestApi('/api/v1/accounts');
    expect(isNativeMobile()).toBe(true);
    expect(sent()).toEqual({ id: expect.any(String), method: 'GET', path: '/api/v1/ledger', body: null });
    reply(sent(1).id, { error: 'Unavailable' }, 503);
    reply(sent().id, { recentReports: [] });
    expect((await second).status).toBe(503);
    expect((await second).ok).toBe(false);
    expect(await (await first).json()).toEqual({ recentReports: [] });
  });

  it('sends parsed JSON, not a double-encoded body, and supports empty responses', async () => {
    const pending = requestApi('/api/v1/scan/now', {
      method: 'POST', body: JSON.stringify({ lookbackDays: 7, useLuna: false })
    });
    expect(sent().body).toEqual({ lookbackDays: 7, useLuna: false });
    reply(sent().id, null, 204);
    expect((await pending).status).toBe(204);
  });

  it('uses the shared native transport for the existing seven-day refresh envelope', async () => {
    const pending = refreshSevenDays();
    expect(sent()).toMatchObject({
      method: 'POST', path: '/api/v1/scan/now', body: { lookbackDays: 7, useLuna: false }
    });
    reply(sent().id, {
      ok: true, lookbackDays: 7,
      batch: { fetchedCount: 8, newMessagesAnalyzed: 3, grenadesTriggered: 1 }
    });
    await expect(pending).resolves.toEqual({ fetchedCount: 8, newMessagesAnalyzed: 3, grenadesTriggered: 1 });
  });

  it('forwards only bounded account-scoped IDs for transient Gmail details', async () => {
    const messageId = `${'a'.repeat(64)}:message-1`;
    const pending = requestApi('/api/v1/gmail/details', {
      method: 'POST', body: JSON.stringify({ messageIds: [messageId] })
    });
    expect(sent()).toMatchObject({ method: 'POST', path: '/api/v1/gmail/details', body: { messageIds: [messageId] } });
    reply(sent().id, { entries: [] });
    expect((await pending).ok).toBe(true);
  });

  it.each([
    { messageIds: [] },
    { messageIds: ['manual-1'] },
    { messageIds: [`${'a'.repeat(64)}:../message`] },
    { messageIds: Array.from({ length: 11 }, (_, i) => `${'a'.repeat(64)}:id-${i}`) },
    { messageIds: [`${'a'.repeat(64)}:id`, `${'a'.repeat(64)}:id`] },
    { messageIds: [`${'a'.repeat(64)}:id`], token: 'synthetic-token' }
  ])('rejects invalid Gmail detail requests before the bridge', async (body) => {
    await expect(requestApi('/api/v1/gmail/details', { method: 'POST', body: JSON.stringify(body) })).rejects.toThrow();
    expect(host.SlopAndroid.postMessage).not.toHaveBeenCalled();
  });

  const validManualCases: [string, unknown][] = [
    ['/api/v1/auth/github-token', { token: 'synthetic-unit-test-token', enabled: true }],
    ['/api/v1/auth/github-token', { token: null, enabled: false }],
    ['/api/v1/auth/github-token', { token: '', enabled: true }],
    ['/api/v1/analyze', { body: 'Synthetic sample.', useLuna: false }],
    ['/api/v1/analyze', {
      body: 'Synthetic sample.', app: 'gmail', direction: 'sent', sender: 'Test sender',
      subjectOrTopic: 'Test topic', useLuna: true, recordInLedger: false, triggerAnimation: false
    }],
    ['/api/v1/analyze', { body: '', app: 'teams', direction: 'received', useLuna: false, recordInLedger: true, triggerAnimation: true }],
    ...['human_sparkle', 'peaceful_cloud', 'innocent_fruit', 'slop_splat', 'slop_grenade', 'my_outgoing_grenade']
      .map((preset): [string, unknown] => ['/api/v1/simulate', { preset, useLuna: false }]),
    ['/api/v1/simulate', { preset: 'slop_grenade', useLuna: true }],
    ['/api/v1/squeegee', { side: 'left' }],
    ['/api/v1/squeegee', { side: 'right' }]
  ];
  it.each(validManualCases)('forwards validated manual JSON only to its existing local route: %s', async (path, body) => {
    const pending = requestApi(path, { method: 'POST', body: JSON.stringify(body) });
    expect(sent()).toMatchObject({ method: 'POST', path, body });
    reply(sent().id, { ok: true });
    expect((await pending).ok).toBe(true);
  });

  const invalidManualCases: [string, string, unknown][] = [
    ['missing token', '/api/v1/auth/github-token', { enabled: true }],
    ['numeric token', '/api/v1/auth/github-token', { token: 42, enabled: true }],
    ['oversized token', '/api/v1/auth/github-token', { token: 'x'.repeat(8193), enabled: true }],
    ['token control character', '/api/v1/auth/github-token', { token: 'synthetic\nvalue', enabled: true }],
    ['missing enabled', '/api/v1/auth/github-token', { token: null }],
    ['nonboolean enabled', '/api/v1/auth/github-token', { token: null, enabled: 'true' }],
    ['unexpected auth key', '/api/v1/auth/github-token', { token: null, enabled: true, persist: true }],
    ['missing body', '/api/v1/analyze', { useLuna: false }],
    ['nonstring body', '/api/v1/analyze', { body: {}, useLuna: false }],
    ['oversized sample', '/api/v1/analyze', { body: 'x'.repeat(65537), useLuna: false }],
    ['missing explicit Luna', '/api/v1/analyze', { body: 'Synthetic sample.' }],
    ['nonboolean Luna', '/api/v1/analyze', { body: '', useLuna: 'false' }],
    ['invalid source', '/api/v1/analyze', { body: '', useLuna: false, app: 'unknown' }],
    ['invalid direction', '/api/v1/analyze', { body: '', useLuna: false, direction: 'in' }],
    ['nonstring sender', '/api/v1/analyze', { body: '', useLuna: false, sender: null }],
    ['oversized subject', '/api/v1/analyze', { body: '', useLuna: false, subjectOrTopic: 'x'.repeat(1025) }],
    ['nonboolean record', '/api/v1/analyze', { body: '', useLuna: false, recordInLedger: 1 }],
    ['nonboolean animation', '/api/v1/analyze', { body: '', useLuna: false, triggerAnimation: 'true' }],
    ['unexpected sample key', '/api/v1/analyze', { body: '', useLuna: false, destination: 'remote' }],
    ['missing preset', '/api/v1/simulate', { useLuna: false }],
    ['invalid preset', '/api/v1/simulate', { preset: 'unknown', useLuna: false }],
    ['missing simulation Luna', '/api/v1/simulate', { preset: 'human_sparkle' }],
    ['unexpected simulation key', '/api/v1/simulate', { preset: 'human_sparkle', useLuna: false, body: '' }],
    ['missing side', '/api/v1/squeegee', {}],
    ['invalid side', '/api/v1/squeegee', { side: 'both' }],
    ['unexpected wipe key', '/api/v1/squeegee', { side: 'left', token: null }],
    ['array payload', '/api/v1/analyze', []],
    ['null payload', '/api/v1/squeegee', null],
    ['internal ingestion', '/internal/ingest', { body: 'Synthetic sample.' }]
  ];
  it.each(invalidManualCases)('rejects invalid manual payload without forwarding: %s', async (_name, path, body) => {
    await expect(requestApi(path, { method: 'POST', body: JSON.stringify(body) })).rejects.toThrow();
    expect(host.SlopAndroid.postMessage).not.toHaveBeenCalled();
  });

  it('bounds serialized payloads before parsing and never echoes malformed token JSON in errors', async () => {
    await expect(requestApi('/api/v1/auth/github-token', {
      method: 'POST', body: '{"token":"synthetic-unit-test-token'
    })).rejects.toThrow('Invalid native request payload.');
    await expect(requestApi('/api/v1/analyze', {
      method: 'POST', body: ' '.repeat(131073)
    })).rejects.toThrow('Invalid native request payload.');
    // Unicode JSON can fit the character bound but exceed the byte bound.
    await expect(requestApi('/api/v1/analyze', {
      method: 'POST', body: JSON.stringify({ body: '文'.repeat(65536), useLuna: false })
    })).rejects.toThrow('Invalid native request payload.');
    expect(host.SlopAndroid.postMessage).not.toHaveBeenCalled();
  });

  it('accepts bounded manual payload limits without logging or persisting session credentials', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const storage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    try {
      for (const [path, body] of [
        ['/api/v1/auth/github-token', { token: 'x'.repeat(8192), enabled: false }],
        ['/api/v1/analyze', { body: 'x'.repeat(65536), sender: 'x'.repeat(1024), subjectOrTopic: 'x'.repeat(1024), useLuna: false }]
      ] as const) {
        const pending = requestApi(path, { method: 'POST', body: JSON.stringify(body) });
        const request = sent(host.SlopAndroid.postMessage.mock.calls.length - 1);
        expect(request.body).toEqual(body);
        reply(request.id, { ok: true });
        expect((await pending).ok).toBe(true);
      }
      expect(storage.setItem).not.toHaveBeenCalled();
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally {
      logs.forEach((log) => log.mockRestore());
    }
  });

  it('keeps manual routes POST-only and rejects arbitrary/internal ingestion routes', async () => {
    for (const path of ['/api/v1/auth/github-token', '/api/v1/analyze', '/api/v1/simulate', '/api/v1/squeegee']) {
      await expect(requestApi(path)).rejects.toThrow('Unsupported native API operation');
    }
    for (const path of ['/api/v1/ingest', '/internal/ingest', '/api/v1/analyze?target=remote']) {
      await expect(requestApi(path, { method: 'POST', body: '{}' })).rejects.toThrow('Unsupported native API operation');
    }
    expect(host.SlopAndroid.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['https://example.com/api/v1/ledger', {}],
    ['/api/v1/ledger?token=secret', {}],
    ['/api/v1/analyze', { method: 'POST', body: '{"text":"private"}' }],
    ['/api/v1/accounts/add', { method: 'POST', body: '{"token":"private"}' }],
    ['/api/v1/scan/now', { method: 'POST', body: '{"lookbackDays":7,"useLuna":true}' }]
  ])('rejects non-allowlisted paths or payloads without forwarding: %s', async (path, init) => {
    await expect(requestApi(path, init)).rejects.toThrow();
    expect(host.SlopAndroid.postMessage).not.toHaveBeenCalled();
  });

  it('rejects matching malformed replies; ignores uncorrelated and unparseable messages', async () => {
    const pending = requestApi('/api/v1/ledger');
    const check = expect(pending).rejects.toThrow('Invalid native response');
    host.SlopAndroid.onmessage?.({ data: 'not json' });
    reply('unknown', {});
    host.SlopAndroid.onmessage?.({ data: JSON.stringify({ id: sent().id, status: '200', body: {} }) });
    await check;
  });

  it('times out and ignores late replies', async () => {
    const pending = requestApi('/api/v1/ledger');
    const check = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(300_000);
    await check;
    reply(sent().id, {});
  });

  it('rejects when postMessage fails', async () => {
    host.SlopAndroid.postMessage.mockImplementation(() => { throw new Error('Bridge closed'); });
    await expect(requestApi('/api/v1/ledger')).rejects.toThrow('Bridge closed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts requests, releases timers, and cleans up on pagehide', async () => {
    const controller = new AbortController();
    const pending = requestApi('/api/v1/ledger', { signal: controller.signal });
    const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await check;
    const other = requestApi('/api/v1/accounts');
    const closed = expect(other).rejects.toThrow('closed');
    host.dispatchEvent(new Event('pagehide'));
    await closed;
    expect(host.SlopAndroid.onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send pre-aborted requests and bounds concurrent pending requests', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(requestApi('/api/v1/ledger', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.SlopAndroid.postMessage).not.toHaveBeenCalled();
    const requests = Array.from({ length: 64 }, () => requestApi('/api/v1/ledger').catch(() => null));
    await expect(requestApi('/api/v1/ledger')).rejects.toThrow('Too many native requests');
    expect(host.SlopAndroid.postMessage).toHaveBeenCalledTimes(64);
    host.dispatchEvent(new Event('pagehide'));
    await Promise.all(requests);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the old listener and pending requests if the injected bridge is replaced', async () => {
    const old = host.SlopAndroid;
    const first = requestApi('/api/v1/ledger');
    const check = expect(first).rejects.toThrow('closed');
    host.SlopAndroid = new TestWindow().SlopAndroid;
    const second = requestApi('/api/v1/accounts');
    await check;
    expect(old.onmessage).toBeNull();
    reply(sent().id, {});
    expect((await second).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves desktop fetch untouched including request options', async () => {
    vi.stubGlobal('window', new EventTarget());
    const response = new Response('desktop');
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetcher);
    const init = { method: 'POST', body: 'unchanged' };
    expect(isNativeMobile()).toBe(false);
    expect(await requestApi('/api/v1/analyze', init)).toBe(response);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/analyze', init);
  });
});

describe('animation subscriptions', () => {
  it('notifies the consumer on every desktop reconnect before delivering the new process events', () => {
    vi.stubGlobal('window', new EventTarget());
    const handlers = new Map<string, (event: { data: string }) => void>();
    vi.stubGlobal('EventSource', vi.fn(function () {
      return { close: vi.fn(), addEventListener(name: string, callback: (event: { data: string }) => void) {
        handlers.set(name, callback);
      } };
    }));
    const restarted = vi.fn();
    const listener = vi.fn();
    const stop = subscribeAnimations(listener, restarted);
    handlers.get('open')!({ data: '' });
    handlers.get('animation')!({ data: JSON.stringify({ ...event(100), resetGeneration: 7 }) });
    handlers.get('open')!({ data: '' });
    handlers.get('animation')!({ data: JSON.stringify({ ...event(1), resetGeneration: 0 }) });
    expect(restarted).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([value]) => value.resetGeneration)).toEqual([7, 0]);
    stop();
  });

  it('accepts report-free wipe markers with optional legacy generations and rejects malformed generations', () => {
    vi.stubGlobal('window', new EventTarget());
    let receive = (_event: { data: string }) => {};
    vi.stubGlobal('EventSource', vi.fn(function () {
      return { close: vi.fn(), addEventListener(_name: string, callback: typeof receive) { receive = callback; } };
    }));
    const listener = vi.fn();
    const stop = subscribeAnimations(listener);
    for (const resetGeneration of [undefined, 0, 7, -1, 0.5, '7']) {
      receive({ data: JSON.stringify({ sequence: 1, dataWiped: true, resetGeneration }) });
    }
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.lastCall?.[0]).toEqual({ sequence: 1, dataWiped: true, resetGeneration: 7 });
    stop();
  });

  it('retains desktop EventSource and closes it on cleanup', () => {
    vi.stubGlobal('window', new EventTarget());
    let receive: (event: { data: string }) => void = () => {};
    const close = vi.fn();
    const EventSource = vi.fn(function () {
      return {
        close,
        addEventListener(_name: string, callback: typeof receive) { receive = callback; }
      };
    });
    vi.stubGlobal('EventSource', EventSource);
    const listener = vi.fn();
    const stop = subscribeAnimations(listener);
    expect(EventSource).toHaveBeenCalledWith('/api/v1/events/stream');
    receive({ data: 'invalid' });
    receive({ data: JSON.stringify(event(100)) });
    // EventSource reconnects internally after a daemon restart. Its new process
    // starts at sequence 1; desktop delivery must not retain a high-water mark.
    receive({ data: JSON.stringify(event(1)) });
    expect(listener.mock.calls.map(([value]) => value.sequence)).toEqual([100, 1]);
    stop();
    expect(close).toHaveBeenCalledOnce();
  });

  it('polls serially, deduplicates unordered batches, resets cursor after native process restart, and stops', async () => {
    host.SlopAndroid.postMessage.mockImplementation((data) => {
      const request = JSON.parse(data);
      const session = request.path === '/internal/session';
      reply(request.id, session ? { sessionId: phase < 2 ? 'first' : 'restarted' } :
        phase === 0 ? [event(9), event(8), event(9), { sequence: -1 }] :
        phase === 1 ? [event(9), event(10)] : [event(1)]);
    });
    let phase = 0;
    const listener = vi.fn();
    const restarted = vi.fn();
    const stop = subscribeAnimations(listener, restarted);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener.mock.calls.map(([e]) => e.sequence)).toEqual([8, 9]);
    phase = 1;
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener.mock.calls.map(([e]) => e.sequence)).toEqual([8, 9, 10]);
    expect(sent(3).path).toBe('/api/v1/events?after=9');
    phase = 2;
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent(5).path).toBe('/api/v1/events?after=0');
    expect(listener.mock.calls.map(([e]) => e.sequence)).toEqual([8, 9, 10, 1]);
    expect(restarted).toHaveBeenCalledTimes(2);
    stop();
    const count = host.SlopAndroid.postMessage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(host.SlopAndroid.postMessage).toHaveBeenCalledTimes(count);
  });

  it('aborts an in-flight poll on cleanup without delivering late events', async () => {
    const listener = vi.fn();
    const stop = subscribeAnimations(listener);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    reply(sent().id, { sessionId: 'late' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).not.toHaveBeenCalled();
    expect(host.SlopAndroid.postMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries failed or malformed polls and stops on pagehide', async () => {
    let valid = false;
    host.SlopAndroid.postMessage.mockImplementation((data) => {
      const request = JSON.parse(data);
      reply(request.id, valid ?
        request.path === '/internal/session' ? { sessionId: 'current' } : [event(1)] : {});
    });
    const listener = vi.fn();
    subscribeAnimations(listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();
    valid = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event('pagehide'));
    const count = host.SlopAndroid.postMessage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(host.SlopAndroid.postMessage).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });
});
