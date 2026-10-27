<script lang="ts">
  import { onMount } from 'svelte';
  import { createM365, type M365State } from '$lib/m365';

  let { focus = false, onDataWiped = () => {} }: {
    focus?: boolean;
    onDataWiped?: (generation?: number) => void;
  } = $props();
  let state = $state<M365State>({ status: null, loading: true, busy: null, error: null, notice: null });
  let controller: ReturnType<typeof createM365> | undefined;
  let panel: HTMLElement;

  onMount(() => {
    controller = createM365((next) => { state = next; }, undefined, onDataWiped);
    void controller.refresh();
    if (focus) {
      panel.focus();
      panel.scrollIntoView({ block: 'center' });
    }
    return () => controller?.dispose();
  });
</script>

<section bind:this={panel} id="m365" tabindex="-1" class="panel account-panel" aria-label="Microsoft 365 account" aria-busy={state.loading || state.busy !== null}>
  <div class="panel-head">
    <h2>Microsoft 365</h2>
    <div class="actions">
      <button class="brass small" disabled={state.loading || state.busy !== null || !state.status?.binaryFound || state.status?.authenticated}
        onclick={() => controller?.signIn()}>
        {state.busy === 'signin' ? 'Signing in…' : 'Sign in to Microsoft 365'}
      </button>
      <button class="brass small" disabled={state.loading || state.busy !== null || !state.status?.binaryFound || !state.status?.authenticated}
        onclick={() => controller?.signOut()}>
        {state.busy === 'signout' ? 'Signing out…' : 'Sign out of Microsoft 365'}
      </button>
    </div>
  </div>
  <p>Microsoft Teams and Outlook use the local WorkIQ first-party authentication broker.</p>
  {#if state.loading}
    <p role="status">Loading Microsoft 365 status…</p>
  {:else if state.status}
    <p role="status">{state.status.authenticated ? 'Signed in' : 'Signed out'} · {state.status.message}</p>
  {/if}
  {#if state.notice}<p role="status">{state.notice}</p>{/if}
  {#if state.error}<p role="alert">{state.error}</p>{/if}
</section>

<style>
  .account-panel { margin-block: 1rem; padding: 1rem; }
  .panel-head, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .panel-head { justify-content: space-between; }
  .account-panel:focus-visible { outline: 2px solid #ffd23f; outline-offset: 3px; }
  [role='alert'] { color: #e8336d; }
</style>
