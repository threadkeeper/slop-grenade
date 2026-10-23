# Slop Grenade — Architecture & Test-Driven Build Plan

## 1. Vision & End Goal

**Slop Grenade** is a standalone, zero-Service-Tree M365 communication awareness daemon and monitor overlay. It continuously scans a user's sent and received Microsoft 365 communications (Microsoft Teams chats/channels and Outlook emails) through their personal **WorkIQ MCP** server, scores each message using a hybrid **Deterministic Heuristic + GitHub GPT Luna (`gpt-5.6-luna`)** engine, and triggers real-time physics animations on the monitor:

- **Real Human Communication (`0–19`)**: Small, barely visible plumes of warm sparkles (`HumanSparkle`).
- **Light AI Polish (`20–39`)**: A small, peaceful drifting cloud (`PeacefulCloud`).
- **Moderate AI Assist (`40–59`)**: An innocent, cheerful fruit (`InnocentFruit`) hopping softly along the screen edge.
- **Heavy Corporate Slop (`60–79`)**: A wobbly gelatinous slop splat (`SlopSplat`).
- **Slop Grenade (`80–100`)**: A tumbling hand grenade (`SlopGrenade`) that splats against the side of the monitor and slides down like a squishy, sloppy mess of goop.

Crucially, **every communication the user sends or receives** is evaluated, with dedicated **"My Outgoing Slop Footprint"** tracking so the user becomes acutely aware of their own AI slop and grenade habits before they become "that colleague."

---

## 2. Alignment with Threadkeeper Standard Tech Stack & Design Patterns

Following the established architecture across `gaia-robot`, `tco-calculator`, `db-modernisation-fy27`, and `elle-companion`:

1. **Single-Process Rust Backend (`rust/`)**:
   - **Language & Runtime**: Stable Rust (`edition = "2021"`), `unsafe_code = "forbid"`, `missing_docs = "deny"`, `axum` + `tokio` HTTP/SSE server, `reqwest` (`rustls`), `serde` / `serde_json`.
   - **Readable Orchestration (`main.rs`)**: One clear, top-to-bottom `main.rs` that wires configuration, authentication, the WorkIQ MCP client, the GPT Luna inference client, the slop detector, the background M365 scanner daemon, the self-awareness ledger, and the Axum HTTP/SSE server.
   - **One Primary Type per Module**:
     - `config.rs` (`AppConfig`)
     - `auth.rs` (`AuthCoordinator` — zero-Service-Tree WorkIQ + GitHub auth status & login flows)
     - `workiq_mcp.rs` (`WorkIqClient` — JSON-RPC 2.0 MCP stdio & CLI `fetch`/`retrieve` client for Teams + Outlook)
     - `llm_luna.rs` (`LunaClient` — GitHub account token resolution + `POST https://api.githubcopilot.com/responses` targeting `gpt-5.6-luna`)
     - `slop_detector.rs` (`SlopDetector`, `SlopReport`, `AnimationTier`, `SlopSignal`)
     - `event_bus.rs` (`AnimationEventBus` — broadcast channel feeding SSE `/api/v1/events/stream`)
     - `ledger.rs` (`AwarenessLedger` — privacy-preserving sent vs. received slop scorecard & history)
     - `scanner_daemon.rs` (`ScannerDaemon` — background polling & deduplication across M365 Teams & Email)
     - `server.rs` (`AppServer` — REST API + SSE stream + static SvelteKit asset serving)
2. **Svelte 5 + TypeScript Strict Frontend (`web/`)**:
   - Built with Svelte 5 runes (`$state`, `$derived`, `$effect`), SvelteKit (`@sveltejs/adapter-static`), strict TypeScript, Vite, and Vitest.
   - **Monitor Edge Overlay Mode (`?mode=overlay`)**: Transparent/click-through-ready HUD canvas that renders the physics-driven Hand Grenade + Squishy Sliding Goop metaballs/drips, Innocent Fruit, Peaceful Cloud, and Subtle Sparkle Plumes along the left/right edges of the monitor.
   - **Awareness Command Center (`/`)**:
     - Zero-Service-Tree Auth Panel for **WorkIQ MCP** (`workiq auth login` / live probe) and **GitHub GPT Luna** (`gh auth token` / PAT / interactive test on `gpt-5.6-luna`).
     - **Self-Awareness Scorecard**: Compares *Messages I Sent* vs. *Messages I Received* (Average Slop Score, Grenades Thrown by Me vs. Grenades Thrown at Me, Clean Human Sparkle Streak, and Coaching Tips).
     - **Live M365 Scanner Feed & Interactive Slop Simulator**: Inspect why a message triggered a Sparkle, Cloud, Fruit, or Slop Grenade, or paste a draft message before sending to check if you're about to throw a Slop Grenade.
3. **Zero Service Tree Registration**:
   - **WorkIQ MCP**: Invokes the local `workiq` binary (`workiq mcp` stdio JSON-RPC 2.0 and `workiq fetch` / `workiq auth login`). Uses Microsoft's built-in first-party WorkIQ CLI brokered authentication—no custom Entra App Registration or Service Tree ID required.
   - **GitHub GPT Luna (`gpt-5.6-luna`)**: Resolves the user's GitHub authentication via `gh auth token`, `GITHUB_TOKEN`, or user-supplied GitHub token in memory, calling `https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"`.
4. **Deployment Topology**:
   - **Local Daemon + Desktop Overlay**: Runs locally as a lightweight background daemon with a frameless transparent Edge/WebView2 overlay window (`scripts/launch-overlay.ps1`).
   - **Private Tenant Cloud Container**: Single multi-stage `Dockerfile` + `infra/main.bicep` for deploying to an Azure Container App on a private tenant without Service Tree registration.

---

## 3. Test-Driven Work Packets (`WP01` – `WP06`)

Every work packet follows strict **Test-Driven Development (TDD)**: tests define the contract first, and no packet is complete until unit, integration, lint, and runtime verification checks pass.

| Packet | Component | TDD Verification Gate |
| :--- | :--- | :--- |
| **WP01** | **Deterministic Slop & Grenade Detector (`rust/src/slop_detector.rs`)** | Unit tests covering all 5 tiers (`HumanSparkle`, `PeacefulCloud`, `InnocentFruit`, `SlopSplat`, `SlopGrenade`), lexical clichés, bolded-bullet walls, low burstiness, passive handoff disclaimers, channel mismatch (Teams vs. Email), and self-coaching generation. |
| **WP02** | **Zero-Service-Tree Auth: WorkIQ MCP (`workiq_mcp.rs`) + GitHub GPT Luna (`llm_luna.rs`) + `auth.rs`** | Unit tests for MCP JSON-RPC 2.0 `initialize` / `tools/call` (`fetch`, `retrieve`) wire framing, Graph `/me/messages` and `/me/chats` normalization (sent vs. received detection), and GPT Luna `/responses` request/response parsing with fallback when offline. |
| **WP03** | **M365 Scanner Daemon (`scanner_daemon.rs`), SSE Event Bus (`event_bus.rs`), & Awareness Ledger (`ledger.rs`)** | Unit tests for message deduplication, sent-by-me vs. received-by-me attribution, scorecard aggregation (grenades thrown vs. received, human streak), and real-time event broadcasting. |
| **WP04** | **Axum HTTP/SSE Server (`server.rs`) & End-to-End Rust Integration Tests (`rust/tests/api_integration.rs`)** | Integration tests verifying `/api/v1/health`, `/api/v1/auth/status`, `/api/v1/analyze`, `/api/v1/simulate`, `/api/v1/scan/poll`, `/api/v1/ledger`, and `/api/v1/events/stream` SSE delivery. |
| **WP05** | **Svelte 5 Physics Animation Engine & Self-Awareness UI (`web/`)** | Vitest unit tests (`web/src/lib/physics.test.ts`, `web/src/lib/tiers.test.ts`) verifying grenade arc trajectory, screen-edge impact, squishy goop drip viscosity/sliding physics, fruit/cloud/sparkle particle lifecycles, plus `svelte-check`, `eslint`, and `vite build`. |
| **WP06** | **Containerization, Bicep, Overlay Launcher & Live Verification (`Dockerfile`, `infra/`, `scripts/`)** | Full `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `npm test`, `npm run build`, and live browser verification of all 5 animations + live GPT Luna & WorkIQ status. |
