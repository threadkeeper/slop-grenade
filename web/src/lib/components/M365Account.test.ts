import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import M365Account from './M365Account.svelte';

describe('Microsoft 365 account panel', () => {
  it('renders explicit sign-in and sign-out controls with WorkIQ context', () => {
    const { body } = render(M365Account);
    expect(body).toContain('Sign in to Microsoft 365');
    expect(body).toContain('Sign out of Microsoft 365');
    expect(body).toContain('Microsoft Teams and Outlook');
    expect(body).toContain('WorkIQ');
  });
});
