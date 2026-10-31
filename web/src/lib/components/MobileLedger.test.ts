import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import MobileLedger from './MobileLedger.svelte';
import type { SlopReport } from '$lib/types';
import type { GmailDetailsState } from '$lib/gmailDetails';

const messageId = `${'a'.repeat(64)}:message-1`;
const row: SlopReport = {
  messageId, app: 'gmail', direction: 'received', sender: 'Gmail sender synthetic',
  subjectOrTopic: 'Gmail message', timestamp: '2026-10-30T09:00:00Z', wordCount: 12,
  slopScore: 80, heuristicScore: 80, lunaScore: null, tier: 'slop_grenade',
  isSlopGrenade: true, monitorSide: 'left',
  breakdown: { lexicalScore: 1, structuralScore: 2, burstinessScore: 3, handoffScore: 4, lunaScore: null },
  signals: [], summary: '', selfAwarenessTip: '', redactedPreview: '[Message content kept ephemeral]'
};
const tierColors = {
  human_sparkle: '#fff', peaceful_cloud: '#aaa', innocent_fruit: '#ff0',
  slop_splat: '#f80', slop_grenade: '#f08'
};

describe('Android ledger cards', () => {
  it('renders transient sender, recipient, subject and excerpt as escaped text', () => {
    const details: GmailDetailsState = {
      [messageId]: {
        status: 'ready', messageId, mailbox: 'reader@example.invalid', sender: 'Alice <alice@example.invalid>',
        recipient: 'bob@example.invalid', subject: '<script>synthetic</script>',
        excerpt: 'A short synthetic excerpt.'
      }
    };
    const { body } = render(MobileLedger, { props: { rows: [row], details, tierColors } });
    expect(body).toContain('alice@example.invalid');
    expect(body).toContain('bob@example.invalid');
    expect(body).toContain('reader@example.invalid');
    expect(body).toContain('A short synthetic excerpt.');
    expect(body).toContain('&lt;script>synthetic&lt;/script>');
    expect(body).not.toContain('<script>synthetic</script>');
    expect(body).not.toContain('Gmail sender synthetic');
  });

  it('explains unavailable Gmail details rather than presenting placeholders as real addresses', () => {
    const details: GmailDetailsState = { [messageId]: { status: 'error', error: 'reconnect', mailbox: 'reader@example.invalid' } };
    const { body } = render(MobileLedger, { props: { rows: [row], details, tierColors } });
    expect(body).toContain('Reconnect this Gmail account');
    expect(body).toContain('reader@example.invalid');
    expect(body).not.toContain('Gmail sender synthetic');
  });
});
