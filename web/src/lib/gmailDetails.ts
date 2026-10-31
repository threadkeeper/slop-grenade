import { isGmailMessageId } from './gmailMessageId';
import { requestApi } from './transport';

export { isGmailMessageId } from './gmailMessageId';

type DetailError = 'not_found' | 'reconnect' | 'unavailable';
type DetailState =
  | { status: 'loading' }
  | { status: 'error'; error: DetailError; mailbox?: string }
  | { status: 'ready'; messageId: string; mailbox: string; sender: string; recipient: string; subject: string; excerpt: string };

export type GmailDetailsState = Record<string, DetailState>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entries(value: unknown, ids: string[]): GmailDetailsState {
  if (!record(value) || !Array.isArray(value.entries) || value.entries.length !== ids.length) {
    throw new Error('Invalid Gmail details response.');
  }
  const expected = new Set(ids);
  const result: GmailDetailsState = {};
  for (const item of value.entries) {
    if (!record(item) || typeof item.messageId !== 'string' || !expected.delete(item.messageId)) {
      throw new Error('Invalid Gmail details response.');
    }
    if (typeof item.mailbox !== 'string' || Array.from(item.mailbox).length > 1024) {
      throw new Error('Invalid Gmail details response.');
    }
    if ('error' in item) {
      if (item.error !== 'not_found' && item.error !== 'reconnect' && item.error !== 'unavailable') {
        throw new Error('Invalid Gmail details response.');
      }
      result[item.messageId] = { status: 'error', error: item.error, mailbox: item.mailbox };
    } else if (typeof item.sender === 'string' && Array.from(item.sender).length <= 1024 &&
      typeof item.recipient === 'string' && Array.from(item.recipient).length <= 1024 &&
      typeof item.subject === 'string' && Array.from(item.subject).length <= 1024 &&
      typeof item.excerpt === 'string' && Array.from(item.excerpt).length <= 160) {
      result[item.messageId] = {
        status: 'ready', messageId: item.messageId, mailbox: item.mailbox, sender: item.sender,
        recipient: item.recipient, subject: item.subject, excerpt: item.excerpt
      };
    } else {
      throw new Error('Invalid Gmail details response.');
    }
  }
  return result;
}

/** Keep only the current view's details, never a persistent message cache. */
export function createGmailDetails(
  update: (state: GmailDetailsState) => void,
  fetcher: typeof fetch = requestApi
) {
  let state: GmailDetailsState = {};
  let desired: string[] = [];
  let revision = 0;
  let suspended = false;
  let disposed = false;
  const pending = new Set<AbortController>();

  const publish = (next: GmailDetailsState) => {
    state = next;
    update(next);
  };
  const cancel = () => {
    revision++;
    for (const controller of pending) controller.abort();
    pending.clear();
  };
  const loadBatch = async (ids: string[], current: number) => {
    const controller = new AbortController();
    pending.add(controller);
    try {
      const response = await fetcher('/api/v1/gmail/details', {
        method: 'POST', body: JSON.stringify({ messageIds: ids }), signal: controller.signal
      });
      if (!response.ok) throw new Error('Gmail details unavailable.');
      const value: unknown = await response.json();
      const loaded = entries(value, ids);
      if (!disposed && !suspended && current === revision) publish({ ...state, ...loaded });
    } catch {
      if (!disposed && !suspended && current === revision) {
        const failed = { ...state };
        for (const id of ids) failed[id] = { status: 'error', error: 'unavailable' };
        publish(failed);
      }
    } finally {
      pending.delete(controller);
    }
  };
  const load = () => {
    cancel();
    if (disposed || suspended) return;
    const current = revision;
    const requested = [...desired];
    const loading: GmailDetailsState = {};
    for (const id of requested) loading[id] = { status: 'loading' };
    publish(loading);
    let offset = 0;
    const worker = async () => {
      while (!disposed && !suspended && current === revision && offset < requested.length) {
        const batch = requested.slice(offset, offset + 5);
        offset += 5;
        await loadBatch(batch, current);
      }
    };
    for (let i = 0; i < Math.min(2, Math.ceil(requested.length / 5)); i++) void worker();
  };

  return {
    setIds(ids: readonly string[]) {
      const unique = [...new Set(ids)];
      if (unique.length > 20 || !unique.every(isGmailMessageId)) throw new RangeError('Invalid Gmail detail IDs.');
      if (unique.length === desired.length && unique.every((id, index) => id === desired[index])) return;
      desired = unique;
      load();
    },
    suspend() {
      if (disposed || suspended) return;
      suspended = true;
      cancel();
      publish({});
    },
    resume() {
      if (disposed || !suspended) return;
      suspended = false;
      load();
    },
    reset() {
      desired = [];
      cancel();
      publish({});
    },
    retry() {
      if (!disposed && !suspended) load();
    },
    dispose() {
      if (disposed) return;
      desired = [];
      cancel();
      publish({});
      disposed = true;
    }
  };
}
