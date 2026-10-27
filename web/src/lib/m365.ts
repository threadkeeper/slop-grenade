import type { CombinedAuthStatus, WorkIqStatus } from './types';
import { requestApi } from './transport';

/** Dashboard state for the local WorkIQ Microsoft 365 broker. */
export interface M365State {
  status: WorkIqStatus | null;
  loading: boolean;
  busy: 'signin' | 'signout' | null;
  error: string | null;
  notice: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workIqStatus(value: unknown): value is WorkIqStatus {
  return record(value) && typeof value.binaryFound === 'boolean' &&
    (value.binaryPath === null || typeof value.binaryPath === 'string') &&
    (value.version === null || typeof value.version === 'string') &&
    typeof value.mcpReady === 'boolean' && typeof value.authenticated === 'boolean' &&
    Number.isSafeInteger(value.mcpToolCount) && (value.mcpToolCount as number) >= 0 &&
    (value.account === null || typeof value.account === 'string') &&
    typeof value.message === 'string';
}

function combinedStatus(value: unknown): value is CombinedAuthStatus {
  return record(value) && typeof value.adminAppRequired === 'boolean' &&
    workIqStatus(value.workiq) && record(value.githubLuna);
}

/** Create the dashboard controller for WorkIQ sign-in, status, and sign-out. */
export function createM365(
  update: (state: M365State) => void,
  fetcher: typeof fetch = requestApi,
  onDataWiped: (generation?: number) => void = () => {}
) {
  let state: M365State = { status: null, loading: true, busy: null, error: null, notice: null };
  let disposed = false;
  const abort = new AbortController();
  const publish = (changes: Partial<M365State>) => {
    if (disposed) return;
    state = { ...state, ...changes };
    update(state);
  };

  const refresh = async () => {
    try {
      const response = await fetcher('/api/v1/auth/status', { signal: abort.signal });
      const value: unknown = response.ok ? await response.json() : null;
      if (!combinedStatus(value)) throw new Error();
      publish({ status: value.workiq, loading: false, error: null });
    } catch {
      publish({ loading: false, error: 'Microsoft 365 status unavailable. Check the local daemon.' });
    }
  };

  const change = async (operation: 'signin' | 'signout') => {
    if (disposed || state.busy || !state.status?.binaryFound) return;
    publish({ busy: operation, error: null, notice: null });
    try {
      const response = await fetcher(
        operation === 'signin' ? '/api/v1/auth/workiq-login' : '/api/v1/auth/workiq-logout',
        { method: 'POST', signal: abort.signal }
      );
      const value: unknown = await response.json();
      const wiped = operation === 'signout' && record(value) && value.dataWiped === true;
      if (wiped) {
        if (!disposed) onDataWiped(Number.isSafeInteger(value.resetGeneration) && (value.resetGeneration as number) >= 0
          ? value.resetGeneration as number : undefined);
        publish({ notice: 'Communication data wiped.' });
      }
      if (!response.ok || !record(value) || value.ok !== true ||
          (operation === 'signout' && value.dataWiped !== true) ||
          typeof value.message !== 'string' || !combinedStatus(value.status)) throw new Error();
      publish({
        status: value.status.workiq,
        notice: operation === 'signin'
          ? 'Signed in to Microsoft 365.'
          : 'Signed out of Microsoft 365. All communication data wiped.'
      });
    } catch {
      publish({ error: operation === 'signin'
        ? 'Microsoft 365 sign-in failed. Complete the WorkIQ browser prompt and try again.'
        : 'Microsoft 365 sign-out failed. Try again or run workiq logout locally.' });
    } finally {
      publish({ busy: null });
    }
  };

  return {
    refresh,
    signIn: () => change('signin'),
    signOut: () => change('signout'),
    dispose: () => {
      disposed = true;
      abort.abort();
    }
  };
}
