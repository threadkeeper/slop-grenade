import { describe, expect, it } from 'vitest';
import { overlaySourceEnabled } from './overlaySources';

describe('overlay source filters', () => {
  it('allows every source when a shell does not provide filters', () => {
    for (const app of ['teams', 'outlook', 'gmail', 'other'] as const) {
      expect(overlaySourceEnabled('?mode=overlay', app)).toBe(true);
    }
  });

  it('filters Teams, Outlook and Gmail independently without hiding other sources', () => {
    const search = '?mode=overlay&sources=teams%2Cgmail';
    expect(overlaySourceEnabled(search, 'teams')).toBe(true);
    expect(overlaySourceEnabled(search, 'gmail')).toBe(true);
    expect(overlaySourceEnabled(search, 'outlook')).toBe(false);
    expect(overlaySourceEnabled(search, 'share_point')).toBe(true);
  });

  it('supports disabling all three monitored mail sources', () => {
    for (const app of ['teams', 'outlook', 'gmail'] as const) {
      expect(overlaySourceEnabled('?mode=overlay&sources=', app)).toBe(false);
    }
  });
});
