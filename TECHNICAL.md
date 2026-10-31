# Slop Grenade — Technical & Developer Guide

This document covers the internal architecture, API contracts, build/test commands, and private-tenant container deployment for **Slop Grenade**. For a general overview and user setup instructions, see [README.md](./README.md).

---

## Release packaging

The [complete release workflow](./.github/workflows/release.yml) is the only automated GitHub Release publisher. Push an ordinary `vMAJOR.MINOR.PATCH` tag, or use **Run workflow** and select a branch or an existing version tag. Leave the optional tag input blank to choose automatically; on a branch, the workflow chooses the next patch after the numerically highest stable version tag or the branch's `VERSION`, whichever is greater, and creates that tag at the selected commit. Preview and other non-version tags are ignored. Alternatively, supply an explicit tag; any existing tag must point to the selected commit. Concurrent complete releases are serialized, and a conflicting tag creation fails rather than overwriting a tag. The release tag is passed to Windows, macOS and Android packages; the source `VERSION` and other version files are not changed. The workflow calls all three builds at the same commit, with no path filters. A failed or skipped platform prevents publication; never work around a failed build by publishing just the successful platform.

Automatic tags are reserved before building and remain if a build fails. Rerun failed jobs to use the same tag, or run the workflow on that tag to resume a draft. A new manual run on a branch (or rerunning all jobs) reserves another patch version. Repository Actions must be allowed to create tags and releases.

Every release includes a Windows x64 setup executable, a Universal macOS `.pkg`, a release-signed Android APK, and the optional desktop portable archives, each with a matching SHA-256 file. Windows setup is built with Inno Setup 6 on the Windows runner and installs under `%LOCALAPPDATA%\SlopGrenade`, with executables in `bin` and dashboard assets in `web\build`. macOS `pkgbuild` installs the complete app into `/Applications`. Native runner smoke tests install these packages and check that the installed daemon serves its dashboard; Windows additionally checks overlay startup, its shortcut, and uninstall.

Configure the private release signing secrets `SLOP_ANDROID_KEYSTORE_BASE64`, `SLOP_ANDROID_STORE_PASSWORD`, `SLOP_ANDROID_KEY_ALIAS` and `SLOP_ANDROID_KEY_PASSWORD` before running a release. The keystore is restored only in a temporary private file and removed even on failure. Missing credentials fail the whole release; debug keys and the separate OAuth test key are never substitutes. Keep the release certificate registered with Google OAuth and complete the existing provider acceptance gates before distributing it.

Windows packages are not Authenticode-signed. macOS apps are ad-hoc signed; the package is not Developer ID-signed or notarized. Release notes must state these limitations accurately without branding any release as "experimental". Signing/notarization is not implied by a successful packaging test.

`python3 scripts/release.py verify DIRECTORY` requires the exact complete asset set and validates every checksum. Publication creates or resumes a draft, uploads the verified files, verifies GitHub's asset names, sizes and digests, then publishes and marks it latest. Upload failures leave a draft rather than a partial public release. Reruns can resume drafts but refuse to overwrite public releases. Do not manually attach individual platform artifacts or publish a platform-only release.

Run `python3 -m unittest discover -s scripts -p 'test_*.py'` for release policy, checksum and publication-order regressions. The ordinary platform workflows retain read-only repository permissions and upload CI artifacts only; OAuth test APKs remain separate from releases.

---

## 1. System Architecture

Slop Grenade consists of three coordinated components:

1. **Native Windows Desktop Screen Overlay & System Tray App (`desktop/`)**:
   - Compiled from every `.cs` file under `desktop/` (C# 5, .NET Framework 4 `csc.exe`, no NuGet packages) to a native Windows GUI executable (`slop-grenade-overlay.exe`, `/target:winexe`).
   - Uses Win32 `UpdateLayeredWindowIndirect` with a 32-bit premultiplied ARGB DIB section (`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`), so effects draw over the primary monitor without stealing focus or blocking the mouse. Only the dirty rectangles of each frame are cleared, redrawn and presented; the loop runs at 60 fps during action, about 30 fps while only goo, flies or smoke are moving, and sleeps when nothing moves.
   - Layout:
     | Folder | Contents |
     | :--- | :--- |
     | `Program.cs` | Entry point, tray icon and menu, daemon start-up, SSE listener, daily gauges, run-at-startup |
     | `Settings.cs` | Preferences in `HKCU\Software\SlopGrenade` (sound on/off, volume, Teams/Outlook, slop/calm effects, fly delay) |
     | `Native.cs` | Win32 P/Invoke (layered window, DIB section, `waveOut`) |
     | `Engine/` | `World` (director queue, slight shake, render order; each effect is drawn in isolation so one failure cannot affect the rest), `OverlayForm` (presenter), dirty-rect tracking, software toon 3D renderer, ink and palette helpers |
     | `Effects/` | Grenade, explosion, particles, slop goo (metaball field with drips and soft-serve swirls), 20 tumbling 3D fruit models, fluid smoke, flies, crystal twinkle, squeegee |
     | `Audio/` | Procedurally synthesised sound bank and a small `waveOut` mixer (stereo pan, loops, soft limiter) |
     | `UI/` | Steampunk tray control panel and its brass/ink drawing helpers |
   - Live solid effects carry only their existing sanitized ledger report. Hovering a fruit, grenade, cannonball, sparkle, splat or drip for 500 ms displays a non-activating, layered, click-through details card. Fruit hit testing uses sprite alpha; goop requires a visible pixel and selects the strongest local contributing shape where splats have merged. Metadata follows queued effects and their child goop/drops, and disappears with the effects or a squeegee. Diffuse shared smoke, ambient flies and test shots do not invent message attribution. Details are memory-only, use the existing redacted preview, hide immediately on leaving and expire after ten seconds. A low-frequency cursor timer runs only while attributed effects remain, so the animation loop can still sleep.
   - The effects are a 1:1 port of the TypeScript engine in `web/src/lib/engine/`, which is the visual reference and is covered by unit tests.
   - At most two grenade, cannonball or fruit flights and cloud emission sequences run at once, capped by the reported logical processor count (the web engine falls back to one if that count is unavailable). Additional across-screen effects wait in memory; stationary sparkles may pass them. On desktop, fruit may also wait for a pending splat on its side. A flight releases its slot on impact or exit, and a cloud releases its slot after its final puff; lingering smoke, goo, flies, explosions, particles and wipe-triggered falling fruit do not hold slots. Existing per-type pacing still applies. The queue is not itself a thread scheduler and does not limit the total cost of lingering effects.
   - The animation backlog is intentionally unbounded and is not persisted: a sustained burst can increase memory use and delay, and reset or shutdown clears pending effects. Display or canvas resizing preserves queued and scheduled effects and their remaining delays, though already-active effects still clear on world recreation. The previous behavior that converted grenades beyond twelve queued shots into immediate splats has been removed. This guarantee applies to events received by the engine, not events lost upstream.
   - Message tiers map to effects as follows (incoming lands on the left edge in pink, your own messages on the right edge in blue):
     | Tier | Score | Effect |
     | :--- | :--- | :--- |
     | `human_sparkle` | 0-19 | A brief crystal twinkle near the edge |
     | `peaceful_cloud` | 20-39 | Smoke plumes rolling in from the edge; they swirl when things fly through and fade after about 30 s |
     | `innocent_fruit` | 40-59 | A cel-shaded 3D fruit tossed across the screen, tumbling; it sticks only if it hits slop, otherwise it sails off screen |
     | `slop_splat` | 60-79 | A goo cannonball that splats against the edge |
     | `slop_grenade` | 80-100 | A small grenade thrown at normal speed before it pops and splatters the edge |
   - Slop left on an edge attracts flies after `FlyDelaySeconds` (default 45). Squeegeeing an edge wipes the slop and the stuck fruit and sends the flies away.
   - Items are drawn at `World.ItemScale` (0.294) of the screen scale. Twinkles use 70% of the screen scale and flies use 0.325 of the screen scale; motion scaling remains independent of artwork size.
   - Smoke uses approximately half its former grid and sprite dimensions: 45 grid rows on Windows and 36 in the web engine. On Windows, the smoke sprite is bilinearly scaled in independent screen-row ranges using up to four thread-pool workers, capped by available logical processors; small regions and single-processor machines use the serial path. The finished premultiplied pixels are copied into cleared dirty regions before the UI thread draws foreground effects and presents the window. A reusable buffer grows geometrically up to four bytes per screen pixel; its reference is released when smoke clears. The solver, foreground drawing and web engine remain single-threaded.
   - Slop drips ooze continuously (creep, neck, release a drop, spring back), so the overlay keeps animating at about 30 fps while slop is on screen.
   - Sound is off by default and can be switched on in the tray panel; all sounds are synthesised at start-up (soft sine/triangle tones with a 22 kHz grain), so no audio files ship with the app.
   - Drawing failures are logged to `%LOCALAPPDATA%\SlopGrenade\overlay-errors.log` (each distinct error once per run). The failing effect skips that frame, the next frame is fully repainted, and every frame starts from a clean drawing state.
   - Connects to the local Rust daemon's Server-Sent Events stream (`GET http://127.0.0.1:8090/api/v1/events/stream`).

2. **Rust Background Daemon (`rust/`)**:
   - Built with stable Rust (`axum` + `tokio`), enforcing `unsafe_code = "forbid"` and `missing_docs = "deny"`.
   - **Modules**:
     - `slop_detector.rs` (re-exported from `core/`): Deterministic linguistic, structural, burstiness, and passive-handoff analyzer + 5-tier animation classifier (`HumanSparkle`, `PeacefulCloud`, `InnocentFruit`, `SlopSplat`, `SlopGrenade`). See "Scoring rubric" below.
     - `workiq_mcp.rs`: JSON-RPC 2.0 stdio client for the local Microsoft 365 `workiq mcp` server. Recent polling reads inbox/sent items and recent chats; a history refresh (1 to 30 days) pages through non-draft mailbox messages, chats active in the window, and their date-filtered message collections. HTML bodies are reduced to text (style blocks and comments dropped, tags with attributes handled, entities decoded) with bold and bullet structure kept. Teams bot posts are named `<app> [bot]` so they take the automated path.
     - `llm_luna.rs`: GitHub Copilot Responses API client (`POST https://api.githubcopilot.com/responses` with `model: "gpt-5.6-luna"`).
     - `ledger.rs`: In-memory directional habit ledger tracking daily midnight-resetting gauges, historical reports, **Top 5 Sloppers**, and **Top 5 P-Doomers**. The lists rank people by their share of AI-written messages (score 40 or more), then average score, then message count; both fill to five whenever five people are known, may overlap only below ten people, and leave out automated mail and placeholder senders. Retains the full UTC days covering the rolling 31-day window plus up to 360 older reports, and returns reports newest first.
     - `event_bus.rs`: Broadcast channel for real-time desktop overlay animations and squeegee wipes.
     - `scanner_daemon.rs`: Background WorkIQ polling and deduplication, serialized live scans, and separately locked history refreshes.
     - `refresh_progress.rs` & `refresh_phase.rs`: Metadata-only history counters and stages, kept separate from animation events.
     - `gmail_auth.rs`, `gmail_account.rs`, `gmail_client.rs`, and `gmail_scanner.rs`: Desktop Google OAuth with PKCE, process-memory-only account credentials, bounded Gmail REST polling, and local scoring with sanitized ledger ingestion. Android continues to use its native Gmail implementation.
     - `server.rs` & `static_files.rs`: REST API, SSE stream, and static asset server.
   - Real-account mode is the default: startup never seeds synthetic ledger history unless `SLOP_DEMO_DATA=1` (or `true` / `yes`) is explicitly set. For an offline dashboard demo, also set `SLOP_AUTO_POLL=0` so sample and live messages are not mixed.
   - WorkIQ fetch accepts both MCP `structuredContent` and legacy JSON text content. Protocol errors, tool errors, and failed per-entity HTTP statuses are reported as scan failures without including raw response content; they are not treated as empty successful scans.
   - The daemon alone owns live message polling: `SLOP_POLL_INTERVAL_SECS` defaults to **3** (minimum **3**). Missed ticks are skipped, and manual/background recent polls cannot overlap. The Windows overlay listens to SSE instead of starting a second scan timer. `SLOP_AUTO_POLL=0` therefore disables automatic scans even with the overlay open. Provider calls may take longer than three seconds; this is a target cadence, not a guaranteed message-to-animation deadline. Background outage/recovery logs contain no provider errors or message content.

3. **Habit Monitoring Web Dashboard (`web/`)**:
   - Built with Svelte 5 runes (`$state`, `$derived`), SvelteKit (`@sveltejs/adapter-static`), strict TypeScript, and Vite. Theme in `web/src/app.css` (brass, ink and parchment).
   - Displays the incoming and outgoing % AI dials (share of person-written messages scoring 40 or more in the selected span), the stacked daily breakdown by type, time span / direction / channel / type filters, the Most Wanted and Hand-Crafted Heroes lists (computed from the filtered reports by AI share, see `computeTopFiveLists`), and the drill-down ledger. Spans are **Today** (local midnight), **Last 3 days** (rolling 72 hours), and **Last 7 days** (rolling 168 hours); future-dated reports are excluded. Every metric uses the same filtered slice.
   - The ledger displays local timestamps with seconds and their original ISO value in a `<time>` element. Slop % and date/time sort both ways over the full filtered result before pagination (50 rows on desktop, 10 on Android). Filter, sort and drill-down changes reset the page; shrinking results clamp it.
   - **Effects test range**: opened from the target icon in the header, a pop-up monitor running the effects engine (`web/src/lib/engine/`). Live messages replay there while it is open, and the buttons fire test effects without calling the API, so test shots do not change your stats.
   - **Refresh**: merges a paginated Outlook/Teams backfill for the selected span (`Today` 1 day, **Last 3 days** 3, **Last 7 days** 7; Android always uses 7), then reloads the ledger and clears chart/person cross-filters, keeping the selected span. While the POST is pending, desktop clients poll correlated metadata about once a second and show separate Outlook/Teams counts, chat discovery and scoring stages. Progress requests never overlap, stop on completion/failure or unmount, and expose temporary errors without aborting the valid refresh. The button is disabled while pending; HTTP, protocol, application, and reload failures are shown visibly. Backfills always use local scoring and do not publish historical animation events.
   - **Sound**: optional WebAudio output of the same synthesised effects (`engine/audio.ts`), switched on from the header and remembered per browser.
   - **Overlay mode**: `/?mode=overlay` renders only a transparent full-window effects layer driven by the SSE stream (for example as an OBS browser source). Add `&sound=1` for sound.

---

### Scoring rubric (`core/src/slop_detector.rs`)

Before scoring, `isolate_authored_text` strips Microsoft Information Protection banners, quoted reply chains (`From:/Sent:/To:/Subject:`, `On ... wrote:`, `> ` blockquotes, and HTML reply dividers `#divRplyFwdMsg` / `#appendonsend`), and trailing email signatures, while `workiq_mcp.rs` requests Microsoft Graph `uniqueBody` so senders are evaluated only on the words they actually wrote.

The Stage 1 heuristic score is `lexical (capped at 74) + structural + burstiness + handoff - human credit`, clamped to 0..=100. Without any structural or handoff signal it is capped at 79, so plain buzzword prose cannot reach the grenade tier. Short messages under 65 words without AI lexical/structural signals have their polish prior capped at 8 (`human_sparkle`).

| Family | Signals |
| :--- | :--- |
| Lexical | Opening clichés, AI buzzwords, formulaic transitions, stock assistant phrases (`AI_PHRASES`, matched after folding curly quotes) and AI-favoured words (`AI_WORDS`, matched at word starts) |
| Structural | Bold-bullet walls, headings, em dashes (any count; heavier in Teams), plain bullet lists, non-mention bold spans, emoji-led lines, curly quotes and multi-paragraph essays in Teams, colon lead-ins, rule-of-three lists |
| Burstiness | Flat sentence cadence, plus a prior for long, uniformly capitalised and punctuated prose with long words (heavier for long Teams messages); capped at 36 |
| Handoff | Handoff phrases, assistant voice (`ASSISTANT_VOICE`: offers, templates, chatbot openers), a pasted `Subject:` line, channel length mismatch |
| Human credit | 6 points per fingerprint, up to 24: lower-case sentence start, lower-case "i", each slang/workplace colloquialism or un-apostrophized contraction, `@Name` colleague mentions, `??`/`!!`/`...`, emoticons, no final punctuation in a short message |

When `gpt-5.6-luna` is enabled (`SLOP_ENABLE_LUNA=1`, default), `ScannerDaemon` runs a **Two-Stage Hybrid Verification** on any message whose Stage 1 heuristic score is 28 or higher (`TWO_STAGE_LUNA_THRESHOLD`). `SlopDetector::merge_luna_judgment` weights `gpt-5.6-luna` at 65% and grants it veto power over heuristic false positives on genuine human writing (`luna_score <= 12` caps at 19 `human_sparkle`; `<= 20` caps at 32 `peaceful_cloud`; `<= 35` caps at 38 `peaceful_cloud`).

A score of 40 or more counts as AI-written for the dashboard dials, the tray gauges and the leaderboards. Automated mail is always scored 4 (`human_sparkle`) and is left out of those shares. Calibration examples live in the detector's unit tests.

---

## 2. HTTP & SSE API Endpoints (`http://127.0.0.1:8090`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Health and version check |
| `GET` | `/api/v1/auth/status` | Combined WorkIQ MCP, GitHub Copilot LLM, and sanitized desktop Gmail authentication status |
| `POST` | `/api/v1/auth/workiq-login` | Invokes legacy `workiq auth login`; current CLI versions should sign in through `workiq ask` |
| `POST` | `/api/v1/auth/github-token` | Sets or clears an in-memory GitHub token override |
| `GET` | `/api/v1/ledger` | Returns directional stats, daily gauges, Top 5 Sloppers, Top 5 P-Doomers, and recent reports |
| `POST` | `/api/v1/analyze` | Evaluates a communication sample and broadcasts the resulting animation |
| `POST` | `/api/v1/simulate` | Triggers a preset animation (`human_sparkle`, `peaceful_cloud`, `innocent_fruit`, `slop_splat`, `slop_grenade`, `my_outgoing_grenade`) |
| `POST` | `/api/v1/squeegee` | Broadcasts a left or right bezel squeegee wipe to all connected overlays |
| `POST` | `/api/v1/scan/now` | Recent poll by default; `{"lookbackDays":N,"useLuna":false}` with `N` from 1 to 30 performs a complete quiet merge of the last `N` days |
| `GET` | `/api/v1/scan/progress?refreshId=ID` | Latest metadata-only history counters for that opaque ID, or `{"progress":null}` before it starts or for another job |
| `GET` | `/api/v1/events/stream` | Server-Sent Events stream for real-time desktop overlay animations |
| `GET` | `/api/v1/gmail/accounts` | Ephemeral Gmail connection labels, hashed account IDs, and scan state |
| `POST` | `/api/v1/gmail/authorize` | Starts five-minute, single-use browser OAuth; returns only authorization URL and expiration |
| `GET` | `/api/v1/auth/google/callback` | Consumes OAuth state, exchanges the code with PKCE, and verifies the Gmail profile |
| `POST` | `/api/v1/gmail/accounts/{id}/reconnect` | Starts fresh consent for a known hashed account ID |
| `DELETE` | `/api/v1/gmail/accounts/{id}` | Clears account credentials and stops scans; attempts grant revocation |
| `POST` | `/api/v1/gmail/scan` | Refreshes connected accounts with per-account failure isolation |
| `GET` | `/api/v1/gmail/events` | Metadata-only `gmail-status` SSE notifications; consumers reload account state |

### Desktop Gmail

The desktop daemon binds only to numeric loopback addresses. Gmail routes additionally validate the peer, numeric loopback Host, and same-origin dashboard requests; the Android WebView origin cannot use desktop OAuth. Callback and account/auth responses are not cacheable. Tray/menu actions open `/?gmail=connect`; only Rust handles OAuth and Gmail requests.

Configure the public Desktop app client ID with `GMAIL_OAUTH_CLIENT_ID`. No client secret, credential JSON, token file, cloud relay, or Pub/Sub service is used. Without a configured client ID, authorization fails explicitly. Only `https://www.googleapis.com/auth/gmail.readonly` is requested. Google accounts must be authorized again after every daemon restart.

Windows and macOS Actions builds embed the public repository variable `GMAIL_OAUTH_CLIENT_ID` only when `GMAIL_PRODUCTION_APPROVED` is exactly `true`. Leave approval unset or `false` until Google's production verification and every manual release gate are complete. No Google Actions secrets are required. Owner/support contacts, credential downloads, and tokens must not be added to repository variables or source. Runtime `GMAIL_ENABLED=0` disables Gmail, and `GMAIL_POLL_INTERVAL_SECS` defaults to 60 (minimum 30).

Keep the separate development client ID in `GMAIL_DEV_OAUTH_CLIENT_ID`; production workflows never read it. For local development, provide that client's value as the daemon's process environment variable `GMAIL_OAUTH_CLIENT_ID`, without writing it into source. Testing-mode OAuth apps permit only explicitly listed test users; storing a client ID does not grant Google production approval.

Gmail uses its own polling interval, independent of WorkIQ. Initial and expired-history recovery imports cover seven days and remain quiet. Bodies are transient; original sender/subject metadata is used for local scoring, then replaced before ledger or animation publication. Signing out of Gmail or Microsoft 365 wipes all communication-derived history, aggregates, retained events, checkpoints, deduplication state, and active overlay effects. Other providers remain authorized and may repopulate history on subsequent scans. This updated sign-out policy supersedes history retention in the original [production Gmail specification](./docs/GMAIL_DESKTOP_PRODUCTION.md); its Google verification and manual release-owner gates still apply.

Wipes serialize with in-flight scoring and scanner commits. Ledger snapshots, animation events, and sign-out confirmations include the process-local monotonic `resetGeneration`; clients discard older responses and reset complete effect queues, not just visible splats. The latest reset marker survives animation-queue eviction and is replayed to reconnecting subscribers. Android also resets surviving accounts' checkpoints so their next refresh is quiet.

---

### History refresh contract

`POST /api/v1/scan/now` accepts optional `lookbackDays` from 1 to 30. Values outside that range, or combining a history refresh with `useLuna: true`, return HTTP 400 with `ok: false`. The Android app accepts only `lookbackDays: 7`.
A successful history response includes `ok: true`, the requested `lookbackDays`, and `batch` counts/reports. Clients must inspect `ok`, not merely HTTP status; WorkIQ scan failures retain the existing HTTP-200 error envelope.

Desktop clients may also send `refreshId`, an opaque 1-64-character ASCII letter/digit/hyphen identifier (normally a UUID). It requires a history window; invalid IDs return HTTP 400 without echoing their contents. Legacy and Android requests are unchanged, and Android does not use the desktop progress endpoint.
`GET /api/v1/scan/progress?refreshId=ID` returns `{"progress":null}` or a `no-store` snapshot containing `refreshId`, `lookbackDays`, `phase` (`connecting`, `outlook`, `teams`, `analyzing`, `completed`, `failed`), `outlookScanned` / `outlookTotal`, `teamsScanned` / `teamsTotal`, `teamsChatsDiscovered` / `teamsChatsScanned` / `teamsChatsTotal`, and `analyzedCount` / `analysisTotal`. There are no subjects, senders, account identities, bodies or provider URLs. Only the latest job is retained, and ID filtering prevents another job's counters from replacing the caller's progress.
Counters update after every existing provider page; messages are not fetched a second time for totals. Outlook requests `$count=true`, but missing or stale totals remain `null` until paging establishes an exact total. The Teams total stays unknown until all remaining chats' sizes are known; a single chat's size is never presented as the total for all Teams. The UI renders `345 / 982 scanned` when reliable, or `345 scanned · discovering total` otherwise. Analysis counts include only new, deduplicated messages. Concurrent history jobs fail explicitly without overwriting active progress, while live polling remains independently available.

The UTC window is fixed when fetching starts: `start < message timestamp <= end`, with `start = end - lookbackDays`.
Mailbox queries exclude drafts. Teams uses matched `$orderby=lastModifiedDateTime desc` and `$filter=lastModifiedDateTime gt ...`, then filters actual creation timestamps locally so edits to older messages are not imported as new history.
Chat discovery expands `lastMessagePreview`, orders it newest first, and filters `lastMessagePreview/createdDateTime` to the window. It does not use `lastUpdatedDateTime`, which tracks renames and membership changes, or the unsupported chat-list `$select` option. All next links are still followed, including empty filtered pages that have a continuation, without a chat-count cap.
Every collection follows opaque Graph `@odata.nextLink` values, without rebuilding skip tokens. Unexpected hosts and repeated paging URLs fail explicitly. Teams IDs are scoped to their chat, and account IDs identify outgoing messages.

History ingestion shares the normal deduplication state but records without animation broadcasts or LLM calls. Repeating a refresh does not increase counts for already observed message IDs.

---

## 3. Build, Lint, and Test Commands

### Rust Backend (`rust/`)
```powershell
cargo fmt --manifest-path rust\Cargo.toml --all -- --check
cargo clippy --manifest-path rust\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path rust\Cargo.toml
```

### Shared Rust Core and Android Bridge

The desktop public module paths re-export the shared types. Run the shared crates' own tests as well as the desktop tests; dependency tests are not included automatically by `cargo test` in `rust/`.

```powershell
cargo fmt --manifest-path core\Cargo.toml --all -- --check
cargo clippy --manifest-path core\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path core\Cargo.toml
cargo fmt --manifest-path mobile\rust-bridge\Cargo.toml --all -- --check
cargo clippy --manifest-path mobile\rust-bridge\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path mobile\rust-bridge\Cargo.toml
```

### Web Dashboard (`web/`)
```powershell
npm --prefix web install
npm --prefix web run test
npm --prefix web run check
npm --prefix web run build
```
Unit tests: `web/src/lib/dashboard.test.ts` (time/direction filters, local timestamps, full-result sorting, pagination, gauges and leaderboards), `web/src/lib/refresh.test.ts` (span-to-days mapping, legacy/Android compatibility, correlated live counters, non-overlap, disposal and visible failures), `web/src/lib/samplePlayback.test.ts` (paced, cancellable sample activity), and `web/src/lib/engine.test.ts` (normal-speed grenade flight and edge splat, cannon side, fruit sticks only on slop, squeegee clears one side, flies arrive and leave, smoke and twinkles fade, 20 fruit models with no labels, sound bank levels).

### Native Windows Desktop Overlay (`desktop/`)

Run the C# 5 metadata, attribution, hover timing, screen-boundary, focus and click-through regressions (using fictional messages only):

```powershell
.\scripts\test-desktop.ps1
```

The Windows desktop compatibility workflow runs the same tests and production compilation.
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ `
    /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll `
    /win32icon:desktop\slop-grenade.ico `
    /out:desktop\slop-grenade-overlay.exe /recurse:desktop\*.cs
```

### Native macOS Menu Bar & Screen Overlay (`macos/`)
```bash
swiftc -O -target arm64-apple-macos13.0 macos/SlopGrenadeOverlay.swift \
  -framework Cocoa -framework WebKit -o macos/build/slop-grenade-overlay-arm64
swiftc -O -target x86_64-apple-macos13.0 macos/SlopGrenadeOverlay.swift \
  -framework Cocoa -framework WebKit -o macos/build/slop-grenade-overlay-x86_64
lipo -create macos/build/slop-grenade-overlay-arm64 macos/build/slop-grenade-overlay-x86_64 \
  -output macos/build/slop-grenade-overlay
```
The [macOS desktop compatibility workflow](./.github/workflows/macos.yml) builds both `aarch64-apple-darwin` and `x86_64-apple-darwin` targets for the Rust daemon and the Swift menu-bar/screen overlay, combines them with `lipo` into Universal binaries inside `Slop Grenade.app`, and publishes `slop-grenade-macos-universal.tar.gz` + `.sha256`.

---

## 4. Private-Tenant Container Deployment

A multi-stage [`Dockerfile`](./Dockerfile) and Azure Container Apps Bicep template ([`infra/main.bicep`](./infra/main.bicep)) are included for hosting the web dashboard and API on a private tenant.

See [`PLAN.md`](./PLAN.md), [`CurrentWorkAssignments.md`](./CurrentWorkAssignments.md), and [`research/ai-slop-and-slop-grenade.md`](./research/ai-slop-and-slop-grenade.md) for the research notes and test-driven work packet breakdown.

---

## 5. Android Gmail port

The Android application lives separately under `mobile/`. It reuses the platform-independent Rust core and the existing Svelte dashboard/effects, rather than running WorkIQ or the Windows overlay on a phone. The desktop daemon retains its existing public module paths and behavior.

### Modules and build

| Location | Responsibility |
| --- | --- |
| `core/` | Shared Rust detector, ledger, event bus and effect presets; no Android or WorkIQ dependency |
| `mobile/rust-bridge/` | Isolated JNI/JSON boundary and process-local Android ingestion state |
| `mobile/core/` | Kotlin facade for the native core |
| `mobile/accounts/` | Google account authorization and encrypted configuration |
| `mobile/gmail/` | Read-only Gmail REST connector and MIME decoding |
| `mobile/app/` | Android lifecycle, WorkManager, restricted WebView and user-started effects overlay |
| `web/` | Existing dashboard/effects with a separate native transport; desktop HTTP/SSE remains supported |

Build prerequisites are Bash, Python 3 (available as `python`), JDK 17, Android SDK platform 35, NDK `27.3.13750724` (or `ANDROID_NDK_HOME`), Rust, Node.js and the two Rust targets:

```sh
rustup target add aarch64-linux-android x86_64-linux-android
npm --prefix web ci
npm --prefix web run build
bash mobile/scripts/build-android.sh debug
```

Set `ANDROID_SDK_ROOT` to the local SDK directory. The supplied native-build scripts support Linux and macOS hosts; on Windows, use a Linux build environment with its own SDK/NDK installation. The build packages the web assets and compiles native libraries for ARM64 phones and x86-64 emulators. The minimum supported Android version is 11 (API 30). Generated assets, native libraries, APKs, SDK configuration and signing material are not committed.

The build environment must be able to resolve and download from Google's Maven repository (`dl.google.com`) as well as Maven Central, the Gradle distribution service, npm and crates.io. An Android Gradle plugin resolution failure is not evidence that an APK was produced; do not distribute a shell without its bundled dashboard and native libraries.

For a release, supply `SLOP_ANDROID_KEYSTORE` (an absolute private keystore path), `SLOP_ANDROID_STORE_PASSWORD`, `SLOP_ANDROID_KEY_ALIAS` and `SLOP_ANDROID_KEY_PASSWORD` through a secure environment, then run:

```sh
bash mobile/scripts/build-android.sh release
```

Release packaging fails without signing configuration; a debug APK is not a release artifact. Never paste credentials into a checked-in script or shell command history.

Successful builds write the APK and adjacent `.sha256` file under `mobile/app/build/outputs/apk/debug/` or `mobile/app/build/outputs/apk/release/`. Before producing that checksum, the build verifies the APK signature, packaged ARM64/x86-64 native bridge exports, 16-KB ZIP alignment and every dashboard asset byte for byte, including SvelteKit's `_app` JavaScript and styles. Android's default underscore-directory exclusion is overridden so the APK cannot silently omit the dashboard bundle.

Run the existing Rust and web gates in section 3, plus shared-core/bridge formatting, Clippy and tests using their respective manifests. Android-focused gates are:

```sh
bash mobile/scripts/test-jvm.sh
bash mobile/scripts/build-policy.test.sh
bash mobile/scripts/test-signing-config.sh
mobile/gradlew -p mobile :app:testDebugUnitTest :accounts:testDebugUnitTest :core:testDebugUnitTest :app:lintDebug
mobile/gradlew -p mobile :app:connectedDebugAndroidTest
```

The JVM suite exercises connector and synchronization transactions with synthetic fixtures without requiring account credentials. It is not a substitute for Android compilation, lint or instrumentation. The connected gate requires a compatible emulator or device. The shared core keeps `unsafe_code = "forbid"`; only the isolated JNI export boundary permits the native export attribute.

The [Android compatibility workflow](./.github/workflows/android.yml) runs the Rust, web, JVM, build-policy, Android unit-test, lint and debug-APK gates on Linux without personal accounts or signing secrets, including fork pull requests. It does not publish that ephemeral debug APK. A separate job, available only to trusted pushes and manual runs after validation succeeds, restores a dedicated test key and publishes only the certificate-verified OAuth test artifact. No test APK is automatically attached to a production GitHub release. Connected-device tests and real Google account acceptance remain separate manual gates.

### Stable OAuth test signing

Create a dedicated RSA-3072 PKCS12 test keystore once on a secured administrator workstation and retain it in an approved secure backup. Never reuse the Play/release key. Configure GitHub Secrets `SLOP_ANDROID_TEST_KEYSTORE_BASE64`, `SLOP_ANDROID_TEST_STORE_PASSWORD`, `SLOP_ANDROID_TEST_KEY_ALIAS`, and `SLOP_ANDROID_TEST_KEY_PASSWORD`, plus the public Variable `GOOGLE_ANDROID_TEST_CERT_SHA1`. Do not send key bytes, aliases or passwords through chat, logs or source control. The existing `SLOP_ANDROID_*` release settings are independent and unchanged.

Trusted CI decodes the key only into a permission-restricted runner-temporary file, exposes its path as `SLOP_ANDROID_TEST_KEYSTORE`, and passes the other values directly from Secrets. The debug variant uses the `testing` configuration only when all four test-signing environment variables are present. `:app:verifyTestSigning` must succeed before distributable test packaging; missing/partial values, a missing or relative key path, or any other debug signing configuration fails explicitly. Ordinary local debug builds and fork PR validation do not depend on this secret-backed task. `test-signing-config.sh` exercises the task with synthetic non-key fixtures; it requires the Android Gradle toolchain, not real signing credentials.

After building, `verify-oauth-test-apk.sh` verifies the actual APK signature, requires exactly one signer matching `GOOGLE_ANDROID_TEST_CERT_SHA1`, and checks package `com.threadkeeper.slopgrenade` before upload. The artifact `slop-grenade-android-oauth-test` contains `slop-grenade-android-oauth-test.apk` and its adjacent SHA-256 checksum. The temporary keystore is removed even on workflow failure.

Register that exact package/SHA-1 pair as an **Android** OAuth client in the Google testing project. No Android OAuth client ID or secret is embedded in the APK; Desktop OAuth client IDs configured for laptop releases are unrelated. While Google consent remains in Testing, manually add the acceptance-test accounts, without committing their addresses. A different test certificate cannot normally update an installed APK signed with the old certificate; replacing it may require uninstalling the old test app and reconnecting its accounts. See the [full signing and device acceptance procedure](./docs/ANDROID_GOOGLE_OAUTH_CI_SIGNING.md).

### Google authorization prerequisites

1. Enable the Gmail API in a Google Cloud project and configure its OAuth consent screen.
2. Register an **Android OAuth client** for the application's package name and the SHA-1 fingerprint of the certificate actually signing the installed APK. Debug and release certificates differ; register each certificate used for testing or distribution.
3. Configure permitted test accounts while the consent screen is in testing. Request only `https://www.googleapis.com/auth/gmail.readonly`; the app does not send, edit or delete email.
4. Review Google's current restricted-scope verification rules, testing-user limits and authorization-expiry rules before distribution. Workspace administrators may block access. Sideloading bypasses neither consent nor organizational policy.
5. Use a device with Google Play services and an up-to-date Android System WebView. Add and authorize each mailbox independently using **Authorize Gmail account** or **Add another Gmail account**; authorization requiring user interaction must be completed with the app open.

Do not put OAuth client secrets, Google passwords, personal mailbox data or signing keys in this repository. An Android OAuth client is identified by the registered package/certificate, not an embedded confidential-client secret.

References: [Android authorization](https://developer.android.com/identity/authorization), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [incremental synchronization](https://developers.google.com/workspace/gmail/api/guides/sync).

### Scanning and privacy contract

- Scan messages, not threads, with account-scoped identifiers. Archived received messages are included; Drafts, Spam and Trash are excluded. Sent classification refers to messages already sent, including from another device.
- Initial/recovery seven-day refreshes are quiet: no historical effects and no automatic LLM calls. Incremental synchronization follows every page and updates its checkpoint only after successful ingestion.
- A failure for one mailbox must not prevent other mailboxes from being scanned. Authorization failures require reconnection; transient failures use scheduled retries.
- Disconnect removes an account's local connection and stops its future scans, then wipes all communication-derived in-memory history, aggregates, retained events, scanner checkpoints, deduplication state, and active overlay effects. Other connected accounts remain authorized and can quietly repopulate recent history on subsequent scans. The response reports "All communication data wiped."
- Raw bodies used for scoring are discarded afterward. Only account configuration and minimal synchronization state are stored, with sensitive account state encrypted using Android Keystore-backed keys and excluded from backup. Process death clears the ledger; recovery rebuilds recent history quietly.
- Gmail sender pseudonyms and generic subjects are applied **after** scoring, so automated-message detection still sees the original transient metadata. Reports retain signal labels and scores, not verbatim body fragments; sender pseudonyms are stable only within the process.
- While the Android dashboard is visible, it fetches Gmail headers and a short snippet for the current ten-row ledger page and visible leaderboard entries, identifying the connected mailbox for each entry. These view-only details are not written to the ledger, event bus, logs or disk and are cleared on page changes, backgrounding and data wipes. An internet connection and an authorized account are required.
- Successfully decoded empty or attachment-only messages do not block a mailbox's synchronization. Attachment contents and Gmail snippets are not substituted for missing message text; malformed encodings and failed inline-body retrieval still fail the scan without advancing its checkpoint.
- The WebView serves bundled assets only. Native capabilities must not be exposed to arbitrary websites, email HTML or remote scripts.

### Background execution and effects

Periodic WorkManager scheduling has a **15-minute minimum**, and actual execution can be delayed by Doze, connectivity, battery policy and manufacturer restrictions. Closing the dashboard does not cancel scheduled scans. A force-stopped application generally needs to be opened again before work resumes; uninstalling removes its jobs and local state.

Do not disable Android's protections globally or promise uninterrupted scanning. Check the per-account last-success status and the phone's app battery settings when diagnosing delays.

Cross-app effects require explicit **Display over other apps** permission. Open **Effects settings**, then use **Allow overlay** and **Start effects**. **Squeegee incoming** and **Squeegee outgoing** clear the corresponding live edges without changing ledger statistics. Sound and volume changes apply when effects are next started. Android renders effects and the test preview at up to three device pixels per CSS pixel, with a 3.2-megapixel canvas limit to bound memory and rendering cost. The user-started foreground service displays a generic ongoing notification and keeps the touch-through effects layer available when the dashboard is closed. Stop it using **Stop effects** or the notification's **Stop** action; stopping effects never disconnects mailboxes or cancels scheduled scans.

The overlay uses the declared `specialUse` foreground-service type on Android 14+ for user-requested screen-edge rendering, not `dataSync`. It does not poll Gmail or change WorkManager's scan frequency. Effects require app notifications and the **Screen-edge effects** notification channel to be enabled, keeping their status and Stop action visible in the notification drawer. If blocked, enable them in Android app settings; notification denial must not disable mailbox scanning.

Protected screens, revoked overlay permission, Android process management and manufacturer restrictions may interrupt effects. The overlay does not automatically restart after reboot or process termination: reopen the dashboard and choose **Start effects**. Do not promise an uninterrupted service or use foreground rendering to evade background data-sync restrictions. See [background work](https://developer.android.com/develop/background-work/background-tasks/persistent-work), [special-use foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types#special-use) and [foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout).

### APK distribution and acceptance

Use a private, securely backed-up release signing key. Keep the application ID and certificate unchanged for upgrades; losing the key prevents ordinary in-place updates. Never commit signing credentials or use a debug key as a production release identity.

Distribute the signed APK and its SHA-256 checksum through a trusted release channel. On the phone:

1. Download the APK and verify its checksum against that trusted channel.
2. Temporarily allow **Install unknown apps** for the browser or file manager opening the APK.
3. Install it, then turn that permission off again.
4. Open Slop Grenade and authorize each Gmail account from the dashboard. While screen-edge effects
   are running, the Android notification-tray icon also provides a **Connect Gmail** action that opens
   the same in-app account chooser and consent flow.
5. Review monitoring status and, if desired, grant overlay permission, allow notifications and start effects.

Release acceptance requires real-device checks for account consent/reconnection, multiple mailboxes, Doze, offline recovery, reboot, process recreation, force-stop, denied overlay permission, battery usage, clean installation and an in-place signed upgrade. Synthetic unit tests and a successful APK build cannot prove these device/OAuth conditions. No Play Store or cloud push backend is required.

---

## 6. Software Assurance Pipeline & Attack Surface Hardening

Slop Grenade follows the **threadkeeper** software assurance and defense-in-depth model (aligned with `gaia-robot`):

### Automated Supply-Chain & Coverage Assurance
- **`.github/dependabot.yml`**: Opens weekly dependency update PRs across all 5 ecosystems (`github-actions`, `cargo` for `/core`, `/rust`, and `/mobile/rust-bridge`, `npm` for `/web`, `gradle` for `/mobile`, and `docker` for `/`) so security patches can be reviewed and merged on the go.
- **`.github/workflows/assurance.yml`**: Runs nightly (`17 3 * * *`), on manual dispatch, and automatically on any PR that touches a dependency manifest or lockfile:
  - **Coverage Gate**: Enforces `cargo llvm-cov --fail-under-lines 80` on the Rust workspace.
  - **Rust Supply Chain**: Runs `rustsec/audit-check` and `EmbarkStudios/cargo-deny-action` against [`rust/deny.toml`](./rust/deny.toml) (`yanked = "deny"`, `wildcards = "deny"`, `unknown-registry = "deny"`, `unknown-git = "deny"`, `openssl` banned in favor of `rustls-tls`, and permissive SPDX license verification).
  - **Web & Infrastructure Gate**: Runs `npm ci && npm audit --audit-level=low` in `web/` and executes the static infrastructure security suite (`python3 -m unittest discover -s infra -p 'test_*.py'`).

### Application & Infrastructure Hardening
- **Loopback / Same-Origin CORS & CSRF Protection (`rust/src/server.rs`)**: Replaces wildcard `Access-Control-Allow-Origin: *` with origin validation (`is_allowed_origin`) that allows loopback (`127.0.0.1`, `localhost`, `[::1]`), same-host container requests, `https://appassets.androidplatform.net`, and `SLOP_ALLOWED_ORIGIN`, while omitting CORS headers on foreign `GET` requests and rejecting foreign `POST`/`OPTIONS` requests with `403 Forbidden`.
- **Browser Security Headers & Body Cap (`rust/src/server.rs`)**: Attaches `Content-Security-Policy` (with SHA-256 inline `<script>` hashes computed from `web/build/index.html`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`, and `DefaultBodyLimit::max(64 * 1024)`.
- **Credential, Prompt-Injection & Subprocess Guards (`rust/src/llm_luna.rs`, `rust/src/workiq_mcp.rs`)**:
  - `validate_luna_endpoint`: Ensures GitHub tokens are only sent over `https://` to trusted inference hosts (`api.githubcopilot.com`, `models.inference.ai.azure.com`) or local loopback mock servers.
  - `<untrusted_message>` Fencing: Wraps untrusted email/Teams subjects and bodies in explicit XML delimiters and neutralizes embedded closing tags before sending to GPT Luna.
  - `sanitize_workiq_account`: Rejects leading `-` flags, whitespace, shell metacharacters, and control characters on `--account` values passed to the `workiq` CLI.
- **Private-Tenant Container Defaults (`infra/main.bicep`, `Dockerfile`)**: Defaults Azure Container Apps ingress to internal (`externalIngress: bool = false`, `allowInsecure: false`) with `/api/v1/health` liveness/readiness probes and non-root (`USER appuser`, UID `10001`), `--locked` container builds.
