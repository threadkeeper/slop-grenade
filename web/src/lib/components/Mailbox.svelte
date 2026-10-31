<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { createMailbox, emptyMailbox, GMAIL_READONLY_SCOPE } from '$lib/mailbox';
  import { squeegeeOverlay } from '$lib/overlayControls';
  import { isNativeMobile } from '$lib/transport';
  import type { MonitorSide } from '$lib/types';

  let { onAccountsChanged = () => {}, onDataWiped = () => {}, native = isNativeMobile(), focusGmail = false,
    soundControls }: {
    onAccountsChanged?: () => void; onDataWiped?: (generation?: number) => void; native?: boolean;
    focusGmail?: boolean; soundControls?: Snippet
  } = $props();
  let mailboxState = $state(emptyMailbox());
  let wiping = $state(false);
  let wipeError = $state<string | null>(null);
  let wipeNotice = $state('');
  let wipeAbort: AbortController | undefined;
  let mailbox: ReturnType<typeof createMailbox> | undefined;
  let panel: HTMLElement;
  const blocked = $derived(mailboxState.busy || (!native &&
    (mailboxState.loading || !mailboxState.enabled || !mailboxState.configured || mailboxState.authorizationPending)));

  onMount(() => {
    wipeAbort = new AbortController();
    mailbox = createMailbox((next) => { mailboxState = next; }, undefined, () => onAccountsChanged(), native, onDataWiped);
    void mailbox.refresh();
    if (focusGmail && !native) {
      panel.focus();
      panel.scrollIntoView({ block: 'center' });
    }
    return () => {
      wipeAbort?.abort();
      mailbox?.dispose();
    };
  });

  async function wipe(side: MonitorSide) {
    if (wiping || !mailboxState.overlayActive) return;
    wiping = true;
    wipeError = null;
    wipeNotice = '';
    try {
      await squeegeeOverlay(side, undefined, wipeAbort?.signal);
      wipeNotice = `Clearing the ${side === 'left' ? 'incoming' : 'outgoing'} edge.`;
    } catch {
      if (!wipeAbort?.signal.aborted) wipeError = 'Squeegee unavailable. Check that effects are running and try again.';
    } finally {
      wiping = false;
    }
  }
</script>

<section bind:this={panel} id="gmail" tabindex="-1" class="panel mailbox" aria-label="Gmail mailboxes" aria-busy={mailboxState.busy || mailboxState.authorizationPending}>
  <div class="panel-head">
    <h2>{native ? 'Mailbox' : 'Gmail'}</h2>
    <button class="brass small" disabled={blocked} onclick={() => mailbox?.add()}>
      {native ? mailboxState.accounts.length ? 'Add another Gmail account' : 'Authorize Gmail account'
        : mailboxState.operation === 'authorize' ? 'Opening Google sign-in…' : 'Sign in to Gmail'}
    </button>
  </div>
  {#if native}
    <p>Connect one or more Google accounts with read-only Gmail access. Choose a different account to add another;
      if it is not listed, add it to Android first. You can also use the Connect Gmail action on the
      Android notification-tray icon while effects are running.</p>
    <p role="status">Background: {mailboxState.backgroundStatus}</p>
  {:else}
    <p>Connect one or more Google accounts. Before you continue, the only requested permission is
      <code>{GMAIL_READONLY_SCOPE}</code>. Read-only access: no compose, modify, send, draft, or delete permissions.</p>
    <p>Google sign-in opens in your browser, not inside this dashboard. Credentials stay in memory only.
      You must authorize Gmail again after restarting the local daemon.</p>
    {#if mailboxState.loading}
      <p role="status">Loading Gmail status…</p>
    {:else if !mailboxState.enabled}
      <p role="status">Gmail monitoring is disabled. Enable Gmail in the local daemon configuration.</p>
    {:else if !mailboxState.configured}
      <p role="status">Gmail is not configured. Configure the desktop Google OAuth client in the local daemon, then refresh Gmail status.</p>
    {/if}
    <div class="actions">
      <button class="brass small" disabled={blocked || !mailboxState.accounts.some((account) => account.connected && !account.reconnectRequired)}
        onclick={() => mailbox?.scan()}>{mailboxState.operation === 'scan' ? 'Scanning Gmail…' : 'Scan now'}</button>
      <button class="brass small" disabled={mailboxState.busy} onclick={() => mailbox?.refresh()}>Refresh Gmail status</button>
    </div>
    {#if mailboxState.authorizationPending}
      <p role="status">Gmail authorization pending. Finish Google sign-in or wait for authorization to expire
        {mailboxState.authorizationExpiresAt ? ` (${mailboxState.authorizationExpiresAt})` : ''}.
        Returning here refreshes the connection; no second sign-in will start while one is pending.</p>
    {/if}
    {#if mailboxState.notice}
      <p role="status">{mailboxState.notice}</p>
    {/if}
  {/if}
  {#if mailboxState.error}
    <p role="alert">{mailboxState.error}</p>
  {/if}
  {#if native && mailboxState.notice}
    <p role="status">{mailboxState.notice}</p>
  {/if}
  {#each mailboxState.accounts as account (account.id)}
    <div class="account">
      <strong>{account.label}</strong>
      <span>{account.connected ? 'Connected' : 'Disconnected'}{account.reconnectRequired ? ' · Reconnect required' : ''}</span>
      <span>Last successful scan: {account.lastSuccessfulScan ?? 'Not yet scanned'}</span>
      <div class="actions">
        <button class="brass small" disabled={blocked} onclick={() => mailbox?.reconnect(account.id)}>Reconnect</button>
        <button class="brass small" disabled={blocked} onclick={() => mailbox?.disconnect(account.id)}>Sign out of Gmail</button>
      </div>
      {#if !native && account.error}
        <p role="alert">{account.error}</p>
      {/if}
    </div>
  {:else}
    <p>No Gmail accounts connected.</p>
  {/each}
  {#if native}
  {#if mailboxState.accounts.length}
    <p class="account-note">Signing out clears the local ledger; remaining accounts refresh quietly.</p>
  {/if}
  <section id="effects-settings" tabindex="-1" class="effects-settings" aria-label="Effects settings">
    <h3>Effects settings</h3>
    <div class="permission">
      <span>Overlay: {mailboxState.overlayActive ? 'Running' : mailboxState.overlayGranted ? 'Stopped' : 'Permission needed'}</span>
      {#if mailboxState.overlayActive}
        <button class="brass small" disabled={mailboxState.busy} onclick={() => mailbox?.stopOverlay()}>Stop effects</button>
      {:else if mailboxState.overlayGranted}
        <button class="brass small" disabled={mailboxState.busy} onclick={() => mailbox?.requestOverlay()}>Start effects</button>
      {:else}
        <button class="brass small" disabled={mailboxState.busy} onclick={() => mailbox?.requestOverlay()}>Allow overlay</button>
      {/if}
    </div>
    {#if soundControls}
      {@render soundControls()}
      <p>Sound and volume changes apply when you next start effects.</p>
    {/if}
    <div class="actions">
      <button class="brass small" disabled={!mailboxState.overlayActive || wiping} onclick={() => wipe('left')}>Squeegee incoming</button>
      <button class="brass small" disabled={!mailboxState.overlayActive || wiping} onclick={() => wipe('right')}>Squeegee outgoing</button>
    </div>
    <p>These controls clear the live screen edges without changing your ledger.
      {mailboxState.overlayActive ? '' : 'Start effects to use the squeegee.'}</p>
    {#if wipeNotice}<p role="status">{wipeNotice}</p>{/if}
    {#if wipeError}<p role="alert">{wipeError}</p>{/if}
    {#if !mailboxState.notificationsGranted}
      <p role="status">Effects need notifications. Allow the Screen-edge effects channel in Android app settings
        if notifications are blocked. Mailbox scanning is unaffected.</p>
    {/if}
    <p>Effects can run over other apps with an ongoing notification. Stop them here or from the notification.
      Android may stop effects; background mailbox scans continue independently.</p>
  </section>
  {/if}
</section>

<style>
  .mailbox { margin-block: 1rem; padding: 1rem; }
  .panel-head, .permission, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .panel-head { justify-content: space-between; }
  .account { display: grid; gap: 0.5rem; padding-block: 0.75rem; overflow-wrap: anywhere; }
  .account-note { font-size: 0.9em; }
  .effects-settings { margin-top: 1rem; padding-top: 0.75rem; border-top: 2px solid var(--ink); }
  .effects-settings h3 { margin: 0 0 0.75rem; }
  .effects-settings .permission, .effects-settings .actions { margin-block: 0.75rem; }
  code { overflow-wrap: anywhere; }
  .mailbox:focus-visible { outline: 2px solid #ffd23f; outline-offset: 3px; }
  [role='alert'] { color: #e8336d; }
</style>
