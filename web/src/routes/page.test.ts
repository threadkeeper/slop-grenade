import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

afterEach(() => vi.unstubAllGlobals());

function page(native: boolean, search = '', open = vi.fn()) {
  vi.stubGlobal('window', {
    location: { search }, open,
    ...(native ? { SlopAndroid: { postMessage: vi.fn(), onmessage: null } } : {})
  });
  return render(Page).body;
}

describe('shared dashboard UI', () => {
  it('keeps desktop channels and the manual effects range/sound controls unchanged', () => {
    const body = page(false);
    expect(body).toContain('Teams');
    expect(body).toContain('Outlook');
    expect(body).toContain('Effects test range');
    expect(body).toContain('Sound: Off');
    expect(body).toContain('Volume');
    expect(body).not.toContain('Authorize Gmail account');
    expect(body).toContain('Sign in to Microsoft 365');
    expect(body).toContain('Sign out of Microsoft 365');
    expect(body).toContain('Sign in to Gmail');
    expect(body).toContain('Apple Mail · Coming soon');
    expect(body).toContain('Yahoo Mail · Coming soon');
    expect(body).toContain('Gmail');
    expect(body).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(body).toContain('authorize Gmail again after restarting the local daemon');
    expect(body).toContain('Scan now');
    expect(body).not.toContain('notification-tray icon');
  });

  it('shows native-only mailbox, Gmail filter and refresh labels while retaining effects and sound', () => {
    const body = page(true);
    expect(body).toContain('Authorize Gmail account');
    expect(body).toContain('Gmail');
    expect(body).toContain('Effects test range');
    expect(body).toContain('Sound: Off');
    expect(body).toContain('Volume');
    expect(body).not.toContain('Outlook');
    expect(body).not.toContain('Teams');
    expect(body).toContain('Connect Gmail');
    expect(body).toContain('notification-tray icon');
  });

  it.each([false, true])('keeps overlay-only mode transparent without dashboard or mailbox (native=%s)', (native) => {
    const body = page(native, '?mode=overlay');
    expect(body).toContain('<canvas');
    expect(body).not.toContain('Authorize Gmail account');
    expect(body).not.toContain('Sign in to Gmail');
    expect(body).not.toContain('Sign in to Microsoft 365');
    expect(body).not.toContain('Incoming Slop');
    expect(body).not.toContain('Sound:');
  });

  it('renders the tray entry as a Gmail panel, without auto-authorizing on render', () => {
    const open = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const body = page(false, '?gmail=signin', open);
    expect(body).toContain('id="gmail"');
    expect(body).toContain('tabindex="-1"');
    expect(body).toContain('Sign in to Gmail');
    expect(fetcher).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
