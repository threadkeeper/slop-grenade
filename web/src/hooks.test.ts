import { afterEach, describe, expect, it, vi } from 'vitest';
import { reroute } from './hooks';

afterEach(() => vi.unstubAllGlobals());

describe('Android app-assets entrypoint', () => {
  it('maps the native index.html document to the dashboard route without changing overlay parameters', () => {
    vi.stubGlobal('window', { SlopAndroid: { postMessage: vi.fn(), onmessage: null } });
    const url = new URL('https://appassets.androidplatform.net/index.html?mode=overlay&sound=1');
    expect(reroute({ url, fetch })).toBe('/');
    expect(url.search).toBe('?mode=overlay&sound=1');
    expect(reroute({ url: new URL('https://appassets.androidplatform.net/_app/example.js'), fetch }))
      .toBe('/_app/example.js');
  });

  it('does not alter desktop routes, including desktop index.html', () => {
    vi.stubGlobal('window', {});
    expect(reroute({ url: new URL('http://localhost/index.html'), fetch })).toBe('/index.html');
    expect(reroute({ url: new URL('http://localhost/'), fetch })).toBe('/');
  });
});
