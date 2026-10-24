import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Mailbox from './Mailbox.svelte';

  let overlayGranted = false;
  let overlayActive = false;

  vi.mock('$lib/mailbox', async (original) => {
    const module = await original<typeof import('../mailbox')>();
  return {
    ...module,
    emptyMailbox: () => ({
      ...module.emptyMailbox(),
      overlayGranted,
      overlayActive,
      backgroundStatus: 'Waiting for Android',
      accounts: [{
        id: 'test-id', label: 'Test mailbox', connected: false,
        reconnectRequired: true, lastSuccessfulScan: '2026-10-24T06:00:00Z'
      }]
    })
  };
});

afterEach(() => {
  overlayGranted = false;
  overlayActive = false;
  vi.unstubAllGlobals();
});

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

  it('offers restart when permission remains granted after effects stop', () => {
    overlayGranted = true;
    const { body } = render(Mailbox);
    expect(body).toContain('Start effects');
    expect(body).not.toContain('Allow overlay');
  });

  it('offers stop and explains background effects without claiming uninterrupted monitoring', () => {
    overlayGranted = true;
    overlayActive = true;
    const { body } = render(Mailbox);
    expect(body).toContain('Stop effects');
    expect(body).toContain('Running');
    expect(body).toContain('notification');
    expect(body).not.toContain('Start effects');
  });
});
