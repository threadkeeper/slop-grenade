<script lang="ts">
  import { onMount } from 'svelte';
  import {
    computeBarChartBuckets,
    computeInOutGauges,
    computeTopFiveLists,
    filterReports,
    type DashboardFilterState,
    type TimeSpanFilter
  } from '$lib/dashboard';
  import type { AnimationEvent, AnimationTier, AwarenessScorecard } from '$lib/types';

  let scorecard = $state<AwarenessScorecard | null>(null);
  let lastSeenSequence = $state(0);

  let filters = $state<DashboardFilterState>({
    timeSpan: 'today',
    teams: true,
    outlook: true,
    tiers: {
      slop_grenade: true,
      slop_splat: true,
      innocent_fruit: true,
      peaceful_cloud: true,
      human_sparkle: true
    }
  });

  const allReports = $derived(scorecard?.recentReports ?? []);
  const filteredReports = $derived(filterReports(allReports, filters));
  const gauges = $derived(computeInOutGauges(filteredReports));
  const buckets = $derived(computeBarChartBuckets(filteredReports, filters.timeSpan));
  const leaderboards = $derived(
    filteredReports.length > 0
      ? computeTopFiveLists(filteredReports)
      : {
          topSloppers: scorecard?.topSloppers ?? [],
          topPDoomers: scorecard?.topPDoomers ?? []
        }
  );

  async function loadLedger() {
    try {
      const res = await fetch('/api/v1/ledger');
      if (res.ok) {
        scorecard = (await res.json()) as AwarenessScorecard;
      }
    } catch {
      // Background daemon unreachable
    }
  }

  function setTimeSpan(span: TimeSpanFilter) {
    filters.timeSpan = span;
  }

  function toggleTier(tier: AnimationTier) {
    filters.tiers[tier] = !filters.tiers[tier];
  }

  function gaugeArcPath(score: number): string {
    const clamped = Math.max(0, Math.min(100, score));
    const angle = Math.PI - (clamped / 100) * Math.PI;
    const cx = 90;
    const cy = 84;
    const r = 64;
    const startX = cx - r;
    const startY = cy;
    const endX = cx + r * Math.cos(angle);
    const endY = cy - r * Math.sin(angle);
    return `M ${startX} ${startY} A ${r} ${r} 0 0 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`;
  }

  onMount(() => {
    void loadLedger();

    const evtSource = new EventSource('/api/v1/events/stream');
    evtSource.addEventListener('animation', (e: MessageEvent) => {
      try {
        const animEvent = JSON.parse(e.data) as AnimationEvent;
        if (animEvent.sequence > lastSeenSequence) {
          lastSeenSequence = animEvent.sequence;
          void loadLedger();
        }
      } catch {
        // Ignore malformed event
      }
    });

    return () => {
      evtSource.close();
    };
  });
</script>

<main class="page">
  <header class="header">
    <div class="title-block">
      <h1>Slop Grenade</h1>
      <span class="sub">Communication Habit Monitor</span>
    </div>

    <div class="filters">
      <div class="filter-group" role="group" aria-label="Time span">
        <span class="group-label">Span</span>
        <button
          class:active={filters.timeSpan === 'today'}
          onclick={() => setTimeSpan('today')}
        >
          Today (00:00)
        </button>
        <button
          class:active={filters.timeSpan === '7d'}
          onclick={() => setTimeSpan('7d')}
        >
          7d
        </button>
        <button
          class:active={filters.timeSpan === '30d'}
          onclick={() => setTimeSpan('30d')}
        >
          30d
        </button>
        <button
          class:active={filters.timeSpan === 'all'}
          onclick={() => setTimeSpan('all')}
        >
          All
        </button>
      </div>

      <div class="filter-group" role="group" aria-label="Source channels">
        <span class="group-label">Source</span>
        <button
          class:active={filters.teams}
          onclick={() => (filters.teams = !filters.teams)}
        >
          Teams
        </button>
        <button
          class:active={filters.outlook}
          onclick={() => (filters.outlook = !filters.outlook)}
        >
          Outlook
        </button>
      </div>

      <div class="filter-group" role="group" aria-label="Slop and non-slop types">
        <span class="group-label">Types</span>
        <button
          class:active={filters.tiers.slop_grenade}
          onclick={() => toggleTier('slop_grenade')}
        >
          Grenade
        </button>
        <button
          class:active={filters.tiers.slop_splat}
          onclick={() => toggleTier('slop_splat')}
        >
          Slop
        </button>
        <button
          class:active={filters.tiers.innocent_fruit}
          onclick={() => toggleTier('innocent_fruit')}
        >
          Fruit
        </button>
        <button
          class:active={filters.tiers.peaceful_cloud}
          onclick={() => toggleTier('peaceful_cloud')}
        >
          Cloud
        </button>
        <button
          class:active={filters.tiers.human_sparkle}
          onclick={() => toggleTier('human_sparkle')}
        >
          Non-Slop (Human)
        </button>
      </div>
    </div>
  </header>

  <div class="layout">
    <div class="main-col">
      <!-- Daily In / Out Slop Gauges -->
      <section class="gauges-row" aria-label="In and Out Slop Gauges">
        <div class="panel gauge-panel">
          <div class="panel-head">
            <h2>Received Slop (In)</h2>
            <span class="meta">Resets daily at 00:00 • Brown-Red</span>
          </div>
          <div class="gauge-body">
            <svg viewBox="0 0 180 100" class="gauge-svg" aria-label="Received slop gauge">
              <path
                d="M 26 84 A 64 64 0 0 1 154 84"
                fill="none"
                stroke="#262930"
                stroke-width="14"
                stroke-linecap="butt"
              />
              {#if gauges.received.averageScore > 0}
                <path
                  d={gaugeArcPath(gauges.received.averageScore)}
                  fill="none"
                  stroke="#8c3a2b"
                  stroke-width="14"
                  stroke-linecap="butt"
                />
              {/if}
              <text x="90" y="72" text-anchor="middle" class="gauge-num">
                {gauges.received.averageScore}
              </text>
              <text x="90" y="88" text-anchor="middle" class="gauge-unit">AVG / 100</text>
            </svg>
            <div class="gauge-stats">
              <div>
                <span class="k">Messages</span>
                <span class="v">{gauges.received.messageCount}</span>
              </div>
              <div>
                <span class="k">Grenades In</span>
                <span class="v">{gauges.received.grenadeCount}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel gauge-panel">
          <div class="panel-head">
            <h2>Sent Slop (Out)</h2>
            <span class="meta">Resets daily at 00:00 • Brown-Blue</span>
          </div>
          <div class="gauge-body">
            <svg viewBox="0 0 180 100" class="gauge-svg" aria-label="Sent slop gauge">
              <path
                d="M 26 84 A 64 64 0 0 1 154 84"
                fill="none"
                stroke="#262930"
                stroke-width="14"
                stroke-linecap="butt"
              />
              {#if gauges.sent.averageScore > 0}
                <path
                  d={gaugeArcPath(gauges.sent.averageScore)}
                  fill="none"
                  stroke="#3b5978"
                  stroke-width="14"
                  stroke-linecap="butt"
                />
              {/if}
              <text x="90" y="72" text-anchor="middle" class="gauge-num">
                {gauges.sent.averageScore}
              </text>
              <text x="90" y="88" text-anchor="middle" class="gauge-unit">AVG / 100</text>
            </svg>
            <div class="gauge-stats">
              <div>
                <span class="k">Messages</span>
                <span class="v">{gauges.sent.messageCount}</span>
              </div>
              <div>
                <span class="k">Grenades Out</span>
                <span class="v">{gauges.sent.grenadeCount}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- In vs Out Slop Bar Chart -->
      <section class="panel chart-panel" aria-label="In vs Out Slop Bar Chart">
        <div class="panel-head">
          <h2>In vs. Out Slop Over Time</h2>
          <div class="legend">
            <span class="leg-item"><i class="swatch in"></i> Received (In)</span>
            <span class="leg-item"><i class="swatch out"></i> Sent (Out)</span>
          </div>
        </div>

        {#if buckets.length === 0}
          <p class="empty">No messages match the current filters.</p>
        {:else}
          <svg viewBox="0 0 680 220" class="bar-svg">
            {#each [0, 25, 50, 75, 100] as tick}
              {@const y = 185 - (tick / 100) * 155}
              <line x1="38" y1={y} x2="665" y2={y} stroke="#1f232b" stroke-width="1" />
              <text x="30" y={y + 4} text-anchor="end" class="axis-txt">{tick}</text>
            {/each}

            {#each buckets as b, idx}
              {@const slotW = 610 / Math.max(1, buckets.length)}
              {@const groupX = 48 + idx * slotW}
              {@const inH = (b.receivedScore / 100) * 155}
              {@const outH = (b.sentScore / 100) * 155}
              <g>
                <rect
                  x={groupX}
                  y={185 - inH}
                  width="16"
                  height={Math.max(2, inH)}
                  fill="#8c3a2b"
                >
                  <title>Received ({b.label}): {b.receivedScore}/100 ({b.receivedCount} msgs)</title>
                </rect>
                <rect
                  x={groupX + 19}
                  y={185 - outH}
                  width="16"
                  height={Math.max(2, outH)}
                  fill="#3b5978"
                >
                  <title>Sent ({b.label}): {b.sentScore}/100 ({b.sentCount} msgs)</title>
                </rect>
                <text x={groupX + 17} y="204" text-anchor="middle" class="axis-txt">
                  {b.label}
                </text>
              </g>
            {/each}
          </svg>
        {/if}
      </section>
    </div>

    <!-- Right-Hand Side: 2 x Top 5 Lists -->
    <aside class="right-col">
      <section class="panel list-panel" aria-label="Top 5 Sloppers">
        <div class="panel-head">
          <h2>Top 5 Sloppers</h2>
          <span class="meta">Highest AI slop</span>
        </div>
        {#if leaderboards.topSloppers.length === 0}
          <p class="empty">No sloppers in selected range.</p>
        {:else}
          <table class="rank-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Person</th>
                <th class="num">Grenades</th>
                <th class="num">Avg Slop</th>
              </tr>
            </thead>
            <tbody>
              {#each leaderboards.topSloppers as p, i}
                <tr>
                  <td class="rank">{i + 1}</td>
                  <td class="name">{p.name}</td>
                  <td class="num">{p.slopGrenades}</td>
                  <td class="num score-high">{p.averageSlopScore}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <section class="panel list-panel" aria-label="Top 5 P-Doomers">
        <div class="panel-head">
          <h2>Top 5 P-Doomers</h2>
          <span class="meta">Refuse to use AI</span>
        </div>
        {#if leaderboards.topPDoomers.length === 0}
          <p class="empty">No P-Doomers in selected range.</p>
        {:else}
          <table class="rank-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Person</th>
                <th class="num">Human Msgs</th>
                <th class="num">Avg Slop</th>
              </tr>
            </thead>
            <tbody>
              {#each leaderboards.topPDoomers as p, i}
                <tr>
                  <td class="rank">{i + 1}</td>
                  <td class="name">{p.name}</td>
                  <td class="num">{p.humanMessages}</td>
                  <td class="num score-low">{p.averageSlopScore}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    </aside>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #111317;
    color: #e4e7ec;
    font-family:
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Inter,
      sans-serif;
    font-size: 13px;
    -webkit-font-smoothing: antialiased;
  }

  .page {
    max-width: 1240px;
    margin: 0 auto;
    padding: 20px 24px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid #22262e;
    margin-bottom: 20px;
  }

  .title-block {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #f9fafb;
    letter-spacing: -0.01em;
  }

  .sub {
    color: #8b929e;
    font-size: 12px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: center;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #171a20;
    border: 1px solid #262a33;
    padding: 3px;
    border-radius: 4px;
  }

  .group-label {
    font-size: 11px;
    color: #7d8594;
    padding: 0 7px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .filter-group button {
    background: transparent;
    border: none;
    color: #9da4b0;
    padding: 4px 9px;
    font-size: 12px;
    border-radius: 3px;
    cursor: pointer;
  }

  .filter-group button.active {
    background: #282d37;
    color: #f3f4f6;
    font-weight: 500;
  }

  .layout {
    display: grid;
    grid-template-columns: 1fr 370px;
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 960px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .main-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .right-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .gauges-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .panel {
    background: #16181d;
    border: 1px solid #232730;
    border-radius: 4px;
    padding: 16px;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14px;
  }

  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #eceff4;
  }

  .meta {
    font-size: 11px;
    color: #7d8594;
  }

  .gauge-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .gauge-svg {
    width: 175px;
    height: 96px;
    flex-shrink: 0;
  }

  .gauge-num {
    fill: #f9fafb;
    font-size: 24px;
    font-weight: 600;
  }

  .gauge-unit {
    fill: #7d8594;
    font-size: 9px;
    letter-spacing: 0.05em;
  }

  .gauge-stats {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }

  .gauge-stats div {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid #20242c;
    padding-bottom: 6px;
  }

  .gauge-stats .k {
    color: #8b929e;
    font-size: 12px;
  }

  .gauge-stats .v {
    color: #f3f4f6;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .legend {
    display: flex;
    gap: 14px;
    font-size: 11px;
    color: #9da4b0;
  }

  .leg-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
  }

  .swatch.in {
    background: #8c3a2b;
  }

  .swatch.out {
    background: #3b5978;
  }

  .bar-svg {
    width: 100%;
    height: 220px;
    display: block;
  }

  .axis-txt {
    fill: #7d8594;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .rank-table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  .rank-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 500;
    color: #7d8594;
    padding: 6px 6px;
    border-bottom: 1px solid #232730;
  }

  .rank-table td {
    padding: 8px 6px;
    border-bottom: 1px solid #1d2027;
    font-size: 12px;
  }

  .rank-table th.num,
  .rank-table td.num {
    text-align: right;
  }

  .rank {
    color: #7d8594;
    width: 22px;
  }

  .name {
    color: #e4e7ec;
    font-weight: 500;
  }

  .score-high {
    color: #d97757;
    font-weight: 600;
  }

  .score-low {
    color: #7aa2f7;
    font-weight: 600;
  }

  .empty {
    color: #7d8594;
    font-size: 12px;
    margin: 12px 0;
  }
</style>
