<!--
  Steampunk pressure gauge: brass bezel, cream dial, colour zones and a
  springy needle. Vents a puff of steam when the reading is in the red.
-->
<script lang="ts">
  let {
    value,
    label,
    id
  }: {
    /** 0-100 share of messages that read as AI-written */
    value: number;
    label: string;
    /** unique id prefix for SVG gradients */
    id: string;
  } = $props();

  const CX = 110;
  const CY = 112;
  const SWEEP = 240;
  const START = -120;

  const clamped = $derived(Math.max(0, Math.min(100, Math.round(value))));
  const needleDeg = $derived(START + (SWEEP * clamped) / 100);
  const hot = $derived(clamped >= 80);

  function polar(r: number, deg: number): [number, number] {
    const a = ((deg - 90) * Math.PI) / 180;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }

  function arc(r: number, from: number, to: number): string {
    const d0 = START + (SWEEP * from) / 100;
    const d1 = START + (SWEEP * to) / 100;
    const [x0, y0] = polar(r, d0);
    const [x1, y1] = polar(r, d1);
    const large = d1 - d0 > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  const ticks = Array.from({ length: 21 }, (_, i) => i * 5);
  const rivets = Array.from({ length: 10 }, (_, i) => i * 36 + 18);
</script>

<div class="gauge" class:hot>
  <svg viewBox="0 0 220 200" role="img" aria-label="{label}: {clamped}%">
    <defs>
      <radialGradient id="{id}-brass" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#ffe9a8" />
        <stop offset="45%" stop-color="#d9a441" />
        <stop offset="100%" stop-color="#7a4b16" />
      </radialGradient>
      <radialGradient id="{id}-face" cx="45%" cy="38%" r="70%">
        <stop offset="0%" stop-color="#fff8e4" />
        <stop offset="80%" stop-color="#f0dfb6" />
        <stop offset="100%" stop-color="#cdb27a" />
      </radialGradient>
      <pattern id="{id}-dots" width="5" height="5" patternUnits="userSpaceOnUse">
        <circle cx="2.5" cy="2.5" r="0.8" fill="#1b1420" fill-opacity="0.08" />
      </pattern>
    </defs>

    <!-- steam valve on top -->
    <rect x="101" y="2" width="18" height="16" rx="3" fill="url(#{id}-brass)" stroke="#1b1420" stroke-width="2.5" />
    <rect x="96" y="0" width="28" height="6" rx="2" fill="url(#{id}-brass)" stroke="#1b1420" stroke-width="2.5" />

    <!-- bezel -->
    <circle cx={CX} cy={CY} r="96" fill="url(#{id}-brass)" stroke="#1b1420" stroke-width="4" />
    <circle cx={CX} cy={CY} r="84" fill="none" stroke="#5b3510" stroke-width="2" />
    {#each rivets as deg}
      {@const p = polar(90, deg)}
      <circle cx={p[0]} cy={p[1]} r="2.6" fill="#fff1c2" stroke="#1b1420" stroke-width="1.4" />
    {/each}

    <!-- dial -->
    <circle cx={CX} cy={CY} r="80" fill="url(#{id}-face)" stroke="#1b1420" stroke-width="3" />
    <circle cx={CX} cy={CY} r="80" fill="url(#{id}-dots)" />

    <!-- zones -->
    <path d={arc(64, 0, 40)} stroke="#8fbf5a" stroke-width="11" fill="none" />
    <path d={arc(64, 40, 70)} stroke="#f2b134" stroke-width="11" fill="none" />
    <path d={arc(64, 70, 100)} stroke="#e0464f" stroke-width="11" fill="none" />
    <path d={arc(70, 0, 100)} stroke="#1b1420" stroke-width="2" fill="none" />
    <path d={arc(58, 0, 100)} stroke="#1b1420" stroke-width="2" fill="none" />

    <!-- ticks -->
    {#each ticks as t}
      {@const deg = START + (SWEEP * t) / 100}
      {@const major = t % 20 === 0}
      {@const a = polar(major ? 46 : 51, deg)}
      {@const b = polar(57, deg)}
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#1b1420" stroke-width={major ? 3 : 1.5} stroke-linecap="round" />
      {#if major}
        {@const n = polar(36, deg)}
        <text x={n[0]} y={n[1] + 4} class="num" text-anchor="middle">{t}</text>
      {/if}
    {/each}

    <text x={CX} y={CY + 34} class="unit" text-anchor="middle">% AI</text>

    <!-- needle -->
    <g class="needle" style="transform: rotate({needleDeg}deg); transform-origin: {CX}px {CY}px;">
      <path
        d="M {CX - 5} {CY + 14} L {CX} {CY - 70} L {CX + 5} {CY + 14} Z"
        fill="#c8102e"
        stroke="#1b1420"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
    </g>
    <circle cx={CX} cy={CY} r="11" fill="url(#{id}-brass)" stroke="#1b1420" stroke-width="3" />
    <circle cx={CX - 3} cy={CY - 3} r="3" fill="#fff4cc" />
  </svg>

  <div class="steam" aria-hidden="true">
    <span></span><span></span><span></span>
  </div>

  <div class="readout">{clamped}<small>%</small></div>
</div>

<style>
  .gauge {
    position: relative;
    width: 100%;
    max-width: 240px;
    margin: 0 auto;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
    filter: drop-shadow(4px 5px 0 rgba(0, 0, 0, 0.45));
  }

  .needle {
    transform-box: view-box;
    transition: transform 1.2s cubic-bezier(0.34, 1.7, 0.5, 1);
  }

  .num {
    font: 700 11px 'Impact', 'Haettenschweiler', 'Arial Black', sans-serif;
    fill: #1b1420;
  }

  .unit {
    font: 700 9px 'Segoe UI', system-ui, sans-serif;
    letter-spacing: 1.5px;
    fill: #5b3510;
  }

  .readout {
    position: absolute;
    left: 50%;
    bottom: 2px;
    transform: translateX(-50%) rotate(-3deg);
    padding: 1px 12px 2px;
    background: #1b1420;
    color: #ffd23f;
    font: 26px/1.1 'Impact', 'Haettenschweiler', 'Arial Black', sans-serif;
    letter-spacing: 1px;
    border: 2px solid #d9a441;
    border-radius: 4px;
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.5);
  }

  .readout small {
    font-size: 15px;
    margin-left: 1px;
  }

  .hot .readout {
    color: #ff5d73;
    animation: throb 0.9s ease-in-out infinite;
  }

  .steam {
    position: absolute;
    left: 50%;
    top: -6px;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .steam span {
    position: absolute;
    left: -9px;
    top: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 40%, #ffffff, #d9d4cc 60%, rgba(217, 212, 204, 0) 72%);
    opacity: 0;
  }

  .hot .steam span {
    animation: steam 1.8s ease-out infinite;
  }

  .hot .steam span:nth-child(2) {
    animation-delay: 0.6s;
  }

  .hot .steam span:nth-child(3) {
    animation-delay: 1.2s;
  }

  @keyframes steam {
    0% {
      transform: translate(0, 0) scale(0.4);
      opacity: 0.9;
    }
    100% {
      transform: translate(14px, -46px) scale(2.2);
      opacity: 0;
    }
  }

  @keyframes throb {
    0%,
    100% {
      transform: translateX(-50%) rotate(-3deg) scale(1);
    }
    50% {
      transform: translateX(-50%) rotate(-3deg) scale(1.08);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .needle,
    .hot .readout,
    .hot .steam span {
      transition: none;
      animation: none;
    }
  }
</style>
