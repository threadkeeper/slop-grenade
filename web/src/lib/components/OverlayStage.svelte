<!--
  Full-window transparent effects layer (open /?mode=overlay, e.g. as an OBS
  browser source). Every message the daemon scores lands on the matching edge.
  Add &sound=1 to hear it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { runStage, WebAudioSfx, type Stage } from '$lib/engine';
  import { requestApi, subscribeAnimations } from '$lib/transport';
  import type { AwarenessScorecard, SlopReport } from '$lib/types';

  let canvas: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    if (!canvas) return;
    // see app.css: drops the dashboard backdrop so only the effects show
    document.documentElement.classList.add('overlay-mode');
    const params = new URLSearchParams(window.location.search);
    const sfx = params.get('sound') === '1' ? new WebAudioSfx() : null;
    if (sfx) {
      sfx.setVolume(Number(params.get('volume') ?? '70') / 100);
      sfx.setEnabled(true);
    }
    // full-screen layer: render at CSS pixels to keep it light
    const stage: Stage = runStage(canvas, { flyDelay: Number(params.get('flies') ?? '45'), sfx }, 1);
    const hostWindow = window as unknown as { __slopGrenadeStage?: Stage };
    hostWindow.__slopGrenadeStage = stage;
    const onResize = () => stage.resize();
    window.addEventListener('resize', onResize);

    const seenIds = new Set<string>();
    const dispatchStickyLedger = (reports: SlopReport[]) => {
      for (const pass of [0, 1]) {
        for (let i = reports.length - 1; i >= 0; i--) {
          const r = reports[i];
          const isSplat = r.tier === 'slop_grenade' || r.tier === 'slop_splat';
          const isSticky = isSplat || r.tier === 'innocent_fruit';
          if (!isSticky || (pass === 0) !== isSplat || seenIds.has(r.messageId)) continue;
          seenIds.add(r.messageId);
          stage.world.trigger(r.tier, r.monitorSide);
        }
      }
    };

    requestApi('/api/v1/ledger')
      .then((res) => (res.ok ? (res.json() as Promise<AwarenessScorecard>) : null))
      .then((card) => {
        if (card) dispatchStickyLedger(card.recentReports ?? []);
      })
      .catch(() => {});

    const stopEvents = subscribeAnimations((ev) => {
      if (ev.squeegeeSide) stage.world.squeegee(ev.squeegeeSide);
      else if (!seenIds.has(ev.report.messageId)) {
        seenIds.add(ev.report.messageId);
        stage.world.trigger(ev.report.tier, ev.report.monitorSide);
      }
    });

    return () => {
      stopEvents();
      delete hostWindow.__slopGrenadeStage;
      window.removeEventListener('resize', onResize);
      stage.stop();
      document.documentElement.classList.remove('overlay-mode');
    };
  });
</script>

<canvas bind:this={canvas} class="overlay" aria-hidden="true"></canvas>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    pointer-events: none;
  }
</style>
