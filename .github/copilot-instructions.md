# Project Coding Standards — Slop Grenade

This repository follows the standard **threadkeeper** Rust + Svelte 5 architecture and engineering discipline (aligned with `gaia-robot`, `tco-calculator`, `db-modernisation-fy27`, and `elle-companion`).

## Core Principles

- **Favor simplicity and clarity.** Prefer straightforward, idiomatic code over premature abstraction.
- **Test-Driven Design (TDD).** Every piece of logic must be verifiable and covered by automated unit and integration tests. No feature ships without tests proving it works.
- **Zero Service Tree Registration.** Never require an enterprise Service Tree ID or custom Entra admin-consented application to run Slop Grenade:
  - **Microsoft 365 Data**: Connect through the user's local **WorkIQ MCP** CLI/stdio server (`workiq mcp`, `workiq fetch`, `workiq auth login`), which uses first-party brokered M365 authentication.
  - **LLM Inference (GPT Luna)**: Authenticate via the user's **GitHub account** (`gh auth token`, `GITHUB_TOKEN`, or user-supplied token) against `https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"`.
- **Privacy & Self-Awareness First.** Never commit, log, or persist raw personal emails, Teams messages, or credentials. Keep message content ephemeral and store only sanitized metadata, slop scores, and coaching insights in memory.

## Project Structure

- `rust/` — Rust backend crate (`axum` + `tokio`), including the Slop & Grenade detector, WorkIQ MCP connector, GitHub GPT Luna client, background M365 scanner daemon, SSE event bus, and self-awareness ledger.
- `rust/tests/` — End-to-end API and daemon integration tests.
- `web/` — Svelte 5 + SvelteKit (`@sveltejs/adapter-static`) + TypeScript strict-mode frontend, monitor overlay physics engine (grenade goop splat, fruit, cloud, human sparkles), and self-awareness dashboard.
- `research/` — Research notes on AI slop, slop grenades, and linguistic detection heuristics.
- `infra/` — Private-tenant Bicep deployment templates.
- `scripts/` — Local daemon and monitor overlay launcher scripts plus version-bump helpers.

## Program Architecture

- **Single orchestrating `main.rs`.** Model `rust/src/main.rs` as a clean top-to-bottom sequence that loads configuration, initializes zero-Service-Tree auth (`WorkIqClient` + `LunaClient`), starts the background M365 scanner daemon, and serves the HTTP/SSE API and static web UI.
- **One primary type per module file.** Each domain struct/enum and its `impl` blocks live in their own focused module (`slop_detector.rs`, `workiq_mcp.rs`, `llm_luna.rs`, `auth.rs`, `scanner_daemon.rs`, `event_bus.rs`, `ledger.rs`, `server.rs`, `static_files.rs`, `config.rs`).
- **Comment generously.** Every public Rust item (`pub fn`, `pub struct`, `pub enum`, `pub trait`) must have a `///` doc comment, and every module must start with a `//!` module-level doc comment. `unsafe_code = "forbid"` and `missing_docs = "deny"` are enforced in `rust/Cargo.toml`.

## Build, Lint, and Test Gates

Run these commands locally before committing or pushing:

### Rust (`rust/`)
- `cargo fmt --manifest-path rust/Cargo.toml --all -- --check`
- `cargo clippy --manifest-path rust/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path rust/Cargo.toml`

### Web (`web/`)
- `npm --prefix web run test`
- `npm --prefix web run check`
- `npm --prefix web run build`

## Multi-Agent Orchestration

See [`CurrentWorkAssignments.md`](../CurrentWorkAssignments.md) and [`PLAN.md`](../PLAN.md) for the test-driven work packet breakdown coordinated by [`.github/agents/slop-orchestrator.agent.md`](agents/slop-orchestrator.agent.md) and its four specialists (`slop-architect`, `slop-developer`, `slop-tester`, `slop-reviewer`).
