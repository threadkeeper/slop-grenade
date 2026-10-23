<script lang="ts">
  import { onMount } from 'svelte';
  import {
    computeBarChartBuckets,
    computeInOutGauges,
    computeTopFiveLists,
    filterReports,
    gaugeWhiteToPurpleColor,
    rankGridReports,
    tierDisplayName,
    type DashboardFilterState,
    type TimeSpanFilter
  } from '$lib/dashboard';
  import type { AnimationEvent, AnimationTier, AwarenessScorecard } from '$lib/types';

  let scorecard = $state<AwarenessScorecard | null>(null);
  let lastSeenSequence = $state(0);
  let selectedBucket = $state<string | null>(null);
  let selectedPerson = $state<string | null>(null);

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
  const maxBucketTotal = $derived(
    Math.max(1, ...buckets.map((b) => b.totalCount))
  );
  const allTiersActive = $derived(
    filters.tiers.slop_grenade &&
      filters.tiers.slop_splat &&
      filters.tiers.innocent_fruit &&
      filters.tiers.peaceful_cloud &&
      filters.tiers.human_sparkle
  );
  const leaderboards = $derived(
    filteredReports.length > 0
      ? computeTopFiveLists(filteredReports)
      : {
          topSloppers: scorecard?.topSloppers ?? [],
          topPDoomers: scorecard?.topPDoomers ?? []
        }
  );
  const gridRows = $derived(
    rankGridReports(filteredReports, selectedBucket, selectedPerson, filters.timeSpan)
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
    selectedBucket = null;
  }

  function toggleBucketSelection(label: string) {
    selectedBucket = selectedBucket === label ? null : label;
  }

  function togglePersonSelection(name: string) {
    selectedPerson = selectedPerson === name ? null : name;
  }

  function clearCrossFilters() {
    selectedBucket = null;
    selectedPerson = null;
  }

  function gaugeMarkerCoords(score: number): { x: number; y: number; innerX: number; innerY: number } {
    const clamped = Math.max(0, Math.min(100, score));
    const angle = Math.PI - (clamped / 100) * Math.PI;
    const cx = 90;
    const cy = 84;
    const r = 64;
    return {
      x: cx + r * Math.cos(angle),
      y: cy - r * Math.sin(angle),
      innerX: cx + (r - 18) * Math.cos(angle),
      innerY: cy - (r - 18) * Math.sin(angle)
    };
  }

  function shortWords(text: string, maxWords = 9): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return `${words.slice(0, maxWords).join(' ')}…`;
  }

  function toggleTier(tier: AnimationTier) {
    filters.tiers[tier] = !filters.tiers[tier];
  }

  function toggleAllTiers() {
    const next = !allTiersActive;
    filters.tiers = {
      slop_grenade: next,
      slop_splat: next,
      innocent_fruit: next,
      peaceful_cloud: next,
      human_sparkle: next
    };
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
        <button class:active={allTiersActive} onclick={toggleAllTiers}>
          All
        </button>
        <button
          class:active={filters.tiers.slop_grenade}
          onclick={() => toggleTier('slop_grenade')}
        >
          slop-grenade
        </button>
        <button
          class:active={filters.tiers.slop_splat}
          onclick={() => toggleTier('slop_splat')}
        >
          ai-cannon
        </button>
        <button
          class:active={filters.tiers.innocent_fruit}
          onclick={() => toggleTier('innocent_fruit')}
        >
          sprinkled
        </button>
        <button
          class:active={filters.tiers.peaceful_cloud}
          onclick={() => toggleTier('peaceful_cloud')}
        >
          polish
        </button>
        <button
          class:active={filters.tiers.human_sparkle}
          onclick={() => toggleTier('human_sparkle')}
        >
          human
        </button>
      </div>
    </div>
  </header>

  <div class="layout">
    <div class="main-col">
      <!-- Daily In / Out Slop Gauges (0–100% Marker, White -> Fully Purple) -->
      <section class="gauges-row" aria-label="In and Out Slop Gauges">
        <div class="panel gauge-panel">
          <div class="panel-head">
            <h2>Received Slop (In)</h2>
            <span class="meta">0% White → 100% Purple • Resets 00:00</span>
          </div>
          <div class="gauge-body">
            {#snippet gaugeVisual(score: number, gradId: string)}
              {@const marker = gaugeMarkerCoords(score)}
              {@const markerColor = gaugeWhiteToPurpleColor(score)}
              <svg viewBox="0 0 180 104" class="gauge-svg" aria-label="Slop gauge">
                <defs>
                  <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#ffffff" />
                    <stop offset="45%" stop-color="#d8b4fe" />
                    <stop offset="100%" stop-color="#9333ea" />
                  </linearGradient>
                </defs>
                <path
                  d="M 26 84 A 64 64 0 0 1 154 84"
                  fill="none"
                  stroke="#262930"
                  stroke-width="14"
                  stroke-linecap="butt"
                />
                {#if score > 0}
                  <path
                    d={gaugeArcPath(score)}
                    fill="none"
                    stroke="url(#{gradId})"
                    stroke-width="14"
                    stroke-linecap="butt"
                  />
                {/if}
                <!-- 0%, 50%, 100% scale labels -->
                <text x="16" y="98" text-anchor="middle" class="scale-txt">0%</text>
                <text x="90" y="13" text-anchor="middle" class="scale-txt">50%</text>
                <text x="164" y="98" text-anchor="middle" class="scale-txt">100%</text>

                <!-- Gauge Marker showing exact 0–100% position -->
                <line
                  x1={marker.innerX}
                  y1={marker.innerY}
                  x2={marker.x}
                  y2={marker.y}
                  stroke={markerColor}
                  stroke-width="3"
                />
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="6"
                  fill={markerColor}
                  stroke="#111317"
                  stroke-width="2"
                />
                <text x="90" y="70" text-anchor="middle" class="gauge-num" fill={markerColor}>
                  {score}%
                </text>
                <text x="90" y="86" text-anchor="middle" class="gauge-unit">SLOP LEVEL</text>
              </svg>
            {/snippet}

            {@render gaugeVisual(gauges.received.averageScore, 'grad-in')}
            <div class="gauge-stats">
              <div>
                <span class="k">Messages</span>
                <span class="v">{gauges.received.messageCount}</span>
              </div>
              <div>
                <span class="k">slop-grenades In</span>
                <span class="v">{gauges.received.grenadeCount}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel gauge-panel">
          <div class="panel-head">
            <h2>Sent Slop (Out)</h2>
            <span class="meta">0% White → 100% Purple • Resets 00:00</span>
          </div>
          <div class="gauge-body">
            {@render gaugeVisual(gauges.sent.averageScore, 'grad-out')}
            <div class="gauge-stats">
              <div>
                <span class="k">Messages</span>
                <span class="v">{gauges.sent.messageCount}</span>
              </div>
              <div>
                <span class="k">slop-grenades Out</span>
                <span class="v">{gauges.sent.grenadeCount}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Per-Day Stacked Bar Chart by Type -->
      <section class="panel chart-panel" aria-label="Stacked Message Type Bar Chart">
        <div class="panel-head">
          <h2>Daily Breakdown by Type (Stacked)</h2>
          <div class="legend">
            <span class="leg-item"><i class="swatch type-grenade"></i> slop-grenade</span>
            <span class="leg-item"><i class="swatch type-cannon"></i> ai-cannon</span>
            <span class="leg-item"><i class="swatch type-sprinkled"></i> sprinkled</span>
            <span class="leg-item"><i class="swatch type-polish"></i> polish</span>
            <span class="leg-item"><i class="swatch type-human"></i> human</span>
          </div>
        </div>

        {#if buckets.length === 0}
          <p class="empty">No messages match the current filters.</p>
        {:else}
          <svg viewBox="0 0 680 220" class="bar-svg">
            {#each [0, 0.25, 0.5, 0.75, 1] as frac}
              {@const y = 185 - frac * 155}
              {@const val = Math.round(frac * maxBucketTotal)}
              <line x1="38" y1={y} x2="665" y2={y} stroke="#1f232b" stroke-width="1" />
              <text x="30" y={y + 4} text-anchor="end" class="axis-txt">{val}</text>
            {/each}

            {#each buckets as b, idx}
              {@const slotW = 610 / Math.max(1, buckets.length)}
              {@const barW = Math.min(34, Math.max(14, slotW * 0.56))}
              {@const barX = 48 + idx * slotW + (slotW - barW) * 0.5}
              {@const scale = 155 / maxBucketTotal}
              {@const hHuman = b.humanCount * scale}
              {@const hPolish = b.polishCount * scale}
              {@const hSprinkled = b.sprinkledCount * scale}
              {@const hCannon = b.aiCannonCount * scale}
              {@const hGrenade = b.slopGrenadeCount * scale}
              {@const yHuman = 185 - hHuman}
              {@const yPolish = yHuman - hPolish}
              {@const ySprinkled = yPolish - hSprinkled}
              {@const yCannon = ySprinkled - hCannon}
              {@const yGrenade = yCannon - hGrenade}
              <g
                class="bar-group"
                class:dimmed={selectedBucket !== null && selectedBucket !== b.label}
                onclick={() => toggleBucketSelection(b.label)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && toggleBucketSelection(b.label)}
              >
                {#if b.humanCount > 0}
                  <rect x={barX} y={yHuman} width={barW} height={hHuman} fill="#ffffff">
                    <title>{b.label} • human: {b.humanCount}</title>
                  </rect>
                {/if}
                {#if b.polishCount > 0}
                  <rect x={barX} y={yPolish} width={barW} height={hPolish} fill="#22c55e">
                    <title>{b.label} • polish: {b.polishCount}</title>
                  </rect>
                {/if}
                {#if b.sprinkledCount > 0}
                  <rect x={barX} y={ySprinkled} width={barW} height={hSprinkled} fill="#facc15">
                    <title>{b.label} • sprinkled: {b.sprinkledCount}</title>
                  </rect>
                {/if}
                {#if b.aiCannonCount > 0}
                  <rect x={barX} y={yCannon} width={barW} height={hCannon} fill="#8b5a2b">
                    <title>{b.label} • ai-cannon: {b.aiCannonCount}</title>
                  </rect>
                {/if}
                {#if b.slopGrenadeCount > 0}
                  <rect x={barX} y={yGrenade} width={barW} height={hGrenade} fill="#00a2ff">
                    <title>{b.label} • slop-grenade: {b.slopGrenadeCount}</title>
                  </rect>
                {/if}
                <text x={barX + barW * 0.5} y="204" text-anchor="middle" class="axis-txt">
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
                <tr
                  class="clickable-row"
                  class:selected-row={selectedPerson === p.name}
                  onclick={() => togglePersonSelection(p.name)}
                >
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
                <tr
                  class="clickable-row"
                  class:selected-row={selectedPerson === p.name}
                  onclick={() => togglePersonSelection(p.name)}
                >
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

  <!-- Bottom Power BI-Style Drill-Down Grid Ranked by Highest Slop Score -->
  <section class="panel grid-panel" aria-label="Selected Messages Drill-Down Grid">
    <div class="panel-head">
      <h2>
        Selected Communications ({gridRows.length}) — Ranked by Highest Slop Score
      </h2>
      <div class="grid-filter-pills">
        {#if selectedBucket || selectedPerson}
          <span class="meta">
            Filtered by:
            {#if selectedBucket}<strong>{selectedBucket}</strong>{/if}
            {#if selectedPerson}<strong>{selectedPerson}</strong>{/if}
          </span>
          <button class="clear-btn" onclick={clearCrossFilters}>Clear selection</button>
        {:else}
          <span class="meta">Click any bar or person above to cross-filter</span>
        {/if}
      </div>
    </div>

    <div class="grid-scroll">
      <table class="data-grid">
        <thead>
          <tr>
            <th class="num">Slop %</th>
            <th>Type</th>
            <th>Source</th>
            <th>Core Metrics (Lex / Struct / Burst / Handoff • Words)</th>
            <th>From</th>
            <th>To</th>
            <th>Subject</th>
            <th>Preview</th>
          </tr>
        </thead>
        <tbody>
          {#each gridRows as row (row.messageId)}
            <tr>
              <td class="num">
                <span class="score-pill" style="color: {gaugeWhiteToPurpleColor(row.slopScore)}">
                  {row.slopScore}%
                </span>
              </td>
              <td><span class="type-tag {row.tier}">{tierDisplayName(row.tier)}</span></td>
              <td class="cap">{row.app}</td>
              <td class="metrics-cell">
                L:{row.breakdown.lexicalScore} • S:{row.breakdown.structuralScore} • B:{row.breakdown.burstinessScore}
                • H:{row.breakdown.handoffScore} ({row.wordCount}w)
              </td>
              <td class="name">{row.sender}</td>
              <td>{row.direction === 'received' ? 'You' : 'Team / Recipient'}</td>
              <td>{row.subjectOrTopic}</td>
              <td class="preview-cell">{shortWords(row.redactedPreview, 10)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
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

  .swatch.type-grenade {
    background: #00a2ff;
  }

  .swatch.type-cannon {
    background: #8b5a2b;
  }

  .swatch.type-sprinkled {
    background: #facc15;
  }

  .swatch.type-polish {
    background: #22c55e;
  }

  .swatch.type-human {
    background: #ffffff;
    border: 1px solid #3f4654;
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

  .scale-txt {
    fill: #7d8594;
    font-size: 8.5px;
    font-variant-numeric: tabular-nums;
  }

  .bar-group {
    cursor: pointer;
    transition: opacity 0.12s ease;
  }

  .bar-group.dimmed {
    opacity: 0.32;
  }

  .clickable-row {
    cursor: pointer;
  }

  .clickable-row:hover {
    background: #1d212a;
  }

  .selected-row {
    background: #252b37;
  }

  .grid-panel {
    margin-top: 20px;
  }

  .grid-filter-pills {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .clear-btn {
    background: #252a34;
    color: #e4e7ec;
    border: 1px solid #383f4d;
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .grid-scroll {
    max-height: 240px;
    overflow-y: auto;
    border-top: 1px solid #232730;
  }

  .data-grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .data-grid th {
    position: sticky;
    top: 0;
    background: #16181d;
    text-align: left;
    font-size: 11px;
    font-weight: 500;
    color: #7d8594;
    padding: 7px 8px;
    border-bottom: 1px solid #232730;
  }

  .data-grid td {
    padding: 7px 8px;
    border-bottom: 1px solid #1d2027;
    white-space: nowrap;
  }

  .data-grid th.num,
  .data-grid td.num {
    text-align: right;
  }

  .score-pill {
    font-weight: 600;
  }

  .type-tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
  }

  .type-tag.slop_grenade {
    background: rgba(0, 162, 255, 0.18);
    color: #38bdf8;
  }

  .type-tag.slop_splat {
    background: rgba(139, 90, 43, 0.25);
    color: #d99b66;
  }

  .type-tag.innocent_fruit {
    background: rgba(250, 204, 21, 0.18);
    color: #facc15;
  }

  .type-tag.peaceful_cloud {
    background: rgba(34, 197, 94, 0.18);
    color: #4ade80;
  }

  .type-tag.human_sparkle {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .cap {
    text-transform: capitalize;
    color: #9da4b0;
  }

  .metrics-cell {
    color: #8b929e;
    font-size: 11px;
  }

  .preview-cell {
    color: #9da4b0;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
