<script lang="ts">
  import { onMount } from 'svelte';
  import {
    FRUIT_LABELS,
    FRUIT_VARIETIES,
    createAnimationInstance,
    createSqueegeeWipe,
    stepAnimation,
    stepSqueegeeWipe,
    type ActiveAnimation,
    type FruitKind,
    type SqueegeeWipe
  } from '$lib/physics';
  import { renderAnimations } from '$lib/renderer';
  import type {
    AnimationEvent,
    AnimationTier,
    AwarenessScorecard,
    CombinedAuthStatus,
    M365App,
    MessageDirection,
    MonitorSide,
    SlopReport
  } from '$lib/types';

  let overlayOnly = $state(false);
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let viewportWidth = $state(1440);
  let viewportHeight = $state(900);

  let activeAnimations = $state<ActiveAnimation[]>([]);
  let squeegeeWipes = $state<SqueegeeWipe[]>([]);
  let selectedFruit = $state<FruitKind>('ruby_strawberry');
  let lastSeenSequence = $state(0);
  let sseConnected = $state(false);

  const leftSlopCount = $derived(
    activeAnimations.filter((a) => a.side === 'left' && a.persistentSlop && a.phase !== 'done')
      .length
  );
  const rightSlopCount = $derived(
    activeAnimations.filter((a) => a.side === 'right' && a.persistentSlop && a.phase !== 'done')
      .length
  );

  let authStatus = $state<CombinedAuthStatus | null>(null);
  let scorecard = $state<AwarenessScorecard | null>(null);
  let latestReport = $state<SlopReport | null>(null);

  // Pre-send self-awareness checker inputs
  let draftApp = $state<M365App>('teams');
  let draftDirection = $state<MessageDirection>('sent');
  let draftSender = $state('You (Self-Awareness Mirror)');
  let draftSubject = $state('Q4 Architecture Sync');
  let draftBody = $state(
    'I hope this message finds you thriving! Quick first pass from Copilot for reaction as we delve into the evolving landscape:\n\n' +
      '### Key Takeaways\n' +
      '- **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n' +
      '- **Transformative Paradigm:** Leveraging seamless, robust architectures to catalyze actionable insights.\n' +
      '- **Operational Excellence:** Streamlining our multifaceted roadmap—not only for speed, but also for scale.\n' +
      '- **Next Steps:** Please do not hesitate to reach out as we spearhead this beacon of innovation.'
  );
  let useLuna = $state(true);
  let isAnalyzing = $state(false);
  let isScanningM365 = $state(false);
  let scanStatusMessage = $state('');

  // Zero-Service-Tree Auth configuration inputs
  let githubTokenInput = $state('');
  let workiqAccountInput = $state('');
  let authActionMessage = $state('');

  let localAnimCounter = 1;

  function launchMonitorAnimation(report: SlopReport, fruitKindOverride?: FruitKind) {
    const id = localAnimCounter++;
    const instance = createAnimationInstance({
      id,
      tier: report.tier,
      side: report.monitorSide,
      direction: report.direction,
      score: report.slopScore,
      sender: report.sender,
      subject: report.subjectOrTopic,
      viewportWidth,
      viewportHeight,
      fruitKindOverride
    });
    activeAnimations = [...activeAnimations.filter((a) => a.phase !== 'done'), instance];
    latestReport = report;
  }

  function triggerSqueegee(side: MonitorSide) {
    const wipe = createSqueegeeWipe(side, viewportHeight);
    squeegeeWipes = [...squeegeeWipes.filter((w) => !w.done), wipe];
  }

  function launchSpecificFruit(kind?: FruitKind) {
    const id = localAnimCounter++;
    const side: MonitorSide = id % 2 === 0 ? 'right' : 'left';
    const instance = createAnimationInstance({
      id,
      tier: 'innocent_fruit',
      side,
      direction: side === 'right' ? 'sent' : 'received',
      score: 48,
      sender: kind ? FRUIT_LABELS[kind] : 'Random Orchard Fruit',
      subject: 'Mild AI Polish (40–59)',
      viewportWidth,
      viewportHeight,
      fruitKindOverride: kind
    });
    activeAnimations = [...activeAnimations.filter((a) => a.phase !== 'done'), instance];
  }

  function burstRandomFruits(count = 5) {
    const shuffled = [...FRUIT_VARIETIES].sort(() => Math.random() - 0.5).slice(0, count);
    const created: ActiveAnimation[] = [];
    shuffled.forEach((fruit, idx) => {
      const id = localAnimCounter++;
      const side: MonitorSide = idx % 2 === 0 ? 'left' : 'right';
      const inst = createAnimationInstance({
        id,
        tier: 'innocent_fruit',
        side,
        direction: side === 'right' ? 'sent' : 'received',
        score: 44 + idx * 3,
        sender: FRUIT_LABELS[fruit],
        subject: 'Mild AI Polish (40–59)',
        viewportWidth,
        viewportHeight,
        fruitKindOverride: fruit
      });
      // Spread multiple fruits cleanly along the vertical height so all 5 are visible at once!
      inst.impactY = Math.round(viewportHeight * (0.18 + idx * 0.14));
      inst.currentY = inst.impactY;
      created.push(inst);
    });
    activeAnimations = [...activeAnimations.filter((a) => a.phase !== 'done'), ...created];
  }

  function runFullAnimationShowcase() {
    void triggerPreset('slop_grenade');
    setTimeout(() => void triggerPreset('my_outgoing_grenade'), 550);
    setTimeout(() => burstRandomFruits(4), 1150);
    setTimeout(() => void triggerPreset('peaceful_cloud'), 1800);
    setTimeout(() => void triggerPreset('human_sparkle'), 2200);
  }

  async function refreshDashboardState() {
    try {
      const [authRes, ledgerRes] = await Promise.all([
        fetch('/api/v1/auth/status'),
        fetch('/api/v1/ledger')
      ]);
      if (authRes.ok) {
        authStatus = (await authRes.json()) as CombinedAuthStatus;
        if (authStatus.workiq.account && !workiqAccountInput) {
          workiqAccountInput = authStatus.workiq.account;
        }
      }
      if (ledgerRes.ok) {
        scorecard = (await ledgerRes.json()) as AwarenessScorecard;
        if (!latestReport && scorecard.recentReports.length > 0) {
          latestReport = scorecard.recentReports[0];
        }
      }
    } catch {
      // Daemon might still be starting up
    }
  }

  async function triggerPreset(preset: string) {
    isAnalyzing = true;
    try {
      const res = await fetch('/api/v1/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset, useLuna: false })
      });
      if (res.ok) {
        const data = (await res.json()) as { report: SlopReport; event?: AnimationEvent };
        if (!sseConnected) {
          launchMonitorAnimation(data.report);
        } else if (data.event && data.event.sequence > lastSeenSequence) {
          lastSeenSequence = data.event.sequence;
          launchMonitorAnimation(data.report);
        }
        await refreshDashboardState();
      }
    } finally {
      isAnalyzing = false;
    }
  }

  async function analyzeCustomMessage() {
    if (!draftBody.trim()) return;
    isAnalyzing = true;
    try {
      const res = await fetch('/api/v1/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: draftApp,
          direction: draftDirection,
          sender: draftSender,
          subjectOrTopic: draftSubject,
          body: draftBody,
          useLuna,
          recordInLedger: true,
          triggerAnimation: true
        })
      });
      if (res.ok) {
        const data = (await res.json()) as { report: SlopReport; event?: AnimationEvent };
        if (!sseConnected) {
          launchMonitorAnimation(data.report);
        } else if (data.event && data.event.sequence > lastSeenSequence) {
          lastSeenSequence = data.event.sequence;
          launchMonitorAnimation(data.report);
        }
        await refreshDashboardState();
      }
    } finally {
      isAnalyzing = false;
    }
  }

  async function scanM365WorkIqNow() {
    isScanningM365 = true;
    scanStatusMessage = 'Scanning M365 Teams & Outlook via WorkIQ MCP...';
    try {
      const res = await fetch('/api/v1/scan/now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useLuna })
      });
      const data = await res.json();
      if (data.ok && data.batch) {
        scanStatusMessage = `Scanned ${data.batch.fetchedCount} M365 messages (${data.batch.newMessagesAnalyzed} new, ${data.batch.grenadesTriggered} Slop Grenades)!`;
        await refreshDashboardState();
      } else {
        scanStatusMessage = data.error || 'WorkIQ scan completed with no new items.';
      }
    } catch (e) {
      scanStatusMessage = `WorkIQ scan error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      isScanningM365 = false;
    }
  }

  async function saveGithubToken() {
    const res = await fetch('/api/v1/auth/github-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: githubTokenInput.trim() || null,
        enabled: true
      })
    });
    if (res.ok) {
      authStatus = (await res.json()) as CombinedAuthStatus;
      githubTokenInput = '';
      authActionMessage = 'Updated in-memory GitHub GPT Luna credentials.';
    }
  }

  let isLoggingInWorkIq = $state(false);

  async function saveWorkIqAccount() {
    const res = await fetch('/api/v1/auth/workiq-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: workiqAccountInput.trim() || null })
    });
    if (res.ok) {
      authStatus = (await res.json()) as CombinedAuthStatus;
      authActionMessage = 'Updated WorkIQ M365 account hint.';
    }
  }

  async function triggerWorkIqLogin() {
    isLoggingInWorkIq = true;
    authActionMessage = 'Launching WorkIQ M365 interactive broker sign-in (workiq auth login)…';
    try {
      const res = await fetch('/api/v1/auth/workiq-login', { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.status) {
        authStatus = data.status as CombinedAuthStatus;
        authActionMessage = data.message || 'WorkIQ M365 authentication completed!';
      } else {
        authActionMessage = data.error || 'WorkIQ login finished—click Re-Check Auth Status.';
        await refreshDashboardState();
      }
    } catch (e) {
      authActionMessage = `WorkIQ sign-in error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      isLoggingInWorkIq = false;
    }
  }

  function loadDraftSample(kind: 'human' | 'fruit' | 'grenade') {
    if (kind === 'human') {
      draftApp = 'teams';
      draftDirection = 'sent';
      draftSender = 'You (Self-Awareness Mirror)';
      draftSubject = 'Auth PR #118';
      draftBody =
        'Hey Sarah, I pushed the fix for the WorkIQ stdio reconnect race. Can you take a quick look at line 84 before 3pm?';
    } else if (kind === 'fruit') {
      draftApp = 'outlook';
      draftDirection = 'sent';
      draftSender = 'You (Self-Awareness Mirror)';
      draftSubject = 'Sprint 14 Rollout Plan';
      draftBody =
        'I hope this email finds you well. Thank you for reaching out about the rollout timeline. Furthermore, we want to ensure a seamless handoff and unlock value for the engineering group next week.';
    } else {
      draftApp = 'teams';
      draftDirection = 'sent';
      draftSender = 'You (Self-Awareness Mirror)';
      draftSubject = 'Q4 Strategy Alignment';
      draftBody =
        'Certainly! Here is a polished draft for the channel. I hope this message finds you thriving! Quick first pass from Copilot for reaction:\n\n' +
        '### Key Takeaways\n' +
        '- **Strategic Alignment:** Fostering holistic cross-functional synergy across all pivotal workstreams.\n' +
        '- **Transformative Paradigm:** Delving into the multifaceted tapestry of our evolving landscape.\n' +
        '- **Actionable Insights:** Leveraging seamless, robust architectures to catalyze our north star.';
    }
  }

  function tierBadgeStyle(tier: AnimationTier): string {
    switch (tier) {
      case 'human_sparkle':
        return 'background: rgba(253, 230, 138, 0.16); color: #fde68a; border: 1px solid rgba(253, 230, 138, 0.45);';
      case 'peaceful_cloud':
        return 'background: rgba(125, 211, 252, 0.16); color: #7dd3fc; border: 1px solid rgba(125, 211, 252, 0.45);';
      case 'innocent_fruit':
        return 'background: rgba(253, 164, 175, 0.16); color: #fda4af; border: 1px solid rgba(253, 164, 175, 0.45);';
      case 'slop_splat':
        return 'background: rgba(250, 204, 21, 0.18); color: #facc15; border: 1px solid rgba(250, 204, 21, 0.5);';
      case 'slop_grenade':
        return 'background: rgba(163, 230, 53, 0.22); color: #bef264; border: 1px solid #a3e635; box-shadow: 0 0 14px rgba(163, 230, 53, 0.35);';
    }
  }

  function tierIcon(tier: AnimationTier): string {
    switch (tier) {
      case 'human_sparkle':
        return '✨ Human Sparkle';
      case 'peaceful_cloud':
        return '☁️ Peaceful Cloud';
      case 'innocent_fruit':
        return '🍑 Innocent Fruit';
      case 'slop_splat':
        return '🟢 Slop Splat';
      case 'slop_grenade':
        return '💣 SLOP GRENADE';
    }
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    overlayOnly = params.get('mode') === 'overlay';

    const updateSize = () => {
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    void refreshDashboardState();

    // Connect to real-time SSE stream for instant animations
    const evtSource = new EventSource('/api/v1/events/stream');
    evtSource.onopen = () => {
      sseConnected = true;
    };
    evtSource.onerror = () => {
      sseConnected = false;
    };
    evtSource.addEventListener('animation', (e: MessageEvent) => {
      try {
        const animEvent = JSON.parse(e.data) as AnimationEvent;
        if (animEvent.sequence > lastSeenSequence) {
          lastSeenSequence = animEvent.sequence;
          launchMonitorAnimation(animEvent.report);
          void refreshDashboardState();
        }
      } catch {
        // Ignore malformed event
      }
    });

    // 60fps physics + canvas animation loop
    let rafId = 0;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (activeAnimations.length > 0) {
        let changed = false;
        for (const anim of activeAnimations) {
          stepAnimation(anim, dt);
          if (anim.phase === 'done') changed = true;
        }
        if (changed) {
          activeAnimations = activeAnimations.filter((a) => a.phase !== 'done');
        }
      }

      if (squeegeeWipes.length > 0) {
        let currentAnims = activeAnimations;
        const nextWipes: SqueegeeWipe[] = [];
        for (const w of squeegeeWipes) {
          const res = stepSqueegeeWipe(w, currentAnims, dt);
          currentAnims = res.remaining;
          if (!res.wipe.done) {
            nextWipes.push(res.wipe);
          }
        }
        activeAnimations = currentAnims;
        squeegeeWipes = nextWipes;
      }

      if (canvasEl) {
        const ctx = canvasEl.getContext('2d');
        if (ctx) {
          renderAnimations(ctx, viewportWidth, viewportHeight, activeAnimations, squeegeeWipes);
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', updateSize);
      evtSource.close();
      cancelAnimationFrame(rafId);
    };
  });
</script>

<!-- Full-Viewport Physics Monitor Overlay Canvas (Click-Through) -->
<canvas
  bind:this={canvasEl}
  width={viewportWidth}
  height={viewportHeight}
  class="overlay-canvas"
  aria-label="Slop Grenade Monitor Edge Physics Overlay"
></canvas>

<!-- Floating Left & Right Monitor Edge Squeegee Buttons -->
<div class="squeegee-dock left" title="Squeegee clean incoming Brown-Red slop on Left monitor bezel">
  <button class="squeegee-btn incoming-slop" onclick={() => triggerSqueegee('left')}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2">
      <rect x="2" y="4" width="20" height="4" rx="1.5" fill="#38bdf8" stroke="#bae6fd" />
      <path d="M6 8h12l-3 4H9L6 8z" fill="#64748b" />
      <rect x="10.5" y="12" width="3" height="9" rx="1" fill="#cbd5e1" />
    </svg>
    <span>Squeegee Left ({leftSlopCount})</span>
  </button>
</div>

<div class="squeegee-dock right" title="Squeegee clean your outgoing Brown-Blue slop on Right monitor bezel">
  <button class="squeegee-btn outgoing-slop" onclick={() => triggerSqueegee('right')}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2">
      <rect x="2" y="4" width="20" height="4" rx="1.5" fill="#38bdf8" stroke="#bae6fd" />
      <path d="M6 8h12l-3 4H9L6 8z" fill="#64748b" />
      <rect x="10.5" y="12" width="3" height="9" rx="1" fill="#cbd5e1" />
    </svg>
    <span>Squeegee Right ({rightSlopCount})</span>
  </button>
</div>

{#if overlayOnly}
  <!-- Transparent Monitor Overlay HUD Mode (?mode=overlay) -->
  <div class="hud-pill">
    <div class="hud-title">
      <span class="pulse-dot {sseConnected ? 'online' : ''}"></span>
      <strong>💣 Slop Grenade HUD</strong>
      <span class="hud-sub">WorkIQ MCP + GPT Luna</span>
    </div>
    <div class="hud-actions">
      <button onclick={() => triggerPreset('human_sparkle')} title="Trigger Subtle Human Sparkles">
        ✨ Sparkle
      </button>
      <button onclick={() => triggerPreset('peaceful_cloud')} title="Trigger Peaceful Cloud">
        ☁️ Cloud
      </button>
      <button onclick={() => launchSpecificFruit()} title="Trigger Random Realistic Fruit (20 kinds)">
        🍓 Fruit
      </button>
      <button
        class="grenade-btn"
        onclick={() => triggerPreset('slop_grenade')}
        title="Throw Incoming Slop Grenade (Brown-Red Slop)!"
      >
        💣 Incoming Grenade
      </button>
      <button
        class="self-grenade-btn"
        onclick={() => triggerPreset('my_outgoing_grenade')}
        title="Throw Outgoing Slop Grenade (Brown-Blue Slop)!"
      >
        🪞 My Grenade
      </button>
      <button onclick={() => triggerSqueegee('left')} title="Squeegee Left Bezel">
        🪥 Wipe L ({leftSlopCount})
      </button>
      <button onclick={() => triggerSqueegee('right')} title="Squeegee Right Bezel">
        🪥 Wipe R ({rightSlopCount})
      </button>
      <button
        onclick={() => {
          overlayOnly = false;
          window.history.replaceState({}, '', '/');
        }}
      >
        Dashboard
      </button>
    </div>
  </div>
{:else}
  <!-- Full Self-Awareness Command Center & Live Simulator -->
  <main class="dashboard">
    <header class="top-bar">
      <div class="brand">
        <div class="logo-badge">💣</div>
        <div>
          <h1>Slop Grenade <span class="ver">v{__APP_VERSION__}</span></h1>
          <p class="subtitle">
            Real-Time Microsoft 365 AI Slop &amp; Slop Grenade Detector • Zero Service Tree
            Registration
          </p>
        </div>
      </div>

      <div class="status-pills">
        <span class="pill {authStatus?.workiq.mcpReady ? 'ok' : 'warn'}">
          WorkIQ MCP: {authStatus?.workiq.mcpReady
            ? `${authStatus.workiq.mcpToolCount} M365 Tools Ready`
            : authStatus?.workiq.binaryFound
              ? 'Auth Needed'
              : 'Standby'}
        </span>
        <span class="pill {authStatus?.githubLuna.authenticated ? 'ok' : 'warn'}">
          GitHub {authStatus?.githubLuna.model ?? 'gpt-5.6-luna'}:
          {authStatus?.githubLuna.authenticated
            ? `Ready (${authStatus.githubLuna.githubLogin ?? authStatus.githubLuna.tokenSource})`
            : 'Offline Heuristic'}
        </span>
        <button class="showcase-btn" onclick={runFullAnimationShowcase}>
          🎬 Showcase All Animations
        </button>
        <button class="scan-btn" onclick={scanM365WorkIqNow} disabled={isScanningM365}>
          {isScanningM365 ? 'Scanning M365…' : '🔄 Scan M365 Now'}
        </button>
        <button
          class="overlay-toggle-btn"
          onclick={() => {
            overlayOnly = true;
            window.history.replaceState({}, '', '/?mode=overlay');
          }}
        >
          🖥️ Transparent Overlay HUD
        </button>
      </div>
    </header>

    {#if scanStatusMessage}
      <div class="banner-notice">{scanStatusMessage}</div>
    {/if}

    <!-- 5-Tier Instant Monitor Animation Launcher -->
    <section class="launcher-strip" aria-label="5-Tier Monitor Animation Launcher">
      <div class="strip-header">
        <h2>🎯 Test Monitor Edge Animations (Builds Up on Each Side Until Squeegeed!)</h2>
        <span class="strip-hint">
          Incoming slop is <strong>Brown-Red (Left Bezel)</strong> • Slop you throw is
          <strong>Brown-Blue (Right Bezel)</strong> • Grenades are <strong>Dull Metallic Blue</strong>.
        </span>
      </div>
      <div class="tier-buttons">
        <button class="tier-card sparkle" onclick={() => triggerPreset('human_sparkle')}>
          <span class="t-score">0–19 • Human</span>
          <strong>✨ Subtle Sparkle Plume</strong>
          <small>Hardly visible stardust for authentic human typing</small>
        </button>

        <button class="tier-card cloud" onclick={() => triggerPreset('peaceful_cloud')}>
          <span class="t-score">20–39 • Calm</span>
          <strong>☁️ Peaceful Cloud</strong>
          <small>Serene drifting cloud for light prose polish</small>
        </button>

        <button class="tier-card fruit" onclick={() => launchSpecificFruit()}>
          <span class="t-score">40–59 • 20 Varieties</span>
          <strong>🍓 Random Realistic Fruit</strong>
          <small>Randomly launches 1 of 20 artistic botanical fruits</small>
        </button>

        <button class="tier-card splat" onclick={() => triggerPreset('slop_splat')}>
          <span class="t-score">60–79 • Heavy Slop</span>
          <strong>💩 Dripping Poop-Slop Splat</strong>
          <small>Thick lumpy sludge caked onto the monitor edge</small>
        </button>

        <button class="tier-card grenade" onclick={() => triggerPreset('slop_grenade')}>
          <span class="t-score">80–100 • Incoming (Left)</span>
          <strong>💣 Received Slop Grenade!</strong>
          <small>Dull metallic blue grenade → Brown-Red poop slop!</small>
        </button>

        <button
          class="tier-card self-grenade"
          onclick={() => triggerPreset('my_outgoing_grenade')}
        >
          <span class="t-score">80–100 • Outgoing (Right)</span>
          <strong>🪞 My Thrown Slop Grenade!</strong>
          <small>Dull metallic blue grenade → Brown-Blue poop slop!</small>
        </button>
      </div>

      <!-- 20-Fruit Botanical Studio & Squeegee Control Bar -->
      <div class="fruit-squeegee-bar">
        <div class="fruit-picker-group">
          <span class="bar-label">🍍 20 Artistic Fruit Varieties:</span>
          <select bind:value={selectedFruit} aria-label="Select one of 20 fruit varieties">
            {#each FRUIT_VARIETIES as kind}
              <option value={kind}>{FRUIT_LABELS[kind]}</option>
            {/each}
          </select>
          <button class="mini-action-btn" onclick={() => launchSpecificFruit(selectedFruit)}>
            Launch {FRUIT_LABELS[selectedFruit]}
          </button>
          <button class="mini-action-btn highlight" onclick={() => burstRandomFruits(5)}>
            🧺 Burst 5 Random Fruits!
          </button>
        </div>

        <div class="squeegee-group">
          <span class="bar-label">🪥 Monitor Bezel Squeegee:</span>
          <button
            class="mini-squeegee-btn left-tone"
            onclick={() => triggerSqueegee('left')}
          >
            🪥 Squeegee Left Brown-Red ({leftSlopCount})
          </button>
          <button
            class="mini-squeegee-btn right-tone"
            onclick={() => triggerSqueegee('right')}
          >
            🪥 Squeegee Right Brown-Blue ({rightSlopCount})
          </button>
        </div>
      </div>
    </section>

    <!-- Self-Awareness Mirror: Sent by Me vs Received by Me -->
    <section class="scorecard-grid">
      <div class="card mirror-card self">
        <div class="card-head">
          <h3>🪞 My Outgoing Communication Footprint (Sent by Me)</h3>
          <span class="streak-pill">
            🔥 Clean Human Streak: <strong>{scorecard?.sentByMe.cleanHumanStreak ?? 0}</strong>
          </span>
        </div>
        <div class="metrics-row">
          <div class="metric">
            <span class="m-val">{scorecard?.sentByMe.averageSlopScore ?? 0}<small>/100</small></span>
            <span class="m-lbl">My Avg Slop Score</span>
          </div>
          <div class="metric danger">
            <span class="m-val">{scorecard?.sentByMe.slopGrenades ?? 0}</span>
            <span class="m-lbl">💣 Grenades I Threw</span>
          </div>
          <div class="metric good">
            <span class="m-val">{scorecard?.sentByMe.humanSparkles ?? 0}</span>
            <span class="m-lbl">✨ Pure Human Sparkles</span>
          </div>
          <div class="metric">
            <span class="m-val">
              {(scorecard?.sentByMe.peacefulClouds ?? 0) +
                (scorecard?.sentByMe.innocentFruits ?? 0)}
            </span>
            <span class="m-lbl">☁️/🍑 Clouds &amp; Fruits</span>
          </div>
        </div>
      </div>

      <div class="card mirror-card incoming">
        <div class="card-head">
          <h3>📨 Incoming M365 Workplace Weather (Received by Me)</h3>
          <span class="streak-pill">
            Total Scanned: <strong>{scorecard?.receivedByMe.totalMessages ?? 0}</strong>
          </span>
        </div>
        <div class="metrics-row">
          <div class="metric">
            <span class="m-val">
              {scorecard?.receivedByMe.averageSlopScore ?? 0}<small>/100</small>
            </span>
            <span class="m-lbl">Incoming Avg Slop</span>
          </div>
          <div class="metric danger">
            <span class="m-val">{scorecard?.receivedByMe.slopGrenades ?? 0}</span>
            <span class="m-lbl">💣 Grenades Thrown at Me</span>
          </div>
          <div class="metric good">
            <span class="m-val">{scorecard?.receivedByMe.humanSparkles ?? 0}</span>
            <span class="m-lbl">✨ Human Sparkles</span>
          </div>
          <div class="metric">
            <span class="m-val">
              {(scorecard?.receivedByMe.peacefulClouds ?? 0) +
                (scorecard?.receivedByMe.innocentFruits ?? 0)}
            </span>
            <span class="m-lbl">☁️/🍑 Clouds &amp; Fruits</span>
          </div>
        </div>
      </div>
    </section>

    <div class="verdict-banner">
      <strong>🧠 Self-Awareness Verdict:</strong>
      <span>
        {scorecard?.selfAwarenessVerdict ??
          'Trigger a preset or analyze a draft below to begin tracking your communication footprint.'}
      </span>
    </div>

    <!-- Main Two-Column Workspace: Pre-Send Checker + Live Inspection -->
    <div class="workspace-grid">
      <!-- Left Column: Pre-Send Slop & Grenade Checker -->
      <section class="card analyzer-card">
        <div class="card-head">
          <h3>🧪 Pre-Send Slop &amp; Grenade Check ("Am I About to Throw a Grenade?")</h3>
          <div class="sample-pills">
            <button onclick={() => loadDraftSample('human')}>Load Human Sample</button>
            <button onclick={() => loadDraftSample('fruit')}>Load Mild AI Sample</button>
            <button onclick={() => loadDraftSample('grenade')}>Load Grenade Sample</button>
          </div>
        </div>

        <div class="form-row">
          <label>
            M365 App
            <select bind:value={draftApp}>
              <option value="teams">Microsoft Teams</option>
              <option value="outlook">Microsoft Outlook</option>
              <option value="share_point">SharePoint</option>
              <option value="word">Word Comment</option>
              <option value="copilot_chat">M365 Copilot</option>
            </select>
          </label>

          <label>
            Direction
            <select bind:value={draftDirection}>
              <option value="sent">Outgoing (Sent by Me — Right Bezel)</option>
              <option value="received">Incoming (Received — Left Bezel)</option>
            </select>
          </label>

          <label>
            Topic / Subject
            <input type="text" bind:value={draftSubject} />
          </label>
        </div>

        <label class="body-label">
          Message Body (Teams message or Outlook email)
          <textarea rows="7" bind:value={draftBody}></textarea>
        </label>

        <div class="analyzer-footer">
          <label class="checkbox-lbl">
            <input type="checkbox" bind:checked={useLuna} />
            Include live GitHub <strong>GPT Luna (gpt-5.6-luna)</strong> semantic evaluation
          </label>

          <button class="primary-btn" onclick={analyzeCustomMessage} disabled={isAnalyzing}>
            {isAnalyzing ? 'Analyzing…' : '💥 Analyze & Launch Monitor Animation'}
          </button>
        </div>
      </section>

      <!-- Right Column: Latest Diagnostic Report & Coaching -->
      <section class="card diagnostic-card">
        <div class="card-head">
          <h3>🔬 Latest Message Diagnostic &amp; Self-Coaching</h3>
          {#if latestReport}
            <span class="tier-badge" style={tierBadgeStyle(latestReport.tier)}>
              {tierIcon(latestReport.tier)} • {latestReport.slopScore}/100
            </span>
          {/if}
        </div>

        {#if latestReport}
          <p class="report-summary">{latestReport.summary}</p>

          <div class="coaching-box">
            <strong>💡 Self-Awareness Coaching Tip:</strong>
            <p>{latestReport.selfAwarenessTip}</p>
          </div>

          <div class="subscore-grid">
            <div class="subscore">
              <span>Lexical Clichés</span>
              <strong>{latestReport.breakdown.lexicalScore}/100</strong>
            </div>
            <div class="subscore">
              <span>Structural Symmetry</span>
              <strong>{latestReport.breakdown.structuralScore}/100</strong>
            </div>
            <div class="subscore">
              <span>Low Burstiness</span>
              <strong>{latestReport.breakdown.burstinessScore}/100</strong>
            </div>
            <div class="subscore">
              <span>Handoff / Channel</span>
              <strong>{latestReport.breakdown.handoffScore}/100</strong>
            </div>
            <div class="subscore luna">
              <span>GPT Luna Score</span>
              <strong>
                {latestReport.breakdown.lunaScore !== null
                  ? `${latestReport.breakdown.lunaScore}/100`
                  : 'Heuristic Only'}
              </strong>
            </div>
          </div>

          <div class="signals-list">
            <h4>Detected Slop &amp; Grenade Signals ({latestReport.signals.length})</h4>
            {#if latestReport.signals.length === 0}
              <p class="clean-note">
                ✨ Zero AI slop markers detected! Natural human rhythm, vocabulary, and brevity.
              </p>
            {:else}
              <ul>
                {#each latestReport.signals as sig}
                  <li>
                    <span class="sig-weight">+{sig.weight}</span>
                    <span class="sig-label">{sig.label}</span>
                    <code>{sig.excerpt}</code>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else}
          <p class="empty-state">
            Click any tier button above or analyze a draft message to inspect its linguistic and
            structural breakdown.
          </p>
        {/if}
      </section>
    </div>

    <!-- Bottom Row: Zero-Service-Tree Auth Panel + Recent M365 Feed -->
    <div class="workspace-grid bottom-grid">
      <section class="card auth-card">
        <div class="card-head">
          <h3>🔐 Zero-Service-Tree Authentication (WorkIQ MCP + GitHub GPT Luna)</h3>
          <span class="zero-st-badge">Service Tree Required: FALSE</span>
        </div>

        <div class="auth-block">
          <h4>1. Microsoft 365 WorkIQ MCP Server</h4>
          <p class="auth-desc">{authStatus?.workiq.message ?? 'Checking WorkIQ CLI…'}</p>
          <div class="inline-input">
            <input
              type="email"
              placeholder="Optional M365 email (e.g. user@contoso.com)"
              bind:value={workiqAccountInput}
            />
            <button onclick={saveWorkIqAccount}>Set Account</button>
            <button onclick={triggerWorkIqLogin} disabled={isLoggingInWorkIq}>
              {isLoggingInWorkIq ? 'Signing In…' : '🔑 Sign In (workiq auth login)'}
            </button>
          </div>
        </div>

        <div class="auth-block">
          <h4>2. GitHub Account for GPT Luna (<code>gpt-5.6-luna</code>)</h4>
          <p class="auth-desc">{authStatus?.githubLuna.message ?? 'Checking GitHub CLI…'}</p>
          <div class="inline-input">
            <input
              type="password"
              placeholder="Optional in-memory GitHub token override (never saved to disk)"
              bind:value={githubTokenInput}
            />
            <button onclick={saveGithubToken}>Apply Token</button>
            <button onclick={refreshDashboardState}>🔄 Re-Check Auth</button>
          </div>
        </div>

        {#if authActionMessage}
          <p class="auth-feedback">{authActionMessage}</p>
        {/if}
      </section>

      <section class="card feed-card">
        <div class="card-head">
          <h3>📡 Recent M365 Communication Feed ({scorecard?.recentReports.length ?? 0})</h3>
        </div>
        <div class="feed-list">
          {#if !scorecard || scorecard.recentReports.length === 0}
            <p class="empty-state">No communications analyzed yet in this session.</p>
          {:else}
            {#each scorecard.recentReports as item (item.messageId)}
              <div class="feed-item">
                <div class="feed-meta">
                  <span class="tier-badge" style={tierBadgeStyle(item.tier)}>
                    {tierIcon(item.tier)} ({item.slopScore})
                  </span>
                  <strong>{item.direction === 'sent' ? '📤 Sent' : '📥 Received'}</strong>
                  <span>• {item.app.toUpperCase()}</span>
                  <span>• {item.sender}</span>
                </div>
                <p class="feed-preview">{item.redactedPreview}</p>
                <div class="feed-actions">
                  <small>{item.selfAwarenessTip}</small>
                  <button onclick={() => launchMonitorAnimation(item)}>Replay Animation</button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </section>
    </div>
  </main>
{/if}

<style>
  :global(body) {
    font-family:
      'Segoe UI',
      -apple-system,
      BlinkMacSystemFont,
      system-ui,
      sans-serif;
    color: #f1f5f9;
    background: #070b12;
  }

  .overlay-canvas {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 9999;
  }

  .squeegee-dock {
    position: fixed;
    top: 14px;
    z-index: 10001;
  }

  .squeegee-dock.left {
    left: 14px;
  }

  .squeegee-dock.right {
    right: 14px;
  }

  .squeegee-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 13px;
    border-radius: 99px;
    font-size: 0.78rem;
    font-weight: 700;
    color: #f8fafc;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(8px);
    transition: transform 0.12s ease;
  }

  .squeegee-btn:hover {
    transform: scale(1.04);
  }

  .squeegee-btn.incoming-slop {
    background: linear-gradient(135deg, rgba(88, 32, 20, 0.92), rgba(30, 41, 59, 0.94));
    border: 1px solid #f87171;
  }

  .squeegee-btn.outgoing-slop {
    background: linear-gradient(135deg, rgba(42, 62, 84, 0.92), rgba(58, 48, 38, 0.94));
    border: 1px solid #60a5fa;
  }

  .showcase-btn {
    background: linear-gradient(135deg, #2b3d4f, #1e293b);
    color: #e0f2fe;
    border: 1px solid #60a5fa;
    padding: 7px 13px;
    border-radius: 10px;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }

  .fruit-squeegee-bar {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid #1e293b;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .fruit-picker-group,
  .squeegee-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .bar-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #cbd5e1;
  }

  .mini-action-btn,
  .mini-squeegee-btn {
    background: #1e293b;
    color: #f8fafc;
    border: 1px solid #475569;
    border-radius: 8px;
    padding: 6px 11px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mini-action-btn.highlight {
    background: rgba(244, 63, 94, 0.18);
    border-color: #fb7185;
    color: #ffe4e6;
  }

  .mini-squeegee-btn.left-tone {
    background: rgba(88, 32, 20, 0.65);
    border-color: #f87171;
    color: #fecaca;
  }

  .mini-squeegee-btn.right-tone {
    background: rgba(42, 62, 84, 0.65);
    border-color: #60a5fa;
    color: #bfdbfe;
  }

  .hud-pill {
    position: fixed;
    bottom: 18px;
    right: 18px;
    z-index: 10000;
    background: rgba(10, 15, 26, 0.92);
    border: 1px solid rgba(163, 230, 53, 0.55);
    border-radius: 16px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(10px);
  }

  .hud-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
  }

  .hud-sub {
    color: #94a3b8;
    font-size: 0.78rem;
  }

  .hud-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .hud-actions button {
    background: #1e293b;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 5px 10px;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .hud-actions button.grenade-btn {
    background: #365314;
    border-color: #a3e635;
    color: #ecfccb;
    font-weight: 600;
  }

  .pulse-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #f59e0b;
  }

  .pulse-dot.online {
    background: #84cc16;
    box-shadow: 0 0 8px #84cc16;
  }

  .dashboard {
    max-width: 1360px;
    margin: 0 auto;
    padding: 20px 32px 48px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(20, 34, 18, 0.9));
    border: 1px solid rgba(163, 230, 53, 0.3);
    border-radius: 16px;
    padding: 16px 22px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .logo-badge {
    font-size: 2.1rem;
    background: rgba(163, 230, 53, 0.16);
    border: 1px solid rgba(163, 230, 53, 0.45);
    border-radius: 14px;
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h1 {
    margin: 0;
    font-size: 1.45rem;
    letter-spacing: -0.02em;
  }

  .ver {
    font-size: 0.78rem;
    color: #a3e635;
    background: rgba(163, 230, 53, 0.14);
    padding: 2px 8px;
    border-radius: 99px;
    vertical-align: middle;
  }

  .subtitle {
    margin: 4px 0 0;
    color: #94a3b8;
    font-size: 0.86rem;
  }

  .status-pills {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pill {
    font-size: 0.78rem;
    padding: 6px 11px;
    border-radius: 99px;
    font-weight: 600;
  }

  .pill.ok {
    background: rgba(132, 204, 22, 0.16);
    color: #bef264;
    border: 1px solid rgba(132, 204, 22, 0.4);
  }

  .pill.warn {
    background: rgba(245, 158, 11, 0.16);
    color: #fde68a;
    border: 1px solid rgba(245, 158, 11, 0.4);
  }

  .scan-btn,
  .overlay-toggle-btn {
    background: #1e293b;
    color: #f8fafc;
    border: 1px solid #475569;
    padding: 7px 13px;
    border-radius: 10px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .scan-btn:hover,
  .overlay-toggle-btn:hover {
    border-color: #a3e635;
  }

  .banner-notice {
    background: rgba(132, 204, 22, 0.15);
    border: 1px solid rgba(163, 230, 53, 0.45);
    color: #ecfccb;
    padding: 10px 16px;
    border-radius: 10px;
    font-size: 0.88rem;
  }

  .launcher-strip {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid #1e293b;
    border-radius: 16px;
    padding: 16px 20px;
  }

  .strip-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  .strip-header h2 {
    margin: 0;
    font-size: 1.02rem;
  }

  .strip-hint {
    font-size: 0.82rem;
    color: #94a3b8;
  }

  .tier-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
    gap: 10px;
  }

  .tier-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 12px;
    background: #0f172a;
    border: 1px solid #334155;
    color: #f1f5f9;
    text-align: left;
    cursor: pointer;
    transition:
      transform 0.12s ease,
      border-color 0.12s ease;
  }

  .tier-card:hover {
    transform: translateY(-2px);
  }

  .tier-card .t-score {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.8;
  }

  .tier-card small {
    font-size: 0.75rem;
    color: #94a3b8;
    line-height: 1.3;
  }

  .tier-card.sparkle:hover {
    border-color: #fde68a;
  }
  .tier-card.cloud:hover {
    border-color: #7dd3fc;
  }
  .tier-card.fruit:hover {
    border-color: #fda4af;
  }
  .tier-card.splat:hover {
    border-color: #facc15;
  }
  .tier-card.grenade {
    background: linear-gradient(135deg, rgba(54, 83, 20, 0.55), rgba(15, 23, 42, 0.95));
    border-color: #84cc16;
  }
  .tier-card.self-grenade {
    background: linear-gradient(135deg, rgba(124, 45, 18, 0.5), rgba(15, 23, 42, 0.95));
    border-color: #fb923c;
  }

  .scorecard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 16px;
  }

  .card {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid #1e293b;
    border-radius: 16px;
    padding: 18px 20px;
  }

  .mirror-card.self {
    border-color: rgba(56, 189, 248, 0.35);
  }

  .mirror-card.incoming {
    border-color: rgba(163, 230, 53, 0.35);
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }

  .card-head h3 {
    margin: 0;
    font-size: 1rem;
  }

  .streak-pill {
    font-size: 0.8rem;
    background: rgba(30, 41, 59, 0.9);
    padding: 4px 10px;
    border-radius: 99px;
    border: 1px solid #334155;
  }

  .metrics-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }

  .metric {
    background: rgba(2, 6, 23, 0.65);
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .metric.danger {
    border-color: rgba(163, 230, 53, 0.4);
  }

  .metric.good {
    border-color: rgba(253, 230, 138, 0.35);
  }

  .m-val {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .m-val small {
    font-size: 0.8rem;
    color: #64748b;
  }

  .m-lbl {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .verdict-banner {
    background: linear-gradient(90deg, rgba(30, 41, 59, 0.9), rgba(54, 83, 20, 0.4));
    border: 1px solid rgba(163, 230, 53, 0.4);
    border-radius: 12px;
    padding: 12px 18px;
    font-size: 0.9rem;
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .workspace-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
    gap: 16px;
  }

  .sample-pills {
    display: flex;
    gap: 6px;
  }

  .sample-pills button {
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 4px 9px;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .form-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 12px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 0.8rem;
    color: #cbd5e1;
  }

  input,
  select,
  textarea {
    background: #020617;
    color: #f8fafc;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 0.86rem;
  }

  .body-label {
    margin-bottom: 12px;
  }

  .analyzer-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .checkbox-lbl {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .primary-btn {
    background: linear-gradient(135deg, #65a30d, #4d7c0f);
    color: #f7fee7;
    border: 1px solid #a3e635;
    border-radius: 10px;
    padding: 10px 16px;
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
  }

  .tier-badge {
    padding: 4px 10px;
    border-radius: 99px;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .report-summary {
    margin: 0 0 12px;
    font-size: 0.92rem;
    color: #e2e8f0;
  }

  .coaching-box {
    background: rgba(54, 83, 20, 0.28);
    border-left: 4px solid #a3e635;
    padding: 10px 14px;
    border-radius: 8px;
    margin-bottom: 14px;
  }

  .coaching-box p {
    margin: 4px 0 0;
    font-size: 0.86rem;
    color: #ecfccb;
  }

  .subscore-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }

  .subscore {
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 0.73rem;
    color: #94a3b8;
  }

  .subscore strong {
    font-size: 0.95rem;
    color: #f1f5f9;
  }

  .subscore.luna {
    border-color: rgba(163, 230, 53, 0.35);
  }

  .signals-list h4 {
    margin: 0 0 8px;
    font-size: 0.85rem;
    color: #cbd5e1;
  }

  .signals-list ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 165px;
    overflow-y: auto;
  }

  .signals-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    background: rgba(2, 6, 23, 0.6);
    padding: 6px 10px;
    border-radius: 8px;
  }

  .sig-weight {
    background: rgba(163, 230, 53, 0.2);
    color: #bef264;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 0.74rem;
  }

  .signals-list code {
    margin-left: auto;
    color: #94a3b8;
    font-size: 0.75rem;
  }

  .zero-st-badge {
    background: rgba(16, 185, 129, 0.16);
    color: #6ee7b7;
    border: 1px solid rgba(16, 185, 129, 0.4);
    padding: 3px 10px;
    border-radius: 99px;
    font-size: 0.74rem;
    font-weight: 700;
  }

  .auth-block {
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #1e293b;
  }

  .auth-block h4 {
    margin: 0 0 4px;
    font-size: 0.88rem;
  }

  .auth-desc {
    margin: 0 0 8px;
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .inline-input {
    display: flex;
    gap: 8px;
  }

  .inline-input input {
    flex: 1;
  }

  .inline-input button {
    background: #1e293b;
    color: #f1f5f9;
    border: 1px solid #475569;
    border-radius: 8px;
    padding: 0 14px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .feed-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 290px;
    overflow-y: auto;
  }

  .feed-item {
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 10px 12px;
  }

  .feed-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 0.78rem;
    margin-bottom: 6px;
  }

  .feed-preview {
    margin: 0 0 8px;
    font-size: 0.82rem;
    color: #cbd5e1;
  }

  .feed-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .feed-actions small {
    color: #94a3b8;
    font-size: 0.75rem;
  }

  .feed-actions button {
    background: #1e293b;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 4px 9px;
    font-size: 0.74rem;
    cursor: pointer;
    white-space: nowrap;
  }
</style>
