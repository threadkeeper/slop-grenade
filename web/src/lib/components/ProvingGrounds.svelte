<!--
  "Proving Grounds": a small monitor running the same effects engine as the
  desktop overlay. Live messages from the daemon play here too, and the brass
  buttons fire test effects without touching your stats.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { runStage, type EffectTier, type Side, type SfxSink, type Stage, type StageCue } from '$lib/engine';

  let {
    sfx = null,
    cue = null
  }: {
    sfx?: SfxSink | null;
    /** Latest live event to replay on the stage. */
    cue?: StageCue | null;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let stage: Stage | null = null;
  let side = $state<Side>('left');
  let lastSeq = -1;

  onMount(() => {
    if (!canvas) return;
    stage = runStage(canvas, { flyDelay: 20, sfx });
    const ro = new ResizeObserver(() => stage?.resize());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      stage?.stop();
      stage = null;
    };
  });

  $effect(() => {
    const s = sfx;
    if (stage) stage.world.sfx = s;
  });

  $effect(() => {
    const c = cue;
    if (!c || !stage || c.seq === lastSeq) return;
    lastSeq = c.seq;
    if (c.squeegee) stage.world.squeegee(c.side);
    else if (c.tier) stage.world.trigger(c.tier, c.side);
  });

  function fire(tier: EffectTier) {
    stage?.world.trigger(tier, side);
  }

  function wipe(which: Side) {
    stage?.world.squeegee(which);
  }

  function barrage() {
    const w = stage?.world;
    if (!w) return;
    const plan: [number, EffectTier, Side][] = [
      [0, 'peaceful_cloud', 'right'],
      [250, 'slop_grenade', 'left'],
      [900, 'slop_splat', 'right'],
      [1500, 'human_sparkle', 'left'],
      [3200, 'innocent_fruit', 'left'],
      [3700, 'innocent_fruit', 'right'],
      [4300, 'slop_grenade', 'right'],
      [5200, 'innocent_fruit', 'left']
    ];
    for (const [ms, tier, s] of plan) setTimeout(() => stage?.world.trigger(tier, s), ms);
  }
</script>

<section class="proving panel" aria-label="Effects test range">
  <div class="panel-head">
    <h2>Proving Grounds</h2>
    <span class="meta">Test fire here &middot; nothing is recorded</span>
  </div>

  <div class="monitor">
    <div class="screen">
      <div class="desk" aria-hidden="true">
        <div class="win w1"><i></i><i></i><i></i><i></i></div>
        <div class="win w2"><i></i><i></i><i></i></div>
      </div>
      <canvas bind:this={canvas} aria-label="Effects preview"></canvas>
      <span class="edge-tag left">INCOMING</span>
      <span class="edge-tag right">OUTGOING</span>
    </div>
  </div>

  <div class="range-controls">
    <div class="lever" role="radiogroup" aria-label="Edge to hit">
      <button role="radio" aria-checked={side === 'left'} class:on={side === 'left'} onclick={() => (side = 'left')}>
        &#9664; Incoming
      </button>
      <button role="radio" aria-checked={side === 'right'} class:on={side === 'right'} onclick={() => (side = 'right')}>
        Outgoing &#9654;
      </button>
    </div>
    <div class="arsenal">
      <button class="brass big" onclick={() => fire('slop_grenade')}>Slop Grenade!</button>
      <button class="brass" onclick={() => fire('slop_splat')}>AI Cannon</button>
      <button class="brass" onclick={() => fire('innocent_fruit')}>Toss Fruit</button>
      <button class="brass" onclick={() => fire('peaceful_cloud')}>Smoke</button>
      <button class="brass" onclick={() => fire('human_sparkle')}>Twinkle</button>
      <button class="brass" onclick={barrage}>Barrage</button>
    </div>
    <div class="squeegees">
      <button class="brass" onclick={() => wipe('left')}>&#9664; Squeegee</button>
      <button class="brass" onclick={() => wipe('right')}>Squeegee &#9654;</button>
    </div>
  </div>
</section>

<style>
  .monitor {
    position: relative;
    padding: 14px;
    border: 3px solid var(--ink);
    border-radius: 14px;
    background:
      radial-gradient(circle at 12px 12px, #fff1c2 0 2.5px, var(--ink) 3px 4px, transparent 4.5px),
      radial-gradient(circle at calc(100% - 12px) 12px, #fff1c2 0 2.5px, var(--ink) 3px 4px, transparent 4.5px),
      radial-gradient(circle at 12px calc(100% - 12px), #fff1c2 0 2.5px, var(--ink) 3px 4px, transparent 4.5px),
      radial-gradient(circle at calc(100% - 12px) calc(100% - 12px), #fff1c2 0 2.5px, var(--ink) 3px 4px, transparent 4.5px),
      linear-gradient(160deg, #f6d27a, #c58b2a 45%, #7a4b16);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.5),
      5px 6px 0 rgba(0, 0, 0, 0.5);
  }

  .screen {
    position: relative;
    aspect-ratio: 16 / 9;
    border: 3px solid var(--ink);
    border-radius: 6px;
    overflow: hidden;
    background:
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.03) 0 2px, transparent 2px 4px),
      radial-gradient(ellipse at 60% 30%, #3b5f8a, #1d2f4a 70%, #121c2c);
  }

  .desk {
    position: absolute;
    inset: 0;
  }

  .win {
    position: absolute;
    background: #f4f1ea;
    border: 2px solid #0e1622;
    border-top-width: 14px;
    border-radius: 3px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    opacity: 0.92;
  }

  .win i {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: #c9ced6;
  }

  .win i:nth-child(2n) {
    width: 70%;
  }

  .w1 {
    left: 24%;
    top: 14%;
    width: 38%;
    height: 52%;
  }

  .w2 {
    left: 52%;
    top: 40%;
    width: 26%;
    height: 34%;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .edge-tag {
    position: absolute;
    bottom: 6px;
    font: 11px var(--comic);
    letter-spacing: 1.5px;
    color: rgba(255, 255, 255, 0.55);
    pointer-events: none;
  }

  .edge-tag.left {
    left: 8px;
  }

  .edge-tag.right {
    right: 8px;
  }

  .range-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    margin-top: 14px;
  }

  .arsenal,
  .squeegees {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .lever {
    display: inline-flex;
    border: 3px solid var(--ink);
    border-radius: 999px;
    overflow: hidden;
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.5);
  }

  .lever button {
    font: 14px var(--comic);
    letter-spacing: 1px;
    padding: 6px 12px;
    border: 0;
    background: #3a2618;
    color: #c9b48a;
    cursor: pointer;
  }

  .lever button.on {
    background: linear-gradient(#ffe08a, #d9a441);
    color: var(--ink);
  }

  .big {
    font-size: 17px !important;
    background: linear-gradient(#ff8fb1, #e8336d 55%, #9e1747) !important;
    color: #fff4d6 !important;
  }
</style>
