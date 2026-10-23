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
     - `workiq_mcp.rs`: JSON-RPC 2.0 stdio client for the local Microsoft 365 `workiq mcp` server (`/me/mailFolders/inbox/messages`, `/me/mailFolders/sentitems/messages`, `/me/chats/{id}/messages`).
     - `llm_luna.rs`: GitHub Copilot Responses API client (`POST https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"`).
     - `ledger.rs`: In-memory directional habit ledger tracking daily midnight-resetting gauges, historical reports, **Top 5 Sloppers**, and **Top 5 P-Doomers**.
     - `event_bus.rs`: Broadcast channel for real-time desktop overlay animations and squeegee wipes.
     - `scanner_daemon.rs`: Background M365 polling and deduplication loop.
     - `server.rs` & `static_files.rs`: REST API, SSE stream, and static asset server.

3. **Habit Monitoring Web Dashboard (`web/`)**:
   - Built with Svelte 5 runes (`$state`, `$derived`), SvelteKit (`@sveltejs/adapter-static`), strict TypeScript, and Vite. Theme in `web/src/app.css` (brass, ink and parchment).
   - Displays the incoming and outgoing daily slop pressure gauges, the stacked daily breakdown by type, time span / channel / type filters, the Top 5 Sloppers and Top 5 P-Doomers, and the drill-down ledger.
   - **Effects test range**: opened from the target icon in the header, a pop-up monitor running the effects engine (`web/src/lib/engine/`). Live messages replay there while it is open, and the buttons fire test effects without calling the API, so test shots do not change your stats.
   - **Sound**: optional WebAudio output of the same synthesised effects (`engine/audio.ts`), switched on from the header and remembered per browser.
   - **Overlay mode**: `/?mode=overlay` renders only a transparent full-window effects layer driven by the SSE stream (for example as an OBS browser source). Add `&sound=1` for sound.

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
Unit tests: `web/src/lib/dashboard.test.ts` (filters, gauges, leaderboards) and `web/src/lib/engine.test.ts` (grenade slow-motion moment and edge splat, cannon side, fruit sticks only on slop, squeegee clears one side, flies arrive and leave, smoke and twinkles fade, 20 fruit models with no labels, sound bank levels).

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
