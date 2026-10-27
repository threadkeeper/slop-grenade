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
  notificationsGranted: boolean;
  busy: boolean;
  error: string | null;
}

/** Empty panel state before the first native response. */
export function emptyMailbox(): MailboxState {
  return { accounts: [], backgroundStatus: 'Loading…', overlayGranted: false, overlayActive: false, notificationsGranted: false, busy: false, error: null };
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

// Never display native/server exception text. Codes and expected HTTP statuses are a closed contract.
const operationErrors: Record<string, { status: number; message: string }> = {
  authorization_active: { status: 409, message: 'Finish the active Google authorization, then try again.' },
  google_configuration: { status: 422, message: 'Google OAuth configuration rejected this app. Ask the app maintainer to verify the Android package name, signing certificate and OAuth client configuration.' },
  google_network: { status: 503, message: 'Google authorization could not reach the service. Check your internet connection and try again.' },
  google_cancelled: { status: 400, message: 'Google authorization was cancelled. Select Add mailbox or Reconnect to try again.' },
  google_permission: { status: 403, message: 'Google authorization permission was not granted. Try again and allow Gmail read access; check account policy restrictions if blocked.' },
  google_reconnect: { status: 401, message: 'Google requires authorization. Reconnect and allow Gmail read access.' },
  google_unavailable: { status: 503, message: 'Google authorization is temporarily unavailable. Check Google Play services and try again.' },
  gmail_reconnect: { status: 401, message: 'Gmail rejected the authorization. Reconnect the mailbox and try again.' },
  gmail_permission: { status: 403, message: 'Gmail profile access was denied. Allow Gmail read access; if it persists, ask the app maintainer to check Gmail API enablement and OAuth consent configuration, or check account policy restrictions.' },
  gmail_rate_limited: { status: 429, message: 'Gmail is limiting requests. Try again later.' },
  gmail_unavailable: { status: 502, message: 'Gmail profile verification is temporarily unavailable. Check your connection and try again later.' },
  mailbox_identity_mismatch: { status: 422, message: 'Mailbox identity verification failed. Choose the same Google account when reconnecting.' },
  mailbox_account_not_found: { status: 404, message: 'This mailbox is no longer available. Refresh the mailbox list and add it again.' },
  mailbox_conflict: { status: 409, message: 'The mailbox operation conflicts with the current account state. Refresh and try again.' }
};

async function operationError(response: Response): Promise<string> {
  const fallback = `Mailbox operation failed (HTTP ${response.status}).`;
  try {
    const body: unknown = await response.json();
    if (!record(body) || typeof body.code !== 'string' || typeof body.retryable !== 'boolean' ||
        !Object.hasOwn(operationErrors, body.code)) return fallback;
    const known = operationErrors[body.code];
    return known.status === response.status ? known.message : fallback;
  } catch {
    return fallback;
  }
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
          typeof value.overlayActive !== 'boolean' || typeof value.notificationsGranted !== 'boolean') {
        throw new Error('Invalid mailbox response.');
      }
      if (request === generation) publish({
        accounts: value.accounts, backgroundStatus: value.backgroundStatus,
        overlayGranted: value.overlayGranted, overlayActive: value.overlayActive,
        notificationsGranted: value.notificationsGranted, error: null
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
      if (!response.ok) throw new Error(await operationError(response));
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
