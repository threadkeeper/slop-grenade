import { describe, expect, it, vi } from 'vitest';
import { createGmailDetails, isGmailMessageId, type GmailDetailsState } from './gmailDetails';

const account = 'a'.repeat(64);
const id = (number: number) => `${account}:message-${number}`;
const entry = (messageId: string) => ({
  messageId, mailbox: 'mailbox@example.invalid', sender: 'Sender <sender@example.invalid>', recipient: 'recipient@example.invalid',
  subject: 'Synthetic subject', excerpt: 'A short synthetic excerpt.'
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('transient Android Gmail details', () => {
  it('only accepts account-scoped Gmail IDs', () => {
    expect(isGmailMessageId(id(1))).toBe(true);
    for (const invalid of ['manual-1', 'a:message', `${account}:../secret`, `${account}:`, `${account}:${'x'.repeat(129)}`]) {
      expect(isGmailMessageId(invalid)).toBe(false);
    }
  });

  it('loads the visible IDs in bounded batches and does not refetch unchanged rows', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      const body = JSON.parse(String(init?.body)) as { messageIds: string[] };
      return json({ entries: body.messageIds.map(entry) });
    });
    let state: GmailDetailsState = {};
    const details = createGmailDetails((value) => { state = value; }, fetcher);
    const ids = Array.from({ length: 12 }, (_, index) => id(index));
    details.setIds(ids);
    expect(state[id(0)]).toEqual({ status: 'loading' });
    await vi.waitFor(() => expect(state[id(11)]).toMatchObject({ status: 'ready', ...entry(id(11)) }));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).messageIds.length)).toEqual([5, 5, 2]);
    details.setIds([...ids]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    details.dispose();
    expect(state).toEqual({});
  });

  it('clears details on page changes, hiding and disposal, and ignores late replies', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockImplementation(async (_path, init) =>
        json({ entries: (JSON.parse(String(init?.body)) as { messageIds: string[] }).messageIds.map(entry) }));
    let state: GmailDetailsState = {};
    const details = createGmailDetails((value) => { state = value; }, fetcher);
    details.setIds([id(1)]);
    details.suspend();
    expect(state).toEqual({});
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolve(json({ entries: [entry(id(1))] }));
    await Promise.resolve();
    expect(state).toEqual({});
    details.resume();
    await vi.waitFor(() => expect(state[id(1)]?.status).toBe('ready'));
    details.setIds([id(2)]);
    expect(state[id(1)]).toBeUndefined();
    await vi.waitFor(() => expect(state[id(2)]?.status).toBe('ready'));
    details.dispose();
    expect(state).toEqual({});
  });

  it('shows safe failures and permits retry without exposing provider text', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: 'synthetic@example.invalid synthetic-token' }, 503))
      .mockResolvedValueOnce(json({ entries: [entry(id(1))] }));
    let state: GmailDetailsState = {};
    const details = createGmailDetails((value) => { state = value; }, fetcher);
    details.setIds([id(1)]);
    await vi.waitFor(() => expect(state[id(1)]).toEqual({ status: 'error', error: 'unavailable' }));
    expect(JSON.stringify(state)).not.toContain('synthetic-token');
    details.retry();
    await vi.waitFor(() => expect(state[id(1)]?.status).toBe('ready'));
    details.dispose();
  });

  it('preserves explicit reconnect and deleted-message outcomes per account', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ entries: [
      { messageId: id(1), mailbox: 'first@example.invalid', error: 'reconnect' },
      { messageId: id(2), mailbox: 'second@example.invalid', error: 'not_found' }
    ] }));
    let state: GmailDetailsState = {};
    const details = createGmailDetails((value) => { state = value; }, fetcher);
    details.setIds([id(1), id(2)]);
    await vi.waitFor(() => expect(state[id(2)]).toEqual({ status: 'error', error: 'not_found', mailbox: 'second@example.invalid' }));
    expect(state[id(1)]).toEqual({ status: 'error', error: 'reconnect', mailbox: 'first@example.invalid' });
    details.dispose();
  });

  it('rejects malformed or mismatched native responses instead of displaying them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ entries: [entry(id(99))] }));
    let state: GmailDetailsState = {};
    const details = createGmailDetails((value) => { state = value; }, fetcher);
    details.setIds([id(1)]);
    await vi.waitFor(() => expect(state[id(1)]).toEqual({ status: 'error', error: 'unavailable' }));
    expect(state[id(99)]).toBeUndefined();
    details.dispose();
  });

  it('rejects unknown error codes even when a response also contains display data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ entries: [{ ...entry(id(1)), error: 'synthetic-provider-error' }] }));
    let state: GmailDetailsState = {};
    const details = createGmailDetails((value) => { state = value; }, fetcher);
    details.setIds([id(1)]);
    await vi.waitFor(() => expect(state[id(1)]).toEqual({ status: 'error', error: 'unavailable' }));
    expect(JSON.stringify(state)).not.toContain('synthetic-provider-error');
    details.dispose();
  });
});
