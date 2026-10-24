import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Mailbox from './Mailbox.svelte';

vi.mock('$lib/mailbox', async (original) => {
  const module = await original<typeof import('../mailbox')>();
  return {
    ...module,
    emptyMailbox: () => ({
      ...module.emptyMailbox(),
      backgroundStatus: 'Waiting for Android',
      accounts: [{
        id: 'test-id', label: 'Test mailbox', connected: false,
        reconnectRequired: true, lastSuccessfulScan: '2026-10-24T06:00:00Z'
      }]
    })
  };
});

afterEach(() => vi.unstubAllGlobals());

describe('native Mailbox panel', () => {
  it('renders the account controls, connection status, last scan, and overlay permission', () => {
    const { body } = render(Mailbox);
    for (const text of [
      'Add Gmail account', 'Test mailbox', 'Disconnected', 'Reconnect required',
      '2026-10-24T06:00:00Z', 'Reconnect', 'Disconnect', 'Allow overlay', 'Waiting for Android'
    ]) expect(body).toContain(text);
    expect(body).not.toContain('Outlook');
    expect(body).not.toContain('Teams');
  });
});
