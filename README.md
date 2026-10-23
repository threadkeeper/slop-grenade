# Slop Grenade

**Slop Grenade** is a lightweight Windows desktop companion that helps you and your team notice—and break—the habit of sending unedited AI-generated fluff in Microsoft Teams and Outlook.

It runs quietly in the background on your Windows PC, watches the messages you send and receive across Microsoft 365, and gives instant visual feedback right on the edges of your monitor.

---

## The Philosophy: Why "Slop Grenade"?

We have all been on the receiving end of a **Slop Grenade**:
- Someone types a five-second prompt into an AI assistant (*"Write a comprehensive update on Q4 priorities"*).
- Without editing, trimming, or adding any real human thought, they paste 500 words of bolded bullet points (`- **Strategic Alignment:** Fostering holistic synergy...`) into a Teams chat or email thread and hit **Send**.
- It took the sender **10 seconds** to pull the pin and throw. It now takes everyone else on the team **20 minutes** to wade through the sludge and figure out what the sender actually wants.

Good workplace communication is short, human, and considerate of other people's attention. **Slop Grenade** exists to make invisible cognitive pollution visible—especially in **your own outgoing messages**—so you can build better communication habits day by day.

---

## What Happens on Your Screen

Slop Grenade overlays your main Windows desktop monitor without interrupting your work (you can click and type right through the animations in any app):

- **`human` (0–19)**: Barely visible, delicate plumes of warm sparkles shine, twinkle, and fade smoothly into nothing.
- **`polish` (20–39)**: A small, calm cloud drifts softly from the edge of your monitor and fades into nothing.
- **`sprinkled` (40–59)**: One of **20 realistic, hand-illustrated fruits** (such as a Honeycrisp Apple, Bartlett Pear, Ruby Strawberry, Emerald Kiwi, or Alphonso Mango) bounces in and sticks to the edge buildup until squeegeed.
- **`ai-cannon` (60–79)**: A compact lump of glossy vinyl slop splats onto the edge of your screen and stays until squeegeed.
- **`slop-grenade` (80–100)**: A **dull metallic blue hand grenade** arcs across your desktop, impacts the side of your monitor, and drips glossy vinyl slop down the bezel:
  - **Slop You Receive (Left Side of Monitor)**: Drips and builds up in **Plastic Pink**.
  - **Slop You Send (Right Side of Monitor)**: Drips and builds up in **Plastic Blue**.
  - **Daily Buildup & Squeegee**: Fruit (`sprinkled`) and grenades/slop (`slop-grenade` and `ai-cannon`) stay stuck along the sides of your monitor as the day progresses—sized compactly so even 500 emails and 500 Teams messages fit along the bezel—until you click **Squeegee Left** or **Squeegee Right** in the System Tray icon to wipe that side clean.

---

## Step-by-Step Setup Guide

### Step 1: Sign In to Microsoft 365 (WorkIQ MCP)

Slop Grenade reads your Microsoft Teams and Outlook activity through the **WorkIQ** command-line tool using your normal Microsoft 365 sign-in.

Open PowerShell and run:

```powershell
# Accept the WorkIQ license agreement (first time only)
workiq accept-eula

# Sign in with your Microsoft 365 work account
workiq auth login
```

A standard Microsoft sign-in prompt will appear. Once signed in, WorkIQ can securely read your recent Teams and Outlook messages on your machine.

---

### Step 2: Sign In to GitHub Copilot (for LLM Slop Scoring)

To let Slop Grenade use **GitHub Copilot's LLM** alongside its built-in text analyzer, sign in with the GitHub CLI:

```powershell
gh auth login
```

Follow the on-screen prompt to sign in with your GitHub account that has GitHub Copilot access. Slop Grenade will automatically use your active GitHub session—no API keys or config files required.

---

### Step 3: Install and Run on Windows

From the repository folder, run the one-step local installer:

```powershell
.\scripts\install-local.ps1
```

What this does automatically:
1. Installs the app into your local Windows profile (`%LOCALAPPDATA%\SlopGrenade`).
2. Adds **Slop Grenade** shortcuts to your **Desktop** and **Start Menu**.
3. Configures Slop Grenade to **start automatically when you sign in to Windows** (you can toggle this on or off anytime from the System Tray icon).
4. Starts the background scanner and the desktop screen overlay immediately.

---

## Using the System Tray & Habit Dashboard

### 1. The System Tray Icon (Bright Pink Hand Grenade)
Look for the **Bright Pink Hand Grenade** icon in your Windows System Tray (bottom-right taskbar near the clock):
- Slop Grenade pings your **WorkIQ MCP** server every **1 minute** and triggers a desktop animation for each and every new message that comes through (automated and machine-generated system replies are always classified as the gentle `human` sparkle type).
- **Left-click the Tray Icon** to open the compact tray popup where you can:
  - View today's **Received (In)** and **Sent (Out)** slop gauges (which reset automatically at `00:00` midnight daily and progress from **White at 0% to Fully Purple at 100%**).
  - Click **Squeegee Left** or **Squeegee Right** to wipe your monitor edges clean.
  - Toggle **Run at Windows startup**, **Teams / Outlook monitoring**, and **Slop / Non-Slop animations**.
  - Click **Open Dashboard**.

### 2. The Habit Dashboard (`http://127.0.0.1:8090/`)
Clicking **Open Dashboard** in the tray opens a clean, distraction-free habit tracker in your browser featuring:
- **Daily In / Out Slop Gauges** with a **0–100% Marker** that transitions from **White (0%) to Fully Purple (100%)**.
- **Per-Day Stacked Bar Chart** broken down by type (`slop-grenade` in bright blue, `ai-cannon` in brown, `sprinkled` in bright yellow, `polish` in bright green, and `human` in white).
- **Filters** for time span (`Today`, `7d`, `30d`, `All`), source (`Teams` vs. `Outlook`), and message type (`All`, `slop-grenade`, `ai-cannon`, `sprinkled`, `polish`, `human`).
- **Top 5 Sloppers** and **Top 5 P-Doomers** (the colleagues who refuse to touch AI).
- **Interactive Drill-Down Grid** at the bottom ranked by highest slop score, showing the score, type, source, core metrics, sender, recipient, subject, and a short preview of each message.

---

## Technical Documentation

For architecture details, API endpoints, build/test commands, and container deployment templates, see [TECHNICAL.md](./TECHNICAL.md).
