# Slop Grenade 💣🟢✨

> **Real-time Microsoft 365 AI Slop & Slop Grenade Detector** — powered by your personal **WorkIQ MCP** server and **GitHub GPT Luna (`gpt-5.6-luna`)**, with a physics-driven monitor edge overlay that splats a squishy, sliding mess of goop whenever a Slop Grenade hits your Teams or Outlook—and gently sparkles when real humans type.

---

## Why Slop Grenade?

A **"Slop Grenade"** (or *AI workslop*) happens when someone prompts an LLM for 5 seconds and lobs 600 words of unedited, bold-bulleted corporate sludge into a Teams chat or email thread—shifting the cognitive burden onto everyone else to read and decipher it.

**Slop Grenade** runs as a standalone local daemon (or private-tenant container) with **zero Service Tree registration required**:
1. **WorkIQ MCP Integration**: Connects directly to your local Microsoft 365 **WorkIQ MCP** server (`workiq mcp` / `workiq fetch` / `workiq auth login`) to scan incoming and outgoing **Microsoft Teams** messages and **Outlook** emails.
2. **GitHub Account Auth for GPT Luna (`gpt-5.6-luna`)**: Uses your GitHub login (`gh auth token` or `GITHUB_TOKEN`) against `https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"` alongside a fast deterministic linguistic analyzer.
3. **Self-Awareness First**: Tracks both **Incoming** messages and **Your Own Outgoing** messages so you can see your own AI slop score, human sparkle streak, and pre-send coaching before you accidentally throw a Slop Grenade at your team.

---

## The 5-Tier Monitor Animation Scale

Every communication you send or receive triggers a proportional animation on the edge of your monitor:

| Slop Score | Tier | Visual Animation on Monitor | Meaning |
| :--- | :--- | :--- | :--- |
| **`0 – 19`** | **`HumanSparkle`** ✨ | Barely visible, delicate plumes of warm stardust sparkles drifting gently upward | Authentic, human-typed communication with natural rhythm and brevity |
| **`20 – 39`** | **`PeacefulCloud`** ☁️ | Small, serene pastel cloud drifting softly across the upper monitor edge | Lightly polished or formal prose that remains concise and human |
| **`40 – 59`** | **`InnocentFruit`** 🍑 | Cheerful bouncing fruit (peach, citrus, berry) with a soft juice droplet | Noticeable AI assistance or template phrasing, but bounded and harmless |
| **`60 – 79`** | **`SlopSplat`** 🟢 | Wobbly gelatinous slime blob that quivers on the screen edge | Heavy corporate AI buzzwords and symmetrical bullet padding |
| **`80 – 100`** | **`SlopGrenade`** 💣 | **Hand grenade arcs across the screen, splats against the side of the monitor, and slides down like a squishy, sloppy mess of neon goop!** | Unreviewed AI Slop Grenade! High cognitive tax, bolded bullet wall, or passive AI dump |

---

## Repository Structure

| Path | Description |
| :--- | :--- |
| `rust/` | Single-process Rust (`axum` + `tokio`) daemon, Slop & Grenade detector, WorkIQ MCP client, GitHub GPT Luna client, SSE event bus, and self-awareness ledger |
| `rust/tests/` | End-to-end API and scanner daemon integration tests |
| `web/` | Svelte 5 + SvelteKit + TypeScript strict frontend: Monitor Edge Overlay (`/?mode=overlay`) + Self-Awareness Command Center (`/`) |
| `research/` | Research on [AI Slop & Slop Grenades](./research/ai-slop-and-slop-grenade.md) |
| `PLAN.md` | [Architecture & Test-Driven Build Plan](./PLAN.md) |
| `CurrentWorkAssignments.md` | [Test-Driven Work Packets (`WP01`–`WP06`)](./CurrentWorkAssignments.md) |
| `.github/copilot-instructions.md` | Repository coding standards and TDD gates |
| `.github/agents/` | Multi-agent orchestration suite (`slop-orchestrator`, `slop-architect`, `slop-developer`, `slop-tester`, `slop-reviewer`) |
| `scripts/launch-overlay.ps1` | One-command launcher for the local daemon + frameless monitor overlay |
| `infra/main.bicep` | Private-tenant Azure Container Apps Bicep template (no Service Tree required) |

---

## Quick Start

### 1. Authenticate (No Service Tree Required)

```powershell
# Authenticate WorkIQ MCP to your M365 account (uses built-in WorkIQ broker)
workiq auth login

# Authenticate GitHub CLI for GPT Luna (gpt-5.6-luna) inference
gh auth login
```

### 2. Run Backend & Web Overlay

```powershell
# Run all Rust unit & integration tests
cargo test --manifest-path rust/Cargo.toml

# Build the Svelte 5 web app & overlay
npm --prefix web install
npm --prefix web run test
npm --prefix web run build

# Launch the Slop Grenade daemon on http://127.0.0.1:8090
cargo run --manifest-path rust/Cargo.toml
```

- **Awareness Command Center & Pre-Send Check**: `http://127.0.0.1:8090/`
- **Monitor Edge Overlay HUD**: `http://127.0.0.1:8090/?mode=overlay`
