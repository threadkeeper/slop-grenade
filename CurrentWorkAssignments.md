# Current Work Assignments — Slop Grenade

This ledger defines the dependency-ordered, test-driven work packets coordinated by [`slop-orchestrator`](.github/agents/slop-orchestrator.agent.md) through its four stateless specialists (`slop-architect`, `slop-developer`, `slop-tester`, `slop-reviewer`).

## Global Rules

- **No Service Tree Registration**: Authentication to Microsoft 365 uses the standalone **WorkIQ MCP** CLI/stdio server (`workiq auth login`, `workiq mcp`, `workiq fetch`), and LLM inference uses the user's **GitHub account** (`gh auth token` / `GITHUB_TOKEN`) against `https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"`.
- **Privacy First**: Never commit, log, or persist raw personal emails, Teams messages, or bearer tokens to disk or Git. The in-memory `AwarenessLedger` stores only sanitized metadata, slop scores, signal tags, and short redacted previews in memory.
- **Test-Driven Verification**: Every packet must include deterministic unit and/or integration tests that prove the behavior works before the packet is marked complete.

---

## Work Packets

### WP01 — Slop & Grenade Detection Engine (`rust/src/slop_detector.rs`)
- **Status**: `done` (target)
- **Owned Paths**: `rust/Cargo.toml`, `rust/src/lib.rs`, `rust/src/slop_detector.rs`
- **Dependencies**: None
- **Acceptance Criteria**:
  1. Scores any communication (`0..=100`) across four deterministic signal families (`lexical_cliches`, `structural_symmetry`, `low_burstiness`, `passive_handoff`) plus optional `luna_semantic_score`.
  2. Maps scores deterministically to the 5 animation tiers:
     - `0..=19` → `AnimationTier::HumanSparkle` (barely visible plumes of sparkles)
     - `20..=39` → `AnimationTier::PeacefulCloud` (serene drifting cloud)
     - `40..=59` → `AnimationTier::InnocentFruit` (innocent bouncing fruit)
     - `60..=79` → `AnimationTier::SlopSplat` (wobbly gelatinous splat)
     - `80..=100` → `AnimationTier::SlopGrenade` (hand grenade splatting against monitor bezel & sliding down as squishy goop)
  3. Generates actionable, constructive self-awareness coaching tips (especially tailored when `direction == MessageDirection::Sent`).
  4. 100% unit test coverage of all 5 tiers and edge cases.

### WP02 — Zero-Service-Tree Auth, WorkIQ MCP & GitHub GPT Luna (`rust/src/auth.rs`, `rust/src/workiq_mcp.rs`, `rust/src/llm_luna.rs`)
- **Status**: `done` (target)
- **Owned Paths**: `rust/src/config.rs`, `rust/src/auth.rs`, `rust/src/workiq_mcp.rs`, `rust/src/llm_luna.rs`
- **Dependencies**: `WP01`
- **Acceptance Criteria**:
  1. `WorkIqClient` discovers the local `workiq` executable (or configured path), checks authentication readiness, and fetches recent M365 emails (`/me/mailFolders/inbox/messages`, `/me/mailFolders/sentitems/messages`) and Teams chat messages (`/me/chats`, `/me/chats/{id}/messages`) via WorkIQ MCP JSON-RPC stdio (`tools/call` -> `fetch` / `retrieve`) or CLI `workiq fetch`.
  2. `LunaClient` resolves GitHub auth via `GITHUB_TOKEN`, runtime-supplied session token, or `gh auth token`, and calls `POST https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"` to produce structured JSON slop evaluations.
  3. Gracefully falls back to deterministic scoring if WorkIQ or GitHub token is temporarily unavailable, without panicking or blocking.
  4. Unit tests verify MCP JSON-RPC framing, Graph payload parsing (Teams & Outlook, Sent vs. Received), and GPT Luna response decoding.

### WP03 — M365 Scanner Daemon, Event Bus & Self-Awareness Ledger (`rust/src/scanner_daemon.rs`, `rust/src/event_bus.rs`, `rust/src/ledger.rs`)
- **Status**: `done` (target)
- **Owned Paths**: `rust/src/event_bus.rs`, `rust/src/ledger.rs`, `rust/src/scanner_daemon.rs`
- **Dependencies**: `WP01`, `WP02`
- **Acceptance Criteria**:
  1. `ScannerDaemon` polls WorkIQ MCP for new sent and received Teams & Outlook messages, deduplicates by message ID, scores each message (combining deterministic heuristics + GPT Luna when enabled), records it in `AwarenessLedger`, and broadcasts an `AnimationEvent` on `AnimationEventBus`.
  2. `AwarenessLedger` computes separate metrics for **Sent by Me** vs. **Received by Me** (total messages, average slop score, grenades thrown by me, grenades received, clean human sparkle streak, and recent sanitized events).
  3. Unit tests verify deduplication, sent/received scorecard calculations, and SSE broadcast fan-out.

### WP04 — Axum HTTP/SSE Server & Integration Tests (`rust/src/server.rs`, `rust/src/main.rs`, `rust/tests/api_integration.rs`)
- **Status**: `done` (target)
- **Owned Paths**: `rust/src/server.rs`, `rust/src/static_files.rs`, `rust/src/main.rs`, `rust/tests/api_integration.rs`
- **Dependencies**: `WP03`
- **Acceptance Criteria**:
  1. Serves `/api/v1/health`, `/api/v1/auth/status`, `/api/v1/auth/github-token`, `/api/v1/auth/workiq-login`, `/api/v1/analyze` (with optional live GPT Luna pass), `/api/v1/simulate` (triggers live monitor animations for any tier or sample message), `/api/v1/scan/now` (triggers an immediate WorkIQ M365 scan), `/api/v1/ledger` (returns self-awareness scorecard + feed), and `/api/v1/events/stream` (Server-Sent Events for instant overlay animations).
  2. Integration tests in `rust/tests/api_integration.rs` exercise every endpoint end-to-end.

### WP05 — Svelte 5 Monitor Overlay, Squishy Goop Physics & Awareness UI (`web/`)
- **Status**: `done` (target)
- **Owned Paths**: `web/**`
- **Dependencies**: `WP04`
- **Acceptance Criteria**:
  1. Physics engine (`web/src/lib/physics.ts`) implements:
     - **Slop Grenade (`80–100`)**: Parabolic grenade launch toward left or right monitor bezel, impact flash + screen shake, and a multi-blob **squishy chartreuse/slime goop splat** with viscous metaball drips that slowly slide down the side of the monitor leaving a translucent slime trail.
     - **Slop Splat (`60–79`)**: Wobbly amber-green gelatinous splat on the screen edge.
     - **Innocent Fruit (`40–59`)**: Bouncing peach/citrus/berry with soft juice droplets.
     - **Peaceful Cloud (`20–39`)**: Fluffy pastel cloud drifting calmly across the upper monitor edge.
     - **Human Sparkle (`0–19`)**: Barely visible, delicate plumes of warm sparkles rising gently at the screen edge.
  2. Supports both **Full Dashboard Mode (`/`)** (Self-Awareness Scorecard, Sent vs. Received mirror, Live Draft Pre-Send Checker, WorkIQ + GitHub GPT Luna Auth Status, One-Click Tier Triggers) and **Transparent Monitor Overlay HUD Mode (`/?mode=overlay`)**.
  3. Vitest suite (`npm --prefix web test`), `svelte-check`, `eslint`, and `vite build` pass with zero errors.

### WP06 — Packaging, Private-Tenant Cloud Bicep, Overlay Launcher & Live E2E Verification
- **Status**: `done` (target)
- **Owned Paths**: `Dockerfile`, `infra/main.bicep`, `scripts/launch-overlay.ps1`, `.githooks/*`, `scripts/bump-version.sh`, `README.md`
- **Dependencies**: `WP05`
- **Acceptance Criteria**:
  1. Multi-stage `Dockerfile` and `infra/main.bicep` ready for private-tenant Container App deployment.
  2. `scripts/launch-overlay.ps1` starts the local daemon and opens the monitor overlay.
  3. All Rust (`cargo fmt`, `cargo clippy`, `cargo test`) and Web (`npm test`, `npm run check`, `npm run build`) checks pass, and live browser inspection confirms the animations and API work end-to-end.
