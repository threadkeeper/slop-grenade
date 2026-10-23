# Slop Grenade — Technical & Developer Guide

This document covers the internal architecture, API contracts, build/test commands, and private-tenant container deployment for **Slop Grenade**. For a general overview and user setup instructions, see [README.md](./README.md).

---

## 1. System Architecture

Slop Grenade consists of three coordinated components:

1. **Native Windows Desktop Screen Overlay & System Tray App (`desktop/SlopGrenadeOverlay.cs`)**:
   - Compiled to a native Windows GUI executable (`slop-grenade-overlay.exe`, `/target:winexe`).
   - Uses Win32 `UpdateLayeredWindow` with a 32-bit premultiplied ARGB surface (`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`) to render 60 FPS animations directly over the primary Windows desktop monitor without stealing focus or blocking mouse input.
   - Provides a dynamic **Dual-Gauge System Tray Icon** and **Tray Flyout** (`TrayGaugeFlyoutForm`) that resets automatically at midnight (`00:00`) daily, plus Windows startup registration (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run\SlopGrenade`).
   - Connects to the local Rust daemon's Server-Sent Events stream (`GET http://127.0.0.1:8090/api/v1/events/stream`).

2. **Rust Background Daemon (`rust/`)**:
   - Built with stable Rust (`axum` + `tokio`), enforcing `unsafe_code = "forbid"` and `missing_docs = "deny"`.
   - **Modules**:
     - `slop_detector.rs`: Deterministic linguistic, structural, burstiness, and passive-handoff analyzer + 5-tier animation classifier (`HumanSparkle`, `PeacefulCloud`, `InnocentFruit`, `SlopSplat`, `SlopGrenade`).
     - `workiq_mcp.rs`: JSON-RPC 2.0 stdio client for the local Microsoft 365 `workiq mcp` server (`/me/mailFolders/inbox/messages`, `/me/mailFolders/sentitems/messages`, `/me/chats/{id}/messages`).
     - `llm_luna.rs`: GitHub Copilot Responses API client (`POST https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"`).
     - `ledger.rs`: In-memory directional habit ledger tracking daily midnight-resetting gauges, historical reports, **Top 5 Sloppers**, and **Top 5 P-Doomers**.
     - `event_bus.rs`: Broadcast channel for real-time desktop overlay animations and squeegee wipes.
     - `scanner_daemon.rs`: Background M365 polling and deduplication loop.
     - `server.rs` & `static_files.rs`: REST API, SSE stream, and static asset server.

3. **Habit Monitoring Web Dashboard (`web/`)**:
   - Built with Svelte 5 runes (`$state`, `$derived`), SvelteKit (`@sveltejs/adapter-static`), strict TypeScript, and Vite.
   - Displays the **Received (In) vs. Sent (Out) Daily Slop Gauges**, **In vs. Out Slop Bar Chart**, **Time Span / Channel / Type Filters**, and the **Top 5 Sloppers** & **Top 5 P-Doomers** tables.

---

## 2. HTTP & SSE API Endpoints (`http://127.0.0.1:8090`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Health and version check |
| `GET` | `/api/v1/auth/status` | WorkIQ MCP and GitHub Copilot LLM authentication status |
| `POST` | `/api/v1/auth/workiq-login` | Launches interactive `workiq auth login` |
| `POST` | `/api/v1/auth/github-token` | Sets or clears an in-memory GitHub token override |
| `GET` | `/api/v1/ledger` | Returns directional stats, daily gauges, Top 5 Sloppers, Top 5 P-Doomers, and recent reports |
| `POST` | `/api/v1/analyze` | Evaluates a communication sample and broadcasts the resulting animation |
| `POST` | `/api/v1/simulate` | Triggers a preset animation (`human_sparkle`, `peaceful_cloud`, `innocent_fruit`, `slop_splat`, `slop_grenade`, `my_outgoing_grenade`) |
| `POST` | `/api/v1/squeegee` | Broadcasts a left or right bezel squeegee wipe to all connected overlays |
| `POST` | `/api/v1/scan/now` | Triggers an immediate WorkIQ MCP scan of Teams and Outlook |
| `GET` | `/api/v1/events/stream` | Server-Sent Events stream for real-time desktop overlay animations |

---

## 3. Build, Lint, and Test Commands

### Rust Backend (`rust/`)
```powershell
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo clippy --manifest-path rust/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path rust/Cargo.toml
```

### Web Dashboard (`web/`)
```powershell
npm --prefix web install
npm --prefix web run test
npm --prefix web run check
npm --prefix web run build
```

### Native Windows Desktop Overlay (`desktop/`)
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ `
    /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll `
    /out:desktop\slop-grenade-overlay.exe desktop\SlopGrenadeOverlay.cs
```

---

## 4. Private-Tenant Container Deployment

A multi-stage [`Dockerfile`](./Dockerfile) and Azure Container Apps Bicep template ([`infra/main.bicep`](./infra/main.bicep)) are included for hosting the web dashboard and API on a private tenant.

See [`PLAN.md`](./PLAN.md), [`CurrentWorkAssignments.md`](./CurrentWorkAssignments.md), and [`research/ai-slop-and-slop-grenade.md`](./research/ai-slop-and-slop-grenade.md) for the research notes and test-driven work packet breakdown.
