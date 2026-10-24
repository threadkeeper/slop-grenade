<!--
  Full-window transparent effects layer (open /?mode=overlay, e.g. as an OBS
  browser source). Every message the daemon scores lands on the matching edge.
  Add &sound=1 to hear it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { runStage, WebAudioSfx, type Stage } from '$lib/engine';
  import { subscribeAnimations } from '$lib/transport';

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
    const onResize = () => stage.resize();
    window.addEventListener('resize', onResize);

    const stopEvents = subscribeAnimations((ev) => {
      if (ev.squeegeeSide) stage.world.squeegee(ev.squeegeeSide);
      else stage.world.trigger(ev.report.tier, ev.report.monitorSide);
    });

    return () => {
      stopEvents();
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
