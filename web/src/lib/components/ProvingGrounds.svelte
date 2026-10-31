<!--
  "Proving Grounds": a small monitor running the same effects engine as the
  desktop overlay. Live messages from the daemon play here too, and the brass
  buttons fire test effects without touching your stats.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { runStage, type EffectTier, type Side, type SfxSink, type Stage, type StageCue } from '$lib/engine';
  import { stageQuality } from '$lib/engine/quality';
  import { playBarrage, playSample } from '$lib/samplePlayback';
  import { isNativeMobile } from '$lib/transport';

  let {
    sfx = null,
    cue = null,
    resetEpoch = 0
  }: {
    sfx?: SfxSink | null;
    /** Latest live event to replay on the stage. */
    cue?: StageCue | null;
    resetEpoch?: number;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let stage: Stage | null = null;
  let side = $state<Side>('left');
  let samplePlaying = $state(false);
  let cancelSample: (() => void) | null = null;
  let cancelBarrage: (() => void) | null = null;
  let lastSeq = -1;
  let lastResetEpoch = 0;

  onMount(() => {
    // don't replay whatever arrived before the range was opened
    lastSeq = cue?.seq ?? -1;
    lastResetEpoch = resetEpoch;
    if (!canvas) return;
    const quality = stageQuality(isNativeMobile(), 2);
    stage = runStage(canvas, { flyDelay: 20, sfx }, quality.maxDpr, quality.maxPixels);
    const ro = new ResizeObserver(() => stage?.resize());
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      stopSample();
      stopBarrage();
      stage?.stop();
      stage = null;
    };
  });

  $effect(() => {
    const s = sfx;
    if (stage) stage.world.sfx = s;
  });

  $effect(() => {
    const epoch = resetEpoch;
    const c = cue;
    if (stage && epoch !== lastResetEpoch) {
      lastResetEpoch = epoch;
      stopSample();
      stopBarrage();
      stage.reset();
    }
    if (!c || !stage || c.seq === lastSeq) return;
    lastSeq = c.seq;
    stopSample();
    if (c.squeegee) stage.world.squeegee(c.side);
    else if (c.tier) stage.world.trigger(c.tier, c.side);
  });

  function trigger(tier: EffectTier, which: Side) {
    stage?.world.trigger(tier, which);
  }

  function stopSample() {
    cancelSample?.();
    cancelSample = null;
    samplePlaying = false;
  }

  function stopBarrage() {
    cancelBarrage?.();
    cancelBarrage = null;
  }

  function toggleSample() {
    if (samplePlaying) {
      stopSample();
      return;
    }
    if (!stage) return;
    stopBarrage();
    samplePlaying = true;
    cancelSample = playSample(trigger, () => {
      cancelSample = null;
      samplePlaying = false;
    });
  }

  function fire(tier: EffectTier) {
    stopSample();
    trigger(tier, side);
  }

  function wipe(which: Side) {
    stopSample();
    stage?.world.squeegee(which);
  }

  function barrage() {
    if (!stage) return;
    stopSample();
    stopBarrage();
    cancelBarrage = playBarrage(trigger, () => (cancelBarrage = null));
  }
</script>

<section class="proving panel" aria-label="Effects test range">
  <div class="panel-head">
    <h2>Proving Grounds</h2>
    <span class="meta range-meta">Test fire here &middot; nothing is recorded</span>
  </div>

  <div class="monitor">
    <div class="screen">
      <div class="desk" aria-hidden="true">
        <div class="mail-window">
          <div class="mail-title"><span>Example inbox - Mail</span><span>&#8722; &nbsp; &#9633; &nbsp; &#215;</span></div>
          <div class="mail-body">
            <div class="mail-nav">
              <strong>Mail</strong>
              <span class="selected">Inbox</span>
              <span>Sent Items</span>
              <span>Drafts</span>
              <span>Archive</span>
            </div>
            <div class="mail-content">
              <div class="mail-heading"><strong>Inbox</strong><span>Today</span></div>
              <div class="mail-row selected">
                <span class="avatar pink">A</span>
                <div><strong>Alex</strong><span>Project update</span><small>Thanks, I'll take a look this afternoon.</small></div>
                <time>9:41</time>
              </div>
              <div class="mail-row">
                <span class="avatar blue">T</span>
                <div><strong>Taylor</strong><span>Weekly check-in</span><small>Here are the notes from our meeting.</small></div>
                <time>9:12</time>
              </div>
              <div class="mail-row">
                <span class="avatar green">S</span>
                <div><strong>Sam</strong><span>Re: Next steps</span><small>Sounds good to me.</small></div>
                <time>8:56</time>
              </div>
              <div class="mail-row">
                <span class="avatar gold">J</span>
                <div><strong>Jamie</strong><span>Lunch plans</span><small>Are we still on for today?</small></div>
                <time>8:30</time>
              </div>
            </div>
          </div>
        </div>
        <div class="taskbar">
          <span class="task-icon blue"></span><span class="task-icon gold"></span>
          <span class="task-icon green"></span><span class="task-icon pink"></span>
          <span class="task-clock">9:41</span>
        </div>
      </div>
      <canvas bind:this={canvas} aria-label="Effects preview"></canvas>
      <span class="edge-tag left">INCOMING</span>
      <span class="edge-tag right">OUTGOING</span>
    </div>
  </div>
  <p class="range-note">Example inbox &middot; No real messages are shown. The sample spaces out effects; firing a test stops it.</p>

  <div class="range-controls">
    <div class="lever" role="radiogroup" aria-label="Edge to hit">
      <button role="radio" aria-checked={side === 'left'} class:on={side === 'left'} onclick={() => (side = 'left')}>
        &#9664; Incoming
      </button>
      <button role="radio" aria-checked={side === 'right'} class:on={side === 'right'} onclick={() => (side = 'right')}>
        Outgoing &#9654;
      </button>
    </div>
    <button class="brass sample" aria-pressed={samplePlaying} onclick={toggleSample}>
      {samplePlaying ? 'Stop sample' : 'Play sample'}
    </button>
    <div class="arsenal">
      <button class="brass big" onclick={() => fire('slop_grenade')}>Slop Grenade!</button>
      <button class="brass" onclick={() => fire('slop_splat')}>AI Cannon</button>
      <button class="brass" onclick={() => fire('innocent_fruit')}>Toss Fruit</button>
      <button class="brass" onclick={() => fire('peaceful_cloud')}>Smoke</button>
      <button class="brass" onclick={() => fire('human_sparkle')}>Twinkle</button>
      <button class="brass" title="Stress-test several effects at once" onclick={barrage}>Barrage</button>
    </div>
    <div class="squeegees">
      <button class="brass" onclick={() => wipe('left')}>&#9664; Squeegee</button>
      <button class="brass" onclick={() => wipe('right')}>Squeegee &#9654;</button>
    </div>
  </div>
</section>

<style>
  .range-meta {
    margin-right: 80px;
  }

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
    container-type: inline-size;
    aspect-ratio: 16 / 9;
    border: 3px solid var(--ink);
    border-radius: 6px;
    overflow: hidden;
    background: linear-gradient(115deg, #263d63, #6388b2);
  }

  .desk {
    position: absolute;
    inset: 0;
  }

  .mail-window {
    position: absolute;
    left: 19%;
    top: 10%;
    width: 62%;
    height: 74%;
    overflow: hidden;
    border: 1px solid #aeb9c9;
    border-radius: 5px;
    background: #f8f9fb;
    box-shadow: 0 5px 16px rgba(8, 24, 45, 0.35);
    color: #293444;
    font: clamp(6px, 1.05cqw, 11px)/1.2 'Segoe UI', sans-serif;
  }

  .mail-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 12%;
    padding: 0 2.5%;
    background: #edf1f7;
    color: #576579;
  }

  .mail-body {
    display: flex;
    height: 88%;
  }

  .mail-nav {
    display: flex;
    flex-direction: column;
    gap: 6%;
    width: 23%;
    padding: 3% 1.5%;
    background: #f1f3f6;
  }

  .mail-nav span,
  .mail-nav strong {
    padding: 3% 5%;
    white-space: nowrap;
  }

  .mail-nav .selected,
  .mail-row.selected {
    background: #e4edf9;
  }

  .mail-content {
    flex: 1;
    min-width: 0;
    padding: 1% 2%;
  }

  .mail-heading {
    display: flex;
    justify-content: space-between;
    padding: 2% 1%;
    color: #53637a;
  }

  .mail-row {
    display: flex;
    align-items: center;
    gap: 2%;
    height: 19%;
    padding: 1% 1.5%;
    border-bottom: 1px solid #e4e7ec;
  }

  .mail-row div {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .mail-row span,
  .mail-row small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mail-row div > span {
    color: #315b91;
  }

  .mail-row small,
  .mail-row time {
    color: #798391;
    font-size: 0.85em;
  }

  .avatar {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.5cqw;
    height: 2.5cqw;
    border-radius: 50%;
    font-weight: 700;
  }

  .pink { background: #efd2df; }
  .blue { background: #c9ddf1; }
  .green { background: #d3e6dc; }
  .gold { background: #f1dfbf; }

  .taskbar {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1%;
    height: 7%;
    background: rgba(235, 239, 246, 0.9);
  }

  .task-icon {
    width: 2.1cqw;
    height: 2.1cqw;
    border-radius: 25%;
  }

  .task-icon.blue { background: #3d74c7; }
  .task-icon.gold { background: #dda037; }
  .task-icon.green { background: #4a9d77; }
  .task-icon.pink { background: #db5b8b; }

  .task-clock {
    position: absolute;
    right: 3%;
    font: clamp(6px, 0.9cqw, 10px) 'Segoe UI', sans-serif;
    color: #46566b;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }

  .edge-tag {
    position: absolute;
    bottom: 8.5%;
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
    margin-top: 10px;
  }

  .range-note {
    margin: 12px 2px 0;
    color: #654623;
    font-size: 12px;
  }

  .sample {
    background: linear-gradient(#fff0b0, #e0b448 55%, #ae7824);
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
