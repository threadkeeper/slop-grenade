<script lang="ts">
  import { formatLedgerTimestamp, gaugeWhiteToPurpleColor, tierDisplayName } from '$lib/dashboard';
  import { isGmailMessageId, type GmailDetailsState } from '$lib/gmailDetails';
  import type { AnimationTier, SlopReport } from '$lib/types';

  let { rows, details, tierColors }: {
    rows: SlopReport[];
    details: GmailDetailsState;
    tierColors: Record<AnimationTier, string>;
  } = $props();

  function detailFailure(error: string): string {
    if (error === 'not_found') return 'Message no longer available.';
    if (error === 'reconnect') return 'Reconnect this Gmail account to show details.';
    return 'Details unavailable. Retry when Gmail is reachable.';
  }

  function visibleField(row: SlopReport, field: 'sender' | 'recipient' | 'subject' | 'excerpt'): string {
    if (row.app === 'gmail') {
      if (!isGmailMessageId(row.messageId)) return 'Details unavailable for this entry.';
      const detail = details[row.messageId];
      if (!detail || detail.status === 'loading') return 'Loading…';
      if (detail.status === 'error') return detailFailure(detail.error);
      const value = detail[field].trim();
      if (value) return value;
      return field === 'subject' ? '(No subject)' : field === 'excerpt' ? '(No preview available)' : '(Not provided)';
    }
    if (field === 'sender') return row.sender;
    if (field === 'recipient') return row.direction === 'received' ? 'You' : 'Team / Recipient';
    return field === 'subject' ? row.subjectOrTopic : row.redactedPreview;
  }
</script>

<div class="mobile-ledger">
  {#each rows as row (row.messageId)}
    {@const detail = details[row.messageId]}
    <article class="mobile-report" aria-label="Ledger message">
      <div class="mobile-report-head">
        <span class="score-pill" style="--pill: {gaugeWhiteToPurpleColor(row.slopScore)}">{row.slopScore}%</span>
        <span class="type-tag" style="background: {tierColors[row.tier]}">{tierDisplayName(row.tier)}</span>
        <span class="source">{row.app === 'gmail' ? 'Gmail' : row.app} &middot; {row.direction === 'received' ? 'Incoming' : 'Outgoing'}</span>
        <time datetime={row.timestamp}>{formatLedgerTimestamp(row.timestamp)}</time>
      </div>
      {#if detail?.status === 'ready' || (detail?.status === 'error' && detail.mailbox)}
        <p><strong>Mailbox:</strong> {detail.mailbox}</p>
      {/if}
      {#if row.app === 'gmail' && detail?.status === 'error'}
        <p role="status">{detailFailure(detail.error)}</p>
      {:else}
        <dl>
          <dt>From</dt><dd>{visibleField(row, 'sender')}</dd>
          <dt>To</dt><dd>{visibleField(row, 'recipient')}</dd>
          <dt>Subject</dt><dd>{visibleField(row, 'subject')}</dd>
        </dl>
        <p><strong>Excerpt:</strong> {visibleField(row, 'excerpt')}</p>
      {/if}
      <p class="metrics">L:{row.breakdown.lexicalScore} &middot; S:{row.breakdown.structuralScore}
        &middot; B:{row.breakdown.burstinessScore} &middot; H:{row.breakdown.handoffScore} ({row.wordCount}w)</p>
    </article>
  {:else}
    <p class="empty">No messages match these filters.</p>
  {/each}
</div>

<style>
  .mobile-ledger { display: grid; gap: 10px; }
  .mobile-report {
    padding: 10px;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: rgba(255, 252, 240, 0.6);
    overflow-wrap: anywhere;
  }
  .mobile-report-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 10px 0; }
  dt { font-weight: 700; }
  dd { margin: 0; min-width: 0; }
  p { margin: 8px 0 0; }
  .metrics { color: #5c4a35; font-size: 11px; }
  .source { color: #5c4a35; font-size: 11px; }
  .score-pill {
    display: inline-block;
    min-width: 42px;
    padding: 1px 6px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    font: 14px var(--comic);
    text-align: center;
    background: var(--pill);
    color: var(--ink);
  }
  .type-tag {
    display: inline-block;
    padding: 1px 7px;
    border: 2px solid var(--ink);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    transform: rotate(-2deg);
  }
</style>
