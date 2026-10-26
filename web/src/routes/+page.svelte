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
    type BarBucket,
    type DashboardFilterState,
    type TimeSpanFilter
  } from '$lib/dashboard';
  import type { AnimationTier, AwarenessScorecard } from '$lib/types';
  import { WebAudioSfx, type StageCue } from '$lib/engine';
  import { refreshDaysForSpan, refreshHistory as requestHistoryRefresh } from '$lib/refresh';
  import { isNativeMobile, subscribeAnimations } from '$lib/transport';
  import { createLedger } from '$lib/ledger';
  import Mailbox from '$lib/components/Mailbox.svelte';
  import BrassGauge from '$lib/components/BrassGauge.svelte';
  import ProvingGrounds from '$lib/components/ProvingGrounds.svelte';
  import OverlayStage from '$lib/components/OverlayStage.svelte';

  /** `/?mode=overlay` shows only the transparent effects layer. */
  const overlayMode = new URLSearchParams(window.location.search).get('mode') === 'overlay';
  const mobile = isNativeMobile();

  const TIER_ORDER: AnimationTier[] = ['slop_grenade', 'slop_splat', 'innocent_fruit', 'peaceful_cloud', 'human_sparkle'];
  const TIER_COLOR: Record<AnimationTier, string> = {
    slop_grenade: '#e8336d',
    slop_splat: '#f28c28',
    innocent_fruit: '#ffd23f',
    peaceful_cloud: '#9db4ab',
    human_sparkle: '#fff6e0'
  };

  let scorecard = $state<AwarenessScorecard | null>(null);
  let cueSequence = 0;
  let selectedBucket = $state<string | null>(null);
  let selectedPerson = $state<string | null>(null);
  let cue = $state<StageCue | null>(null);
  /** The effects test range opens in a pop-up from the header icon. */
  let rangeOpen = $state(false);
  let refreshing = $state(false);
  let refreshNotice = $state('');
  let refreshError = $state<string | null>(null);
  let ledgerError = $state<string | null>(null);
  let ledger: ReturnType<typeof createLedger> | undefined;

  function readPref(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  // ---- optional sound (off until switched on; remembered in this browser)
  const sfx = new WebAudioSfx();
  let soundOn = $state(!overlayMode && readPref('slopgrenade.sound', 'off') === 'on');
  const savedVolume = Number(readPref('slopgrenade.volume', '70'));
  let volume = $state(Number.isFinite(savedVolume) ? savedVolume : 70);

  let filters = $state<DashboardFilterState>({
    timeSpan: 'today',
    teams: true,
    outlook: true,
    gmail: true,
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
  const maxBucketTotal = $derived(Math.max(1, ...buckets.map((b) => b.totalCount)));
  const allTiersActive = $derived(
    filters.tiers.slop_grenade &&
      filters.tiers.slop_splat &&
      filters.tiers.innocent_fruit &&
      filters.tiers.peaceful_cloud &&
      filters.tiers.human_sparkle
  );
  const leaderboards = $derived(computeTopFiveLists(filteredReports));
  /** Days the Refresh button reads: follows the Span filter, at most 30 (Android: always 7). */
  const refreshDays = $derived(refreshDaysForSpan(filters.timeSpan, mobile));
  const refreshWindow = $derived(refreshDays === 1 ? 'the last day' : `the last ${refreshDays} days`);
  const SPAN_LABEL: Record<TimeSpanFilter, string> = {
    today: 'Today · resets 00:00',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    all: 'All loaded history'
  };
  const gridRows = $derived(rankGridReports(filteredReports, selectedBucket, selectedPerson, filters.timeSpan));

  async function loadLedger() {
    return ledger?.refresh() ?? false;
  }

  async function refreshHistory() {
    if (refreshing) return;
    const days = refreshDays;
    const windowLabel = refreshWindow;
    refreshing = true;
    refreshError = null;
    refreshNotice = `Reading ${windowLabel} from ${mobile ? 'Gmail' : 'Outlook and Teams'}. This can take a few minutes.`;
    try {
      const batch = await requestHistoryRefresh(days);
      if (!(await loadLedger())) {
        refreshNotice = '';
        return;
      }
      clearCrossFilters();
      refreshNotice = `Refreshed ${windowLabel}: ${batch.newMessagesAnalyzed} added / ${batch.fetchedCount} scanned. History merged.`;
    } catch (error) {
      refreshNotice = '';
      refreshError = error instanceof Error ? error.message : 'The refresh failed.';
    } finally {
      refreshing = false;
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

  function bucketCount(b: BarBucket, tier: AnimationTier): number {
    switch (tier) {
      case 'slop_grenade':
        return b.slopGrenadeCount;
      case 'slop_splat':
        return b.aiCannonCount;
      case 'innocent_fruit':
        return b.sprinkledCount;
      case 'peaceful_cloud':
        return b.polishCount;
      default:
        return b.humanCount;
    }
  }

  /** Stacked segments, bottom (human) to top (grenade). */
  function barSegments(b: BarBucket): { tier: AnimationTier; y: number; h: number; n: number }[] {
    const scale = 150 / maxBucketTotal;
    let y = 185;
    const out: { tier: AnimationTier; y: number; h: number; n: number }[] = [];
    for (const tier of [...TIER_ORDER].reverse()) {
      const n = bucketCount(b, tier);
      if (n <= 0) continue;
      const h = n * scale;
      y -= h;
      out.push({ tier, y, h, n });
    }
    return out;
  }

  function toggleSound() {
    soundOn = !soundOn;
    sfx.setEnabled(soundOn);
    try {
      localStorage.setItem('slopgrenade.sound', soundOn ? 'on' : 'off');
    } catch {
      // storage unavailable
    }
    if (soundOn) sfx.play('squelch', 0, 0.5);
  }

  $effect(() => {
    sfx.setVolume(volume / 100);
    try {
      localStorage.setItem('slopgrenade.volume', String(volume));
    } catch {
      // storage unavailable
    }
  });

  onMount(() => {
    if (overlayMode) return;
    // browsers only start audio after a click, so arm it on the first one
    const arm = () => sfx.setEnabled(soundOn);
    window.addEventListener('pointerdown', arm, { once: true });

    ledger = createLedger(
      (snapshot) => { scorecard = snapshot; },
      (error) => { ledgerError = error; },
      { native: mobile }
    );

    const stopEvents = subscribeAnimations((animEvent) => {
      // Local cue IDs stay monotonic even when the native core process restarts.
      const seq = ++cueSequence;
      cue = animEvent.squeegeeSide
        ? { seq, side: animEvent.squeegeeSide, squeegee: true }
        : { seq, side: animEvent.report.monitorSide, tier: animEvent.report.tier };
      void loadLedger();
    });

    return () => {
      window.removeEventListener('pointerdown', arm);
      stopEvents();
      ledger?.dispose();
      sfx.setEnabled(false);
    };
  });
</script>

{#if overlayMode}
  <OverlayStage />
{:else}
  <main class="page">
    <header class="masthead">
      <div class="nameplate">
        <svg class="emblem" viewBox="0 0 64 64" aria-hidden="true">
          <g stroke="#1b1420" stroke-width="3" stroke-linejoin="round">
            <path d="M22 16 h20 l3 7 h-26 z" fill="#d9a441" />
            <path d="M42 18 q12 0 12 14" fill="none" stroke-width="4" />
            <circle cx="47" cy="10" r="5" fill="none" stroke-width="3" />
            <ellipse cx="32" cy="40" rx="20" ry="19" fill="#e8336d" />
            <path d="M18 34 q14 -8 28 0" fill="none" stroke-width="2" opacity="0.5" />
            <circle cx="25" cy="39" r="4" fill="#fff" />
            <circle cx="39" cy="39" r="4" fill="#fff" />
            <path d="M26 49 q6 5 12 0" fill="none" stroke-width="2.5" />
          </g>
          <circle cx="26" cy="38" r="1.8" fill="#1b1420" />
          <circle cx="40" cy="38" r="1.8" fill="#1b1420" />
        </svg>
        <div>
          <h1>Slop Grenade</h1>
          <span class="sub">Communication habit monitor &middot; v{__APP_VERSION__}</span>
        </div>
      </div>

      <div class="header-tools">
        <button
          class="brass small refresh-btn"
          title={`Read ${refreshWindow} of ${mobile ? 'Gmail' : 'Outlook and Teams (follows the Span filter, up to 30 days)'} without duplicates or replaying effects`}
          aria-busy={refreshing}
          disabled={refreshing}
          onclick={refreshHistory}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5M5.5 7a7.5 7.5 0 0 1 12.4-2L20 8M4 16l2.1 3A7.5 7.5 0 0 0 18.5 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          class="brass icon-btn"
          title="Effects test range"
          aria-label="Open the effects test range"
          aria-haspopup="dialog"
          onclick={() => (rangeOpen = true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.2" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </button>
        <div class="sound-box" role="group" aria-label="Sound effects">
          <button class="brass small" class:active={soundOn} aria-pressed={soundOn} onclick={toggleSound}>
            {soundOn ? 'Sound: On' : 'Sound: Off'}
          </button>
          <label class="volume" class:muted={!soundOn}>
            <span>Vol</span>
            <input type="range" min="0" max="100" step="5" bind:value={volume} aria-label="Volume" />
          </label>
        </div>
      </div>
    </header>

    {#if mobile}
      <Mailbox onAccountsChanged={() => { void loadLedger(); }} />
    {/if}

    {#if refreshError || ledgerError}
      <p class="refresh-feedback error" role="alert">Refresh unavailable: {refreshError ?? ledgerError}</p>
    {:else if refreshNotice}
      <p class="refresh-feedback" role="status" aria-live="polite">{refreshNotice}</p>
    {/if}

    <nav class="filters" aria-label="Filters">
      <div class="filter-group" role="group" aria-label="Time span">
        <span class="group-label">Span</span>
        <button class="brass small" class:active={filters.timeSpan === 'today'} onclick={() => setTimeSpan('today')}>
          Today
        </button>
        <button class="brass small" class:active={filters.timeSpan === '7d'} onclick={() => setTimeSpan('7d')}>7d</button>
        <button class="brass small" class:active={filters.timeSpan === '30d'} onclick={() => setTimeSpan('30d')}>30d</button>
        <button class="brass small" class:active={filters.timeSpan === 'all'} onclick={() => setTimeSpan('all')}>All</button>
      </div>

      <div class="filter-group" role="group" aria-label="Source channels">
        <span class="group-label">Source</span>
        {#if mobile}
          <button class="brass small" class:active={filters.gmail} onclick={() => (filters.gmail = !filters.gmail)}>
            Gmail
          </button>
        {:else}
          <button class="brass small" class:active={filters.teams} onclick={() => (filters.teams = !filters.teams)}>
            Teams
          </button>
          <button class="brass small" class:active={filters.outlook} onclick={() => (filters.outlook = !filters.outlook)}>
            Outlook
          </button>
        {/if}
      </div>

      <div class="filter-group" role="group" aria-label="Slop and non-slop types">
        <span class="group-label">Types</span>
        <button class="brass small" class:active={allTiersActive} onclick={toggleAllTiers}>All</button>
        {#each TIER_ORDER as tier}
          <button class="brass small tier-btn" class:active={filters.tiers[tier]} onclick={() => toggleTier(tier)}>
            <i class="swatch" style="background: {TIER_COLOR[tier]}"></i>{tierDisplayName(tier)}
          </button>
        {/each}
      </div>
    </nav>

    <div class="layout">
      <div class="main-col">
        <section class="gauges-row" aria-label="In and out slop gauges">
          <div class="panel gauge-panel">
            <div class="panel-head">
              <h2>Incoming Slop</h2>
              <span class="meta">{SPAN_LABEL[filters.timeSpan]}</span>
            </div>
            <BrassGauge value={gauges.received.aiPercent} label="Incoming messages written by AI" id="g-in" />
            <div class="gauge-stats">
              <div><span class="k">Messages</span><span class="v">{gauges.received.messageCount}</span></div>
              <div><span class="k">AI-written</span><span class="v">{gauges.received.aiWrittenCount}</span></div>
              <div><span class="k">Grenades in</span><span class="v hot">{gauges.received.grenadeCount}</span></div>
            </div>
          </div>

          <div class="panel gauge-panel">
            <div class="panel-head">
              <h2>Outgoing Slop</h2>
              <span class="meta">{SPAN_LABEL[filters.timeSpan]}</span>
            </div>
            <BrassGauge value={gauges.sent.aiPercent} label="Your messages written by AI" id="g-out" />
            <div class="gauge-stats">
              <div><span class="k">Messages</span><span class="v">{gauges.sent.messageCount}</span></div>
              <div><span class="k">AI-written</span><span class="v">{gauges.sent.aiWrittenCount}</span></div>
              <div><span class="k">Grenades out</span><span class="v hot">{gauges.sent.grenadeCount}</span></div>
            </div>
          </div>
        </section>

        <section class="panel chart-panel" aria-label="Messages by type">
          <div class="panel-head">
            <h2>Daily Damage Report</h2>
            <div class="legend">
              {#each TIER_ORDER as tier}
                <span class="leg-item"><i class="swatch" style="background: {TIER_COLOR[tier]}"></i>{tierDisplayName(tier)}</span>
              {/each}
            </div>
          </div>

          {#if buckets.length === 0}
            <p class="empty">No messages match the current filters.</p>
          {:else}
            <svg viewBox="0 0 680 220" class="bar-svg">
              <defs>
                <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="2" height="6" fill="#1b1420" fill-opacity="0.22" />
                </pattern>
              </defs>
              {#each [0, 0.25, 0.5, 0.75, 1] as frac}
                {@const y = 185 - frac * 150}
                <line x1="38" y1={y} x2="665" y2={y} stroke="#1b1420" stroke-opacity="0.18" stroke-dasharray="4 4" />
                <text x="30" y={y + 4} text-anchor="end" class="axis-txt">{Math.round(frac * maxBucketTotal)}</text>
              {/each}
              <line x1="38" y1="185" x2="665" y2="185" stroke="#1b1420" stroke-width="3" />

              {#each buckets as b, idx}
                {@const slotW = 610 / Math.max(1, buckets.length)}
                {@const barW = Math.min(34, Math.max(14, slotW * 0.56))}
                {@const barX = 48 + idx * slotW + (slotW - barW) * 0.5}
                <g
                  class="bar-group"
                  class:dimmed={selectedBucket !== null && selectedBucket !== b.label}
                  onclick={() => toggleBucketSelection(b.label)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && toggleBucketSelection(b.label)}
                >
                  {#each barSegments(b) as seg}
                    <rect x={barX} y={seg.y} width={barW} height={seg.h} fill={TIER_COLOR[seg.tier]} stroke="#1b1420" stroke-width="2">
                      <title>{b.label} &middot; {tierDisplayName(seg.tier)}: {seg.n}</title>
                    </rect>
                    {#if seg.tier === 'slop_grenade' || seg.tier === 'slop_splat'}
                      <rect x={barX} y={seg.y} width={barW} height={seg.h} fill="url(#hatch)" pointer-events="none" />
                    {/if}
                  {/each}
                  <text x={barX + barW * 0.5} y="204" text-anchor="middle" class="axis-txt">{b.label}</text>
                </g>
              {/each}
            </svg>
          {/if}
        </section>
      </div>

      <aside class="right-col">
        <section class="panel list-panel" aria-label="Top 5 Sloppers">
          <div class="panel-head">
            <h2>Most Wanted</h2>
            <span class="meta">Highest % AI</span>
          </div>
          {#if leaderboards.topSloppers.length === 0}
            <p class="empty">No people in the selected range.</p>
          {:else}
            <table class="rank-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Person</th>
                  <th class="num">Msgs</th>
                  <th class="num">AI %</th>
                </tr>
              </thead>
              <tbody>
                {#each leaderboards.topSloppers as p, i}
                  <tr class="clickable-row" class:selected-row={selectedPerson === p.name} onclick={() => togglePersonSelection(p.name)}>
                    <td><span class="coin">{i + 1}</span></td>
                    <td class="name">{p.name}</td>
                    <td class="num">{p.messageCount}</td>
                    <td class="num score-high">{p.aiSharePercent}%</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </section>

        <section class="panel list-panel" aria-label="Top 5 P-Doomers">
          <div class="panel-head">
            <h2>Hand-Crafted Heroes</h2>
            <span class="meta">Lowest % AI</span>
          </div>
          {#if leaderboards.topPDoomers.length === 0}
            <p class="empty">No people in the selected range.</p>
          {:else}
            <table class="rank-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Person</th>
                  <th class="num">Msgs</th>
                  <th class="num">AI %</th>
                </tr>
              </thead>
              <tbody>
                {#each leaderboards.topPDoomers as p, i}
                  <tr class="clickable-row" class:selected-row={selectedPerson === p.name} onclick={() => togglePersonSelection(p.name)}>
                    <td><span class="coin">{i + 1}</span></td>
                    <td class="name">{p.name}</td>
                    <td class="num">{p.messageCount}</td>
                    <td class="num score-low">{p.aiSharePercent}%</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </section>
      </aside>
    </div>

    <section class="panel grid-panel" aria-label="Selected messages">
      <div class="panel-head">
        <h2>The Ledger ({gridRows.length})</h2>
        <div class="grid-filter-pills">
          {#if selectedBucket || selectedPerson}
            <span class="meta">
              Filtered by:
              {#if selectedBucket}<strong>{selectedBucket}</strong>{/if}
              {#if selectedPerson}<strong>{selectedPerson}</strong>{/if}
            </span>
            <button class="brass small" onclick={clearCrossFilters}>Clear</button>
          {:else}
            <span class="meta">Highest slop first &middot; click a bar or person to filter</span>
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
              <th>Lex / Struct / Burst / Handoff &middot; Words</th>
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
                  <span class="score-pill" style="--pill: {gaugeWhiteToPurpleColor(row.slopScore)}">{row.slopScore}%</span>
                </td>
                <td><span class="type-tag" style="background: {TIER_COLOR[row.tier]}">{tierDisplayName(row.tier)}</span></td>
                <td class="cap">{row.app}</td>
                <td class="metrics-cell">
                  L:{row.breakdown.lexicalScore} &middot; S:{row.breakdown.structuralScore} &middot; B:{row.breakdown.burstinessScore}
                  &middot; H:{row.breakdown.handoffScore} ({row.wordCount}w)
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

    {#if rangeOpen}
      <div
        class="range-backdrop"
        role="presentation"
        onclick={(e) => {
          if (e.target === e.currentTarget) rangeOpen = false;
        }}
      >
        <div class="range-dialog" role="dialog" aria-modal="true" aria-label="Effects test range">
          <button class="brass small close-btn" aria-label="Close the test range" onclick={() => (rangeOpen = false)}>Close</button>
          <ProvingGrounds {sfx} {cue} />
        </div>
      </div>
    {/if}
  </main>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') rangeOpen = false;
  }}
/>

<style>
  .page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 22px 24px 40px;
  }

  /* ---- masthead */
  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 16px;
  }

  .nameplate {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 26px 10px 16px;
    border: 3px solid var(--ink);
    border-radius: 12px;
    background:
      var(--rivet) 5px 50% / 12px 12px no-repeat,
      var(--rivet) calc(100% - 5px) 50% / 12px 12px no-repeat,
      linear-gradient(170deg, #ffe7a0, var(--brass) 50%, #8a5a1c);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.55),
      inset 0 -4px 0 rgba(0, 0, 0, 0.25),
      6px 7px 0 rgba(0, 0, 0, 0.55);
    transform: rotate(-1deg);
  }

  .emblem {
    width: 58px;
    height: 58px;
    flex: none;
    filter: drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.4));
  }

  h1 {
    margin: 0;
    font: 44px/0.95 var(--comic);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #fff1b8;
    -webkit-text-stroke: 2.2px var(--ink);
    paint-order: stroke fill;
    text-shadow:
      3px 3px 0 var(--ink),
      5px 5px 0 #e8336d;
  }

  .sub {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #4a2c0c;
  }

  .header-tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
  }

  .refresh-btn svg {
    width: 17px;
    height: 17px;
  }

  .refresh-btn:disabled {
    cursor: progress;
    opacity: 0.7;
  }

  .refresh-btn[aria-busy='true'] svg {
    animation: refresh-spin 1.2s linear infinite;
  }

  .refresh-feedback {
    margin: 0 0 16px;
    padding: 10px 14px;
    border: 2px solid var(--brass);
    border-radius: 8px;
    color: var(--parchment);
    background: rgba(27, 20, 32, 0.7);
  }

  .refresh-feedback.error {
    border-color: var(--hot);
  }

  @keyframes refresh-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .refresh-btn[aria-busy='true'] svg {
      animation: none;
    }
  }

  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
  }

  .icon-btn svg {
    width: 24px;
    height: 24px;
  }

  .range-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(27, 20, 32, 0.6);
  }

  .range-dialog {
    position: relative;
    width: min(960px, 100%);
    max-height: calc(100vh - 40px);
    overflow: auto;
  }

  .close-btn {
    position: absolute;
    top: 14px;
    right: 18px;
    z-index: 1;
  }

  .sound-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 3px solid var(--ink);
    border-radius: 10px;
    background: rgba(27, 20, 32, 0.6);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.5);
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 14px var(--comic);
    letter-spacing: 0.06em;
    color: var(--brass-hi);
  }

  .volume.muted {
    opacity: 0.45;
  }

  .volume input {
    width: 110px;
    accent-color: var(--brass);
  }

  /* ---- filters */
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    margin-bottom: 18px;
    padding: 10px 14px;
    border: 3px solid var(--ink);
    border-radius: 10px;
    background: rgba(27, 20, 32, 0.55);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.45);
  }

  .filter-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .group-label {
    font: 15px var(--comic);
    letter-spacing: 0.08em;
    color: var(--brass-hi);
    margin-right: 2px;
  }

  .tier-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 2px solid var(--ink);
    border-radius: 3px;
  }

  /* ---- layout */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 330px;
    gap: 20px;
  }

  @media (max-width: 980px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .main-col,
  .right-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
  }

  .gauges-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 20px;
  }

  .gauge-stats {
    display: flex;
    justify-content: space-around;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 2px dashed rgba(27, 20, 32, 0.35);
  }

  .gauge-stats div {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .gauge-stats .k {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6b4a22;
  }

  .gauge-stats .v {
    font: 28px/1.1 var(--comic);
    color: var(--ink);
  }

  .gauge-stats .v.hot {
    color: var(--hot);
    -webkit-text-stroke: 1px var(--ink);
  }

  /* ---- chart */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .leg-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .bar-svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .axis-txt {
    font: 700 10px var(--body);
    fill: #4a2c0c;
  }

  .bar-group {
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .bar-group:hover rect {
    filter: brightness(1.12);
  }

  .bar-group.dimmed {
    opacity: 0.3;
  }

  /* ---- leaderboards */
  .rank-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .rank-table th {
    text-align: left;
    font: 13px var(--comic);
    letter-spacing: 0.08em;
    color: #6b4a22;
    padding: 4px 6px;
    border-bottom: 2px solid var(--ink);
  }

  .rank-table td {
    padding: 6px;
    border-bottom: 1px dashed rgba(27, 20, 32, 0.3);
  }

  .rank-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .coin {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    font: 13px var(--comic);
    background: radial-gradient(circle at 35% 30%, #fff1c2, var(--brass) 60%, var(--brass-lo));
  }

  .name {
    font-weight: 700;
  }

  .score-high {
    font: 17px var(--comic);
    color: var(--hot);
  }

  .score-low {
    font: 17px var(--comic);
    color: #2e7d32;
  }

  .clickable-row {
    cursor: pointer;
  }

  .clickable-row:hover {
    background: rgba(255, 210, 63, 0.3);
  }

  .selected-row {
    background: rgba(232, 51, 109, 0.18);
  }

  /* ---- ledger grid */
  .grid-panel {
    margin-top: 20px;
  }

  .grid-filter-pills {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .grid-scroll {
    max-height: 280px;
    overflow: auto;
    border: 2px solid var(--ink);
    border-radius: 6px;
    background: rgba(255, 252, 240, 0.6);
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
    z-index: 1;
    text-align: left;
    font: 13px var(--comic);
    letter-spacing: 0.06em;
    color: var(--brass-hi);
    background: var(--ink);
    padding: 7px 8px;
  }

  .data-grid td {
    padding: 6px 8px;
    border-bottom: 1px dashed rgba(27, 20, 32, 0.25);
    white-space: nowrap;
  }

  .data-grid .num {
    text-align: right;
  }

  .score-pill {
    display: inline-block;
    min-width: 42px;
    padding: 1px 6px;
    border: 2px solid var(--ink);
    border-radius: 999px;
    font: 14px var(--comic);
    text-align: center;
    background: var(--pill);
    color: var(--ink);
  }

  .type-tag {
    display: inline-block;
    padding: 1px 7px;
    border: 2px solid var(--ink);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    color: var(--ink);
    transform: rotate(-2deg);
  }

  .cap {
    text-transform: capitalize;
  }

  .metrics-cell {
    color: #5c4a35;
    font-size: 11px;
  }

  .preview-cell {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #5c4a35;
  }
</style>
