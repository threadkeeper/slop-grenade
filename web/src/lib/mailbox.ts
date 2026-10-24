/** Native mailbox state and lifecycle, kept separate from Svelte for deterministic tests. */
import { requestApi } from './transport';

/** Sanitized account metadata supplied by the Android shell. */
export interface MailboxAccount {
  id: string;
  label: string;
  connected: boolean;
  lastSuccessfulScan: string | null;
  reconnectRequired: boolean;
}

/** Display state for the native-only mailbox panel. */
export interface MailboxState {
  accounts: MailboxAccount[];
  backgroundStatus: string;
  overlayGranted: boolean;
  overlayActive: boolean;
  busy: boolean;
  error: string | null;
}

/** Empty panel state before the first native response. */
export function emptyMailbox(): MailboxState {
  return { accounts: [], backgroundStatus: 'Loading…', overlayGranted: false, overlayActive: false, busy: false, error: null };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function account(value: unknown): value is MailboxAccount {
  return record(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.label === 'string' && typeof value.connected === 'boolean' &&
    (value.lastSuccessfulScan === null || typeof value.lastSuccessfulScan === 'string') &&
    typeof value.reconnectRequired === 'boolean';
}

/** Mount once per panel. The shell completes OAuth before resolving an add/reconnect request. */
export function createMailbox(
  update: (state: MailboxState) => void,
  fetcher: typeof fetch = requestApi,
  onAccountsChanged: () => void = () => {}
) {
  let state = emptyMailbox();
  let disposed = false;
  let generation = 0;
  const abort = new AbortController();
  const publish = (changes: Partial<MailboxState>) => {
    if (disposed) return;
    state = { ...state, ...changes };
    update(state);
  };

  const refresh = async () => {
    const request = ++generation;
    try {
      const response = await fetcher('/api/v1/accounts', { signal: abort.signal });
      if (!response.ok) throw new Error(`Mailbox unavailable (HTTP ${response.status}).`);
      const value: unknown = await response.json();
      if (!record(value) || !Array.isArray(value.accounts) || !value.accounts.every(account) ||
          typeof value.backgroundStatus !== 'string' || typeof value.overlayGranted !== 'boolean' ||
          typeof value.overlayActive !== 'boolean') {
        throw new Error('Invalid mailbox response.');
      }
      if (request === generation) publish({
        accounts: value.accounts, backgroundStatus: value.backgroundStatus,
        overlayGranted: value.overlayGranted, overlayActive: value.overlayActive, error: null
      });
    } catch (error) {
      if (request === generation) publish({
        error: error instanceof Error ? error.message : 'Mailbox unavailable.'
      });
    }
  };

  const change = async (path: string, method: 'POST' | 'DELETE') => {
    if (disposed || state.busy) return;
    publish({ busy: true, error: null });
    try {
      const response = await fetcher(path, { method, signal: abort.signal });
      if (!response.ok) throw new Error(`Mailbox operation failed (HTTP ${response.status}).`);
      if (response.status !== 204) {
        const value: unknown = await response.json();
        if (record(value) && value.ok === false) throw new Error('Mailbox operation failed.');
      }
      if (!disposed) {
        // Reload history as soon as the native operation completes, even if
        // the subsequent account-status request is slow or unavailable.
        onAccountsChanged();
        await refresh();
      }
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : 'Mailbox operation failed.' });
    } finally {
      publish({ busy: false });
    }
  };
  const onReturn = () => { if (!disposed) void refresh(); };
  const onVisible = () => { if (document.visibilityState === 'visible') onReturn(); };
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(onVisible, 30_000);

  return {
    refresh,
    add: () => change('/api/v1/accounts/add', 'POST'),
    reconnect: (id: string) => change(`/api/v1/accounts/${encodeURIComponent(id)}/reconnect`, 'POST'),
    disconnect: (id: string) => change(`/api/v1/accounts/${encodeURIComponent(id)}`, 'DELETE'),
    requestOverlay: () => change('/api/v1/overlay/permission', 'POST'),
    stopOverlay: () => change('/api/v1/overlay/stop', 'POST'),
    dispose: () => {
      disposed = true;
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}
