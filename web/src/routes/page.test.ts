import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

afterEach(() => vi.unstubAllGlobals());

function page(native: boolean, search = '') {
  vi.stubGlobal('window', {
    location: { search },
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
    expect(body).not.toContain('Add Gmail account');
    expect(body).not.toContain('Gmail');
  });

  it('shows native-only mailbox, Gmail filter and refresh labels while retaining effects and sound', () => {
    const body = page(true);
    expect(body).toContain('Add Gmail account');
    expect(body).toContain('Gmail');
    expect(body).toContain('Effects test range');
    expect(body).toContain('Sound: Off');
    expect(body).toContain('Volume');
    expect(body).not.toContain('Outlook');
    expect(body).not.toContain('Teams');
  });

  it.each([false, true])('keeps overlay-only mode transparent without dashboard or mailbox (native=%s)', (native) => {
    const body = page(native, '?mode=overlay');
    expect(body).toContain('<canvas');
    expect(body).not.toContain('Add Gmail account');
    expect(body).not.toContain('Incoming Slop');
    expect(body).not.toContain('Sound:');
  });
});
