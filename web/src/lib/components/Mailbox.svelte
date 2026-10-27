<script lang="ts">
  import { onMount } from 'svelte';
  import { createMailbox, emptyMailbox, GMAIL_READONLY_SCOPE } from '$lib/mailbox';
  import { isNativeMobile } from '$lib/transport';

  let { onAccountsChanged = () => {}, onDataWiped = () => {}, native = isNativeMobile(), focusGmail = false }: {
    onAccountsChanged?: () => void; onDataWiped?: (generation?: number) => void; native?: boolean; focusGmail?: boolean
  } = $props();
  let state = $state(emptyMailbox());
  let mailbox: ReturnType<typeof createMailbox> | undefined;
  let panel: HTMLElement;
  const blocked = $derived(state.busy || (!native &&
    (state.loading || !state.enabled || !state.configured || state.authorizationPending)));

  onMount(() => {
    mailbox = createMailbox((next) => { state = next; }, undefined, () => onAccountsChanged(), native, onDataWiped);
    void mailbox.refresh();
    if (focusGmail && !native) {
      panel.focus();
      panel.scrollIntoView({ block: 'center' });
    }
    return () => mailbox?.dispose();
  });
</script>

<section bind:this={panel} id="gmail" tabindex="-1" class="panel mailbox" aria-label="Gmail mailboxes" aria-busy={state.busy || state.authorizationPending}>
  <div class="panel-head">
    <h2>{native ? 'Mailbox' : 'Gmail'}</h2>
    <button class="brass small" disabled={blocked} onclick={() => mailbox?.add()}>
      {native ? 'Authorize Gmail account' : state.operation === 'authorize' ? 'Opening Google sign-in…' : 'Sign in to Gmail'}
    </button>
  </div>
  {#if native}
    <p>Connect a Google account with read-only Gmail access. You can also start authorization from
      the Connect Gmail action on the Android notification-tray icon while effects are running.</p>
    <p role="status">Background: {state.backgroundStatus}</p>
  {:else}
    <p>Connect one or more Google accounts. Before you continue, the only requested permission is
      <code>{GMAIL_READONLY_SCOPE}</code>. Read-only access: no compose, modify, send, draft, or delete permissions.</p>
    <p>Google sign-in opens in your browser, not inside this dashboard. Credentials stay in memory only.
      You must authorize Gmail again after restarting the local daemon.</p>
    {#if state.loading}
      <p role="status">Loading Gmail status…</p>
    {:else if !state.enabled}
      <p role="status">Gmail monitoring is disabled. Enable Gmail in the local daemon configuration.</p>
    {:else if !state.configured}
      <p role="status">Gmail is not configured. Configure the desktop Google OAuth client in the local daemon, then refresh Gmail status.</p>
    {/if}
    <div class="actions">
      <button class="brass small" disabled={blocked || !state.accounts.some((account) => account.connected && !account.reconnectRequired)}
        onclick={() => mailbox?.scan()}>{state.operation === 'scan' ? 'Scanning Gmail…' : 'Scan now'}</button>
      <button class="brass small" disabled={state.busy} onclick={() => mailbox?.refresh()}>Refresh Gmail status</button>
    </div>
    {#if state.authorizationPending}
      <p role="status">Gmail authorization pending. Finish Google sign-in or wait for authorization to expire
        {state.authorizationExpiresAt ? ` (${state.authorizationExpiresAt})` : ''}.
        Returning here refreshes the connection; no second sign-in will start while one is pending.</p>
    {/if}
    {#if state.notice}
      <p role="status">{state.notice}</p>
    {/if}
  {/if}
  {#if state.error}
    <p role="alert">{state.error}</p>
  {/if}
  {#each state.accounts as account (account.id)}
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
  <div class="permission">
    <span>Overlay: {state.overlayActive ? 'Running' : state.overlayGranted ? 'Stopped' : 'Permission needed'}</span>
    {#if state.overlayActive}
      <button class="brass small" disabled={state.busy} onclick={() => mailbox?.stopOverlay()}>Stop effects</button>
    {:else if state.overlayGranted}
      <button class="brass small" disabled={state.busy} onclick={() => mailbox?.requestOverlay()}>Start effects</button>
    {:else}
      <button class="brass small" disabled={state.busy} onclick={() => mailbox?.requestOverlay()}>Allow overlay</button>
    {/if}
  </div>
  {#if !state.notificationsGranted}
    <p role="status">Effects need notifications. Allow the Screen-edge effects channel in Android app settings
      if notifications are blocked. Mailbox scanning is unaffected.</p>
  {/if}
  <p>Effects can run over other apps with an ongoing notification. Stop them here or from the notification.
    Android may stop effects; background mailbox scans continue independently.</p>
  {/if}
</section>

<style>
  .mailbox { margin-block: 1rem; padding: 1rem; }
  .panel-head, .permission, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .panel-head { justify-content: space-between; }
  .account { display: grid; gap: 0.5rem; padding-block: 0.75rem; overflow-wrap: anywhere; }
  code { overflow-wrap: anywhere; }
  .mailbox:focus-visible { outline: 2px solid #ffd23f; outline-offset: 3px; }
  [role='alert'] { color: #e8336d; }
</style>
