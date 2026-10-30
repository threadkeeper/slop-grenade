import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ProvingGrounds from './ProvingGrounds.svelte';

describe('effects test range', () => {
  it('offers a realistic sample and retains the individual and stress-test controls', () => {
    const { body } = render(ProvingGrounds);
    expect(body).toContain('Example inbox');
    expect(body).toContain('No real messages are shown');
    expect(body).toContain('aria-label="Effects preview"');
    expect(body).toContain('Play sample');
    expect(body).toContain('Slop Grenade!');
    expect(body).toContain('AI Cannon');
    expect(body).toContain('Toss Fruit');
    expect(body).toContain('Smoke');
    expect(body).toContain('Twinkle');
    expect(body).toContain('Barrage');
    expect(body).toContain('Squeegee');
  });
});
