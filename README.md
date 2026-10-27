# Slop Grenade - a single pane of glass to detect AI generated content across all of your communications platforms.

Slop Grenade is built to work across all of your communications platforms—spanning team chat, direct messaging, email, and collaborative channels—from a single unified desktop overlay and habit dashboard.

1. **Protects you and your staff from getting lazy with AI.**
2. **Provides visual cues to help you stay cognizant at all times to the impending AI slop, cannons, grenades and pending doom.**
3. **Think before you slop.**

<p align="center">
  <img src="docs/screenshots/proving-grounds-demo.gif" width="880" alt="Slop Grenade Proving Grounds monitor displaying the three core principles while buttons are pressed to launch grenades, AI cannons, fruit, smoke, and twinkles that build up along both screen edges">
</p>

---

## Dashboard

<p align="center">
  <img src="docs/screenshots/dashboard.jpg" width="1000" alt="Anonymized Slop Grenade dashboard with colored alphabetical callout badges A through M next to each component">
</p>

### Dashboard Component Guide (`A` – `M`)

- **A — Refresh Button**: Syncs the dashboard with the local detector and backfills recent messages for the selected time span without replaying old screen animations.
- **B — Effects Test Range (Target Icon)**: Opens an interactive preview monitor where you can test-fire grenades, cannons, fruit, smoke, sparkles, and squeegees without affecting your live statistics.
- **C — Sound FX & Volume Controls**: Toggles synthesized retro audio cues on or off and adjusts effect volume (`0%`–`100%`).
- **D — Time Span Filter (`Span`)**: Switches the active reporting window between **Today** (since local midnight), **Last 3 days** (rolling 72 hours), and **Last 7 days** (rolling 168 hours).
- **E — Direction Filter (`Direction`)**: Filters gauges, charts, leaderboards, and the ledger by **All**, **Incoming** (messages received), or **Outgoing** (messages sent by you).
- **F — Platform Source Filter (`Source`)**: Filters activity across connected communication platforms (**All**, **Chat**, or **Email**).
- **G — Detection Tier Filter (`Types`)**: Isolates messages by AI detection tier (**All**, **slop-grenade**, **ai-cannon**, **sprinkled**, **polish**, or **human**).
- **H — Incoming Slop Gauge**: Analog dial showing the percentage of incoming human-sent messages that read as AI-generated (score `40+`), along with total message, AI-written, and grenade counts.
- **I — Outgoing Slop Gauge**: Analog dial tracking the AI percentage of your own sent messages so you can catch yourself before getting lazy with AI.
- **J — Daily Damage Report**: Stacked timeline bar chart breaking down message volume by detection tier across time buckets (click any bar to filter the dashboard to that slice).
- **K — Most Wanted (`Highest % AI`)**: Top 5 contacts sending the highest share of AI-generated messages in the selected window (click any person to filter the ledger).
- **L — Hand-Crafted Heroes (`Lowest % AI`)**: Top 5 contacts with the lowest AI share who consistently write genuine, human-crafted messages.
- **M — The Ledger**: Sortable, paginated table (`50` messages per page) showing each message's **Slop %**, local **Date & time**, **Type**, **Source**, 4-signal heuristic breakdown (`L`exical · `S`tructural · `B`urstiness · `H`andoff and word count), **From**, **To**, **Subject**, and sanitized **Preview**.

---

## Downloads, Installation & SHA-256 Hashes

Download the latest verified release from the [**GitHub Releases Page (`threadkeeper/slop-grenade/releases/latest`)**](https://github.com/threadkeeper/slop-grenade/releases/latest):

| Platform | Release Package | SHA-256 Checksum File |
| :--- | :--- | :--- |
| **Windows 10/11 (x64)** | [`slop-grenade-windows-x64.zip`](https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-windows-x64.zip) | [`slop-grenade-windows-x64.zip.sha256`](https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-windows-x64.zip.sha256) |
| **macOS 13+ (Universal)** | [`slop-grenade-macos-universal.tar.gz`](https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-macos-universal.tar.gz) | [`slop-grenade-macos-universal.tar.gz.sha256`](https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-macos-universal.tar.gz.sha256) |
| **Android 11+ (OAuth testing)** | [Trusted Android Actions run](https://github.com/threadkeeper/slop-grenade/actions/workflows/android.yml): `slop-grenade-android-oauth-test` | Included `slop-grenade-android-oauth-test.apk.sha256` |

### Verify SHA-256 Hashes & Install

**Windows:**
```powershell
Invoke-WebRequest https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-windows-x64.zip -OutFile slop-grenade-windows-x64.zip
Invoke-WebRequest https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-windows-x64.zip.sha256 -OutFile slop-grenade-windows-x64.zip.sha256
$expected = (Get-Content .\slop-grenade-windows-x64.zip.sha256).Split(' ')[0].Trim().ToLowerInvariant()
$actual   = (Get-FileHash .\slop-grenade-windows-x64.zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -eq $expected) { Write-Host "SHA-256 verified: $actual" -ForegroundColor Green } else { throw "SHA-256 mismatch!" }

Expand-Archive .\slop-grenade-windows-x64.zip -DestinationPath .\slop-grenade
.\slop-grenade\install-local.ps1
```

**macOS:**
```bash
curl -fsSLO https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-macos-universal.tar.gz
curl -fsSLO https://github.com/threadkeeper/slop-grenade/releases/latest/download/slop-grenade-macos-universal.tar.gz.sha256
shasum -a 256 -c slop-grenade-macos-universal.tar.gz.sha256

mkdir -p slop-grenade-macos && tar -xzf slop-grenade-macos-universal.tar.gz -C slop-grenade-macos
./slop-grenade-macos/install-macos.sh
```

**Android OAuth testing:** Download and extract `slop-grenade-android-oauth-test` from a successful trusted Actions run. Pull-request builds do not publish installable test APKs. Verify both the checksum and certificate before installing:
```bash
shasum -a 256 -c slop-grenade-android-oauth-test.apk.sha256
apksigner verify --print-certs slop-grenade-android-oauth-test.apk
```

The signer SHA-1 must match `GOOGLE_ANDROID_TEST_CERT_SHA1`, registered with Google for package `com.threadkeeper.slopgrenade`. Test APKs use a dedicated stable certificate, not the production release key, and are not automatically attached to public releases. See the [Android signing setup](./docs/ANDROID_GOOGLE_OAUTH_CI_SIGNING.md).

---

## Documentation

- **Desktop Gmail:** Set `GMAIL_OAUTH_CLIENT_ID` to your release's Google Desktop app client ID, then use **Connect Gmail account** in the dashboard or tray/menu. Only `gmail.readonly` is requested. Tokens remain in daemon memory; restarting requires authorization again. Local polling quietly imports the last seven days before monitoring new messages. No client secret or credential JSON is needed. Public distribution requires the release-owner approvals in the [production Gmail setup and release gates](./docs/GMAIL_DESKTOP_PRODUCTION.md).
- **Sign-out privacy:** Signing out wipes all communication-derived history and active effects. Other connected providers remain authorized and may repopulate history on subsequent scans.
- [**Detection Algorithm & Scoring Rubric**](./research/ai-slop-and-slop-grenade.md)
- [**Technical Data Sheet & Developer Guide**](./TECHNICAL.md)
