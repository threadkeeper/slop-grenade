<!--
  Full-window transparent effects layer (open /?mode=overlay, e.g. as an OBS
  browser source). Every message the daemon scores lands on the matching edge.
  Add &sound=1 to hear it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { runStage, WebAudioSfx, type Stage } from '$lib/engine';
  import { stageQuality } from '$lib/engine/quality';
  import { connectOverlay } from '$lib/overlay';
  import { isNativeMobile } from '$lib/transport';
  import type { SlopReport } from '$lib/types';
  import { overlaySourceEnabled } from '$lib/overlaySources';

  let canvas: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    if (!canvas) return;
    // see app.css: drops the dashboard backdrop so only the effects show
    document.documentElement.classList.add('overlay-mode');
    const params = new URLSearchParams(window.location.search);
    const sourceEnabled = (report: SlopReport) => overlaySourceEnabled(window.location.search, report.app);
    const sfx = params.get('sound') === '1' ? new WebAudioSfx() : null;
    if (sfx) {
      sfx.setVolume(Number(params.get('volume') ?? '70') / 100);
      sfx.setEnabled(true);
    }
    const quality = stageQuality(isNativeMobile(), 1);
    const stage: Stage = runStage(canvas, { flyDelay: Number(params.get('flies') ?? '45'), sfx },
      quality.maxDpr, quality.maxPixels);
    const hostWindow = window as unknown as { __slopGrenadeStage?: Stage };
    hostWindow.__slopGrenadeStage = stage;
    const onResize = () => stage.resize();
    window.addEventListener('resize', onResize);

    const connection = connectOverlay(stage, sourceEnabled);

    return () => {
      connection.dispose();
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
