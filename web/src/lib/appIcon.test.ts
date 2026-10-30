import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dashboard icon', () => {
  it('ships the branded favicon with the static dashboard', () => {
    const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
    const favicon = readFileSync(new URL('../../static/favicon.png', import.meta.url));
    const artwork = readFileSync(new URL('../../../docs/screenshots/slop-grenade-icon-120.png', import.meta.url));
    expect(html).toContain('<link rel="icon" type="image/png" href="%sveltekit.assets%/favicon.png" />');
    expect(favicon).toEqual(artwork);
  });
});
