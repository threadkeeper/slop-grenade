import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Mailbox from './Mailbox.svelte';
import type { MailboxState } from '../mailbox';

  let overlayGranted = false;
  let overlayActive = false;
  let desktopState: Partial<MailboxState> = {};

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
      }],
      ...desktopState
    })
  };
});

afterEach(() => {
  overlayGranted = false;
  overlayActive = false;
  desktopState = {};
  vi.unstubAllGlobals();
});

describe('desktop Mailbox panel', () => {
  it('discloses the exact read-only scope, multiaccount controls and restart authorization requirement', () => {
    desktopState = { enabled: true, configured: true, loading: false };
    const { body } = render(Mailbox, { props: { native: false } });
    for (const text of [
      'Sign in to Gmail', 'one or more Google accounts',
      'https://www.googleapis.com/auth/gmail.readonly',
      'no compose, modify, send, draft, or delete permissions',
      'authorize Gmail again after restarting the local daemon',
      'Scan now', 'Reconnect', 'Sign out of Gmail', 'Reconnect required', 'Last successful scan'
    ]) expect(body).toContain(text);
    for (const text of ['Android', 'Allow overlay', 'notification-tray icon', 'Background:']) {
      expect(body).not.toContain(text);
    }
  });

  it.each([
    [{ enabled: false, configured: true }, 'Gmail monitoring is disabled'],
    [{ enabled: true, configured: false }, 'Gmail is not configured'],
    [{ enabled: true, configured: true, authorizationPending: true }, 'Gmail authorization pending']
  ])('explains unavailable controls: %j', (state, text) => {
    desktopState = { loading: false, ...state };
    const { body } = render(Mailbox, { props: { native: false } });
    expect(body).toContain(text);
    expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Sign in to Gmail/);
    expect(body).toMatch(/<button[^>]*disabled[^>]*>Reconnect/);
    expect(body).toMatch(/<button[^>]*disabled[^>]*>Sign out of Gmail/);
  });

  it('announces scan progress and transient account errors without hiding other accounts', () => {
    desktopState = {
      loading: false, enabled: true, configured: true, busy: true, operation: 'scan',
      accounts: [{
        id: 'synthetic-id', label: 'Synthetic Gmail account', connected: true,
        reconnectRequired: false, lastSuccessfulScan: null, error: 'Try Scan now or Reconnect.'
      }]
    };
    const { body } = render(Mailbox, { props: { native: false } });
    expect(body).toContain('Scanning Gmail…');
    expect(body).toContain('aria-busy="true"');
    expect(body).toContain('Try Scan now or Reconnect.');
    expect(body).toContain('Not yet scanned');
  });
});

describe('native Mailbox panel', () => {
  it('offers the initial authorization action when no accounts are connected', () => {
    desktopState = { accounts: [] };
    const { body } = render(Mailbox, { props: { native: true } });
    expect(body).toContain('Authorize Gmail account');
    expect(body).not.toContain('Add another Gmail account');
  });

  it('renders the account controls, connection status, last scan, and overlay permission', () => {
    const { body } = render(Mailbox, { props: { native: true } });
    for (const text of [
      'Add another Gmail account', 'Connect Gmail', 'notification-tray icon', 'Test mailbox', 'Disconnected', 'Reconnect required',
      '2026-10-24T06:00:00Z', 'Reconnect', 'Sign out of Gmail', 'Allow overlay', 'Waiting for Android'
    ]) expect(body).toContain(text);
    expect(body).toContain('Effects settings');
    expect(body).toContain('Squeegee incoming');
    expect(body).toContain('Squeegee outgoing');
    expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Squeegee incoming/);
    expect(body).not.toContain('Outlook');
    expect(body).not.toContain('Teams');
  });

  it('offers restart when permission remains granted after effects stop', () => {
    overlayGranted = true;
    const { body } = render(Mailbox, { props: { native: true } });
    expect(body).toContain('Start effects');
    expect(body).not.toContain('Allow overlay');
  });

  it('offers stop and explains background effects without claiming uninterrupted monitoring', () => {
    overlayGranted = true;
    overlayActive = true;
    const { body } = render(Mailbox, { props: { native: true } });
    expect(body).toContain('Stop effects');
    expect(body).toContain('Running');
    expect(body).toContain('notification');
    expect(body).not.toContain('Start effects');
    expect(body).not.toMatch(/<button[^>]*disabled[^>]*>\s*Squeegee incoming/);
  });

  it('explains how to restore a blocked effects notification channel', () => {
    const { body } = render(Mailbox, { props: { native: true } });
    expect(body).toContain('Screen-edge effects');
    expect(body).toContain('Android app settings');
    expect(body).toContain('Mailbox scanning is unaffected');
  });
});
