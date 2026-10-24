<script lang="ts">
  import { onMount } from 'svelte';
  import { createMailbox, emptyMailbox } from '$lib/mailbox';

  let { onAccountsChanged = () => {} }: { onAccountsChanged?: () => void } = $props();
  let state = $state(emptyMailbox());
  let mailbox: ReturnType<typeof createMailbox> | undefined;

  onMount(() => {
    mailbox = createMailbox((next) => { state = next; }, undefined, () => onAccountsChanged());
    void mailbox.refresh();
    return () => mailbox?.dispose();
  });
</script>

<section class="panel mailbox" aria-label="Gmail mailboxes" aria-busy={state.busy}>
  <div class="panel-head">
    <h2>Mailbox</h2>
    <button class="brass small" disabled={state.busy} onclick={() => mailbox?.add()}>Add Gmail account</button>
  </div>
  <p role="status">Background: {state.backgroundStatus}</p>
  {#if state.error}
    <p role="alert">{state.error}</p>
  {/if}
  {#each state.accounts as account (account.id)}
    <div class="account">
      <strong>{account.label}</strong>
      <span>{account.connected ? 'Connected' : 'Disconnected'}{account.reconnectRequired ? ' · Reconnect required' : ''}</span>
      <span>Last successful scan: {account.lastSuccessfulScan ?? 'Not yet scanned'}</span>
      <div class="actions">
        <button class="brass small" disabled={state.busy} onclick={() => mailbox?.reconnect(account.id)}>Reconnect</button>
        <button class="brass small" disabled={state.busy} onclick={() => mailbox?.disconnect(account.id)}>Disconnect</button>
      </div>
    </div>
  {:else}
    <p>No Gmail accounts connected.</p>
  {/each}
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
</section>

<style>
  .mailbox { margin-block: 1rem; padding: 1rem; }
  .panel-head, .permission, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .panel-head { justify-content: space-between; }
  .account { display: grid; gap: 0.5rem; padding-block: 0.75rem; overflow-wrap: anywhere; }
  [role='alert'] { color: #e8336d; }
</style>
