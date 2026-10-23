# Slop Grenade — Technical & Developer Guide

This document covers the internal architecture, API contracts, build/test commands, and private-tenant container deployment for **Slop Grenade**. For a general overview and user setup instructions, see [README.md](./README.md).

---

## 1. System Architecture

Slop Grenade consists of three coordinated components:

1. **Native Windows Desktop Screen Overlay & System Tray App (`desktop/`)**:
   - Compiled from every `.cs` file under `desktop/` (C# 5, .NET Framework 4 `csc.exe`, no NuGet packages) to a native Windows GUI executable (`slop-grenade-overlay.exe`, `/target:winexe`).
   - Uses Win32 `UpdateLayeredWindowIndirect` with a 32-bit premultiplied ARGB DIB section (`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`), so effects draw over the primary monitor without stealing focus or blocking the mouse. Only the dirty rectangles of each frame are cleared, redrawn and presented; the loop runs at 60 fps during action, about 30 fps while only goo, flies or smoke are moving, and sleeps when nothing moves.
   - Layout:
     | Folder | Contents |
     | :--- | :--- |
     | `Program.cs` | Entry point, tray icon and menu, daemon start-up, SSE listener, WorkIQ poll, daily gauges, run-at-startup |
     | `Settings.cs` | Preferences in `HKCU\Software\SlopGrenade` (sound on/off, volume, Teams/Outlook, slop/calm effects, fly delay) |
     | `Native.cs` | Win32 P/Invoke (layered window, DIB section, `waveOut`) |
     | `Engine/` | `World` (director queue, short slow-motion moment, hit-stop, slight shake, render order; each effect is drawn in isolation so one failure cannot affect the rest), `OverlayForm` (presenter), dirty-rect tracking, software toon 3D renderer, ink and palette helpers |
     | `Effects/` | Grenade, explosion, particles, slop goo (metaball field with drips and soft-serve swirls), 20 tumbling 3D fruit models, fluid smoke, flies, crystal twinkle, squeegee |
     | `Audio/` | Procedurally synthesised sound bank and a small `waveOut` mixer (stereo pan, loops, soft limiter) |
     | `UI/` | Steampunk tray control panel and its brass/ink drawing helpers |
   - The effects are a 1:1 port of the TypeScript engine in `web/src/lib/engine/`, which is the visual reference and is covered by unit tests.
   - Message tiers map to effects as follows (incoming lands on the left edge in pink, your own messages on the right edge in blue):
     | Tier | Score | Effect |
     | :--- | :--- | :--- |
     | `human_sparkle` | 0-19 | A brief crystal twinkle near the edge |
     | `peaceful_cloud` | 20-39 | Smoke plumes rolling in from the edge; they swirl when things fly through and fade after about 30 s |
     | `innocent_fruit` | 40-59 | A cel-shaded 3D fruit tossed across the screen, tumbling; it sticks only if it hits slop, otherwise it sails off screen |
     | `slop_splat` | 60-79 | A goo cannonball that splats against the edge |
     | `slop_grenade` | 80-100 | A small grenade thrown at normal speed, with a brief slow-motion moment just before it pops and splatters the edge |
   - Slop left on an edge attracts flies after `FlyDelaySeconds` (default 45). Squeegeeing an edge wipes the slop and the stuck fruit and sends the flies away.
   - Items are drawn at `World.ItemScale` (0.42) of the screen scale so the effects stay out of the way on a work screen; twinkles and flies use the screen scale so they stay readable.
   - Slop drips ooze continuously (creep, neck, release a drop, spring back), so the overlay keeps animating at about 30 fps while slop is on screen.
   - Sound is off by default and can be switched on in the tray panel; all sounds are synthesised at start-up (soft sine/triangle tones with a 22 kHz grain), so no audio files ship with the app.
   - Drawing failures are logged to `%LOCALAPPDATA%\SlopGrenade\overlay-errors.log` (each distinct error once per run). The failing effect skips that frame, the next frame is fully repainted, and every frame starts from a clean drawing state.
   - Connects to the local Rust daemon's Server-Sent Events stream (`GET http://127.0.0.1:8090/api/v1/events/stream`).

2. **Rust Background Daemon (`rust/`)**:
   - Built with stable Rust (`axum` + `tokio`), enforcing `unsafe_code = "forbid"` and `missing_docs = "deny"`.
   - **Modules**:
     - `slop_detector.rs`: Deterministic linguistic, structural, burstiness, and passive-handoff analyzer + 5-tier animation classifier (`HumanSparkle`, `PeacefulCloud`, `InnocentFruit`, `SlopSplat`, `SlopGrenade`).
     - `workiq_mcp.rs`: JSON-RPC 2.0 stdio client for the local Microsoft 365 `workiq mcp` server. Recent polling reads inbox/sent items and recent chats; a seven-day refresh pages through non-draft mailbox messages, chats active in the week, and their date-filtered message collections.
     - `llm_luna.rs`: GitHub Copilot Responses API client (`POST https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"`).
     - `ledger.rs`: In-memory directional habit ledger tracking daily midnight-resetting gauges, historical reports, **Top 5 Sloppers**, and **Top 5 P-Doomers**. Retains the full UTC days covering the rolling seven-day window plus up to 360 older reports, and returns reports newest first.
     - `event_bus.rs`: Broadcast channel for real-time desktop overlay animations and squeegee wipes.
     - `scanner_daemon.rs`: Background M365 polling and deduplication loop.
     - `server.rs` & `static_files.rs`: REST API, SSE stream, and static asset server.
   - Real-account mode is the default: startup never seeds synthetic ledger history unless `SLOP_DEMO_DATA=1` (or `true` / `yes`) is explicitly set. For an offline dashboard demo, also set `SLOP_AUTO_POLL=0` so sample and live messages are not mixed.
   - WorkIQ fetch accepts both MCP `structuredContent` and legacy JSON text content. Protocol errors, tool errors, and failed per-entity HTTP statuses are reported as scan failures without including raw response content; they are not treated as empty successful scans.

3. **Habit Monitoring Web Dashboard (`web/`)**:
   - Built with Svelte 5 runes (`$state`, `$derived`), SvelteKit (`@sveltejs/adapter-static`), strict TypeScript, and Vite. Theme in `web/src/app.css` (brass, ink and parchment).
   - Displays the incoming and outgoing daily slop pressure gauges, the stacked daily breakdown by type, time span / channel / type filters, the Top 5 Sloppers and Top 5 P-Doomers, and the drill-down ledger.
   - **Effects test range**: opened from the target icon in the header, a pop-up monitor running the effects engine (`web/src/lib/engine/`). Live messages replay there while it is open, and the buttons fire test effects without calling the API, so test shots do not change your stats.
   - **Refresh 7 days**: merges a paginated seven-day Outlook/Teams backfill, then reloads the ledger, clears chart/person cross-filters, and selects `7d`. The button is disabled while pending; HTTP, protocol, application, and reload failures are shown visibly. Backfills always use local scoring and do not publish historical animation events.
   - **Sound**: optional WebAudio output of the same synthesised effects (`engine/audio.ts`), switched on from the header and remembered per browser.
   - **Overlay mode**: `/?mode=overlay` renders only a transparent full-window effects layer driven by the SSE stream (for example as an OBS browser source). Add `&sound=1` for sound.

---

## 2. HTTP & SSE API Endpoints (`http://127.0.0.1:8090`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Health and version check |
| `GET` | `/api/v1/auth/status` | WorkIQ MCP and GitHub Copilot LLM authentication status |
| `POST` | `/api/v1/auth/workiq-login` | Invokes legacy `workiq auth login`; current CLI versions should sign in through `workiq ask` |
| `POST` | `/api/v1/auth/github-token` | Sets or clears an in-memory GitHub token override |
| `GET` | `/api/v1/ledger` | Returns directional stats, daily gauges, Top 5 Sloppers, Top 5 P-Doomers, and recent reports |
| `POST` | `/api/v1/analyze` | Evaluates a communication sample and broadcasts the resulting animation |
| `POST` | `/api/v1/simulate` | Triggers a preset animation (`human_sparkle`, `peaceful_cloud`, `innocent_fruit`, `slop_splat`, `slop_grenade`, `my_outgoing_grenade`) |
| `POST` | `/api/v1/squeegee` | Broadcasts a left or right bezel squeegee wipe to all connected overlays |
| `POST` | `/api/v1/scan/now` | Recent poll by default; `{"lookbackDays":7,"useLuna":false}` performs a complete quiet seven-day merge |
| `GET` | `/api/v1/events/stream` | Server-Sent Events stream for real-time desktop overlay animations |

---

### Seven-day refresh contract

`POST /api/v1/scan/now` accepts optional `lookbackDays: 7`. Other provided window values, or combining a history refresh with `useLuna: true`, return HTTP 400 with `ok: false`.
A successful history response includes `ok: true`, `lookbackDays: 7`, and `batch` counts/reports. Clients must inspect `ok`, not merely HTTP status; WorkIQ scan failures retain the existing HTTP-200 error envelope.

The UTC window is fixed when fetching starts: `start < message timestamp <= end`, with `start = end - 7 days`.
Mailbox queries exclude drafts. Teams uses matched `$orderby=lastModifiedDateTime desc` and `$filter=lastModifiedDateTime gt ...`, then filters actual creation timestamps locally so edits to older messages are not imported as new history.
Chat discovery expands `lastMessagePreview`, orders it newest first, and filters `lastMessagePreview/createdDateTime` to the week. It does not use `lastUpdatedDateTime`, which tracks renames and membership changes, or the unsupported chat-list `$select` option. All next links are still followed, including empty filtered pages that have a continuation, without a chat-count cap.
Every collection follows opaque Graph `@odata.nextLink` values, without rebuilding skip tokens. Unexpected hosts and repeated paging URLs fail explicitly. Teams IDs are scoped to their chat, and account IDs identify outgoing messages.

History ingestion shares the normal deduplication state but records without animation broadcasts or LLM calls. Repeating a refresh does not increase counts for already observed message IDs.

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
Unit tests: `web/src/lib/dashboard.test.ts` (filters, gauges, leaderboards), `web/src/lib/refresh.test.ts` (seven-day request/response contracts and visible failure paths), and `web/src/lib/engine.test.ts` (grenade slow-motion moment and edge splat, cannon side, fruit sticks only on slop, squeegee clears one side, flies arrive and leave, smoke and twinkles fade, 20 fruit models with no labels, sound bank levels).

### Native Windows Desktop Overlay (`desktop/`)
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ `
    /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll `
    /out:desktop\slop-grenade-overlay.exe /recurse:desktop\*.cs
```

---

## 4. Private-Tenant Container Deployment

A multi-stage [`Dockerfile`](./Dockerfile) and Azure Container Apps Bicep template ([`infra/main.bicep`](./infra/main.bicep)) are included for hosting the web dashboard and API on a private tenant.

See [`PLAN.md`](./PLAN.md), [`CurrentWorkAssignments.md`](./CurrentWorkAssignments.md), and [`research/ai-slop-and-slop-grenade.md`](./research/ai-slop-and-slop-grenade.md) for the research notes and test-driven work packet breakdown.
