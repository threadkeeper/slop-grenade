/** Local-only API transport: desktop HTTP/SSE or the restricted Android message bridge. */
import type { AnimationEvent } from './types';

/** WebViewCompat injects this object only into the trusted app-assets origin. */
export interface AndroidBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}

declare global {
  interface Window {
    SlopAndroid?: AndroidBridge;
  }
}

/** Native capabilities are determined by the injected bridge, never the user agent. */
export function isNativeMobile(): boolean {
  return typeof window !== 'undefined' && typeof window.SlopAndroid?.postMessage === 'function';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bound JSON before parsing; errors must never echo samples or session tokens. */
function parseNativePayload(value: RequestInit['body']): Record<string, unknown> {
  if (typeof value !== 'string' || value.length > 131_072 ||
      new TextEncoder().encode(value).length > 131_072) {
    throw new Error('Invalid native request payload.');
  }
  let body: unknown;
  try { body = JSON.parse(value); } catch { throw new Error('Invalid native request payload.'); }
  if (!record(body)) throw new Error('Invalid native request payload.');
  return body;
}

function onlyKeys(body: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(body).every((key) => keys.includes(key));
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

/** Manual samples and Luna session tokens stay local to the bridge, never persisted or logged. */
function manualPayload(path: string, body: Record<string, unknown>): boolean {
  switch (path) {
    case '/api/v1/auth/github-token':
      return onlyKeys(body, ['token', 'enabled']) && typeof body.enabled === 'boolean' &&
        (body.token === null ||
          (boundedText(body.token, 8192) && !/[\u0000-\u001f\u007f]/.test(body.token)));
    case '/api/v1/analyze':
      return onlyKeys(body, [
        'body', 'useLuna', 'app', 'direction', 'sender', 'subjectOrTopic', 'recordInLedger', 'triggerAnimation'
      ]) && boundedText(body.body, 65_536) && typeof body.useLuna === 'boolean' &&
        (body.app === undefined || ['teams', 'outlook', 'gmail', 'share_point', 'word', 'copilot_chat', 'other'].includes(body.app as string)) &&
        (body.direction === undefined || ['sent', 'received'].includes(body.direction as string)) &&
        (body.sender === undefined || boundedText(body.sender, 1024)) &&
        (body.subjectOrTopic === undefined || boundedText(body.subjectOrTopic, 1024)) &&
        (body.recordInLedger === undefined || typeof body.recordInLedger === 'boolean') &&
        (body.triggerAnimation === undefined || typeof body.triggerAnimation === 'boolean');
    case '/api/v1/simulate':
      return onlyKeys(body, ['preset', 'useLuna']) && typeof body.useLuna === 'boolean' &&
        ['human_sparkle', 'peaceful_cloud', 'innocent_fruit', 'slop_splat', 'slop_grenade', 'my_outgoing_grenade']
          .includes(body.preset as string);
    case '/api/v1/squeegee':
      return onlyKeys(body, ['side']) && (body.side === 'left' || body.side === 'right');
    default:
      return false;
  }
}

/** Allow only existing local operations; background scans retain deterministic-only scoring. */
function nativeBody(path: string, init: RequestInit): unknown {
  const manualRoutes = [
    '/api/v1/auth/github-token', '/api/v1/analyze', '/api/v1/simulate', '/api/v1/squeegee'
  ];
  const method = (init.method ?? 'GET').toUpperCase();
  const allowed =
    (method === 'GET' && (
      ['/api/v1/ledger', '/api/v1/accounts', '/internal/session'].includes(path) ||
      /^\/api\/v1\/events\?after=\d+$/.test(path)
    )) ||
    (method === 'POST' && (
      ['/api/v1/accounts/add', '/api/v1/overlay/permission', '/api/v1/overlay/stop', '/api/v1/scan/now', ...manualRoutes].includes(path) ||
      /^\/api\/v1\/accounts\/[A-Za-z0-9_~%.-]+\/reconnect$/.test(path)
    )) ||
    (method === 'DELETE' && /^\/api\/v1\/accounts\/[A-Za-z0-9_~%.-]+$/.test(path));
  if (!allowed) throw new Error('Unsupported native API operation.');
  if (manualRoutes.includes(path)) {
    const body = parseNativePayload(init.body);
    if (!manualPayload(path, body)) throw new Error('Invalid native request payload.');
    return body;
  }
  if (path === '/api/v1/scan/now') {
    const body = parseNativePayload(init.body);
    if (body.lookbackDays !== 7 || body.useLuna !== false || Object.keys(body).length !== 2) {
      throw new Error('Invalid native scan request.');
    }
    return body;
  }
  if (init.body != null) throw new Error('Native operation does not accept a payload.');
  return null;
}

type Pending = {
  resolve(response: Response): void;
  reject(reason: unknown): void;
  cleanup(): void;
};
let nextId = 0;
let active: NativeRequests | undefined;

class NativeRequests {
  private pending = new Map<string, Pending>();
  private previous: AndroidBridge['onmessage'];
  constructor(private bridge: AndroidBridge, private host: Window) {
    this.previous = bridge.onmessage;
    bridge.onmessage = this.receive;
    host.addEventListener('pagehide', this.close, { once: true });
  }

  matches(bridge: AndroidBridge): boolean { return this.bridge === bridge; }

  private receive = (event: { data: string }) => {
    let value: unknown;
    try { value = JSON.parse(event.data); } catch { return; }
    if (!record(value) || typeof value.id !== 'string') return;
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    pending.cleanup();
    if (!Number.isInteger(value.status) || (value.status as number) < 200 ||
        (value.status as number) > 599 || !Object.hasOwn(value, 'body')) {
      pending.reject(new Error('Invalid native response.'));
      return;
    }
    try {
      const status = value.status as number;
      pending.resolve(new Response(
        [204, 205, 304].includes(status) ? null : JSON.stringify(value.body),
        { status, headers: { 'Content-Type': 'application/json' } }
      ));
    } catch {
      pending.reject(new Error('Invalid native response.'));
    }
  };

  close = () => {
    this.host.removeEventListener('pagehide', this.close);
    if (this.bridge.onmessage === this.receive) this.bridge.onmessage = this.previous ?? null;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Error('Native transport closed.'));
    }
    this.pending.clear();
    if (active === this) active = undefined;
  };

  request(path: string, init: RequestInit, body: unknown): Promise<Response> {
    if (init.signal?.aborted) return Promise.reject(new DOMException('Request aborted.', 'AbortError'));
    if (this.pending.size >= 64) return Promise.reject(new Error('Too many native requests.'));
    return new Promise((resolve, reject) => {
      const id = String(++nextId);
      const fail = (reason: unknown) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanup();
        reject(reason);
      };
      const abort = () => fail(new DOMException('Request aborted.', 'AbortError'));
      // Account consent and seven-day scans may outlive an ordinary HTTP request.
      const timer = setTimeout(() => fail(new Error('Native request timed out.')), 300_000);
      this.pending.set(id, {
        resolve, reject,
        cleanup: () => {
          clearTimeout(timer);
          init.signal?.removeEventListener('abort', abort);
        }
      });
      init.signal?.addEventListener('abort', abort, { once: true });
      try {
        this.bridge.postMessage(JSON.stringify({ id, method: (init.method ?? 'GET').toUpperCase(), path, body }));
      } catch (error) { fail(error); }
    });
  }
}

/** Fetch-compatible responses keep callers and desktop error handling unchanged. */
export async function requestApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!isNativeMobile()) return fetch(input, init);
  if (typeof input !== 'string') throw new Error('Native API requires a local path.');
  const body = nativeBody(input, init);
  const bridge = window.SlopAndroid!;
  if (!active?.matches(bridge)) {
    active?.close();
    active = new NativeRequests(bridge, window);
  }
  return active.request(input, init, body);
}

function animation(value: unknown): value is AnimationEvent {
  if (!record(value) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return false;
  if (value.resetGeneration !== undefined &&
      (!Number.isSafeInteger(value.resetGeneration) || (value.resetGeneration as number) < 0)) return false;
  if (value.dataWiped === true) return true;
  if (value.squeegeeSide === 'left' || value.squeegeeSide === 'right') return true;
  return record(value.report) && ['left', 'right'].includes(value.report.monitorSide as string) &&
    ['human_sparkle', 'peaceful_cloud', 'innocent_fruit', 'slop_splat', 'slop_grenade']
      .includes(value.report.tier as string);
}

/** Subscribe to animations; returned cleanup cancels timers, listeners and in-flight polls. */
export function subscribeAnimations(receive: (event: AnimationEvent) => void): () => void {
  let cursor = 0;
  const deliver = (event: AnimationEvent) => {
    if (event.sequence <= cursor) return;
    cursor = event.sequence; // Constant-space duplicate suppression.
    receive(event);
  };
  if (!isNativeMobile()) {
    const source = new EventSource('/api/v1/events/stream');
    source.addEventListener('animation', (event: MessageEvent) => {
      try {
        const value: unknown = JSON.parse(event.data);
        // EventSource reconnects internally, and a new daemon resets sequence.
        // Only native polling requires cursor-based duplicate suppression.
        if (animation(value)) receive(value);
      } catch { /* Ignore malformed events, as before. */ }
    });
    return () => source.close();
  }

  let stopped = false;
  let sessionId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const poll = async () => {
    try {
      const init = { signal: controller.signal };
      // The event sequence is per-process, not persistent. Check before every batch.
      const sessionResponse = await requestApi('/internal/session', init);
      if (!sessionResponse.ok) throw new Error('Native session unavailable.');
      const session: unknown = await sessionResponse.json();
      if (!record(session) || typeof session.sessionId !== 'string' || !session.sessionId) {
        throw new Error('Invalid native session.');
      }
      if (stopped) return;
      if (sessionId !== session.sessionId) cursor = 0;
      sessionId = session.sessionId;
      const response = await requestApi(`/api/v1/events?after=${cursor}`, init);
      if (!response.ok) throw new Error('Native events unavailable.');
      const batch: unknown = await response.json();
      if (!stopped && Array.isArray(batch)) {
        // Sorting avoids losing lower sequences from an unordered batch.
        for (const event of batch.filter(animation).sort((a, b) => a.sequence - b.sequence)) {
          if (stopped) break;
          deliver(event);
        }
      }
    } catch { /* Local service may be restarting; retry without exposing payloads. */ }
    finally {
      if (!stopped) timer = setTimeout(() => { void poll(); }, 1000);
    }
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    window.removeEventListener('pagehide', stop);
  };
  window.addEventListener('pagehide', stop, { once: true });
  void poll();
  return stop;
}
