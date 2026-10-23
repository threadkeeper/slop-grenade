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

- **Real Human Writing (0–19)**: Barely visible, delicate plumes of warm sparkles drift gently upward near the edge of your screen.
- **Calm, Lightly Polished Note (20–39)**: A small, peaceful cloud drifts across the top corner of your monitor.
- **Mild AI Assistance (40–59)**: One of **20 realistic, hand-illustrated fruits** (such as a Honeycrisp Apple, Bartlett Pear, Ruby Strawberry, Emerald Kiwi, or Alphonso Mango) bounces playfully along the edge.
- **Heavy Corporate Slop (60–79)**: A lump of thick sludge splats onto the edge of your screen.
- **Full Slop Grenade (80–100)**: A **dull metallic blue hand grenade** arcs across your desktop, impacts the side of your monitor, and drips thick poop-like slop down the bezel:
  - **Slop You Receive (Left Side of Monitor)**: Drips and builds up in **Brown-Red**.
  - **Slop You Send (Right Side of Monitor)**: Drips and builds up in **Brown-Blue**.
  - **Daily Buildup & Squeegee**: Slop stays caked on the sides of your monitor as the day progresses until you click the **Squeegee** button on that side of your screen to wipe the glass clean.

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

### 1. The System Tray Icon (Daily Midnight-Resetting Gauges)
Look for the **Slop Grenade** icon in your Windows System Tray (bottom-right taskbar near the clock):
- The icon itself displays **two live vertical gauges** that reset automatically at midnight (`00:00`) every day:
  - **Left Bar (Brown-Red)**: How much AI slop you have **received** today.
  - **Right Bar (Brown-Blue)**: How much AI slop you have **sent** today.
- **Left-click the Tray Icon** to open the compact popup where you can:
  - View today's **Received (In)** and **Sent (Out)** slop gauges.
  - Toggle **Run at Windows startup**, **Teams / Outlook monitoring**, and **Slop / Non-Slop animations**.
  - Click **Squeegee Left** or **Squeegee Right** to wipe your monitor edges clean.
  - Click **Open Dashboard**.

### 2. The Habit Dashboard (`http://127.0.0.1:8090/`)
Clicking **Open Dashboard** in the tray opens a clean, distraction-free habit tracker in your browser featuring:
- **Daily In / Out Slop Gauges** and an **In vs. Out Slop Bar Chart** over time.
- **Filters** for time span (`Today`, `7d`, `30d`, `All`), source (`Teams` vs. `Outlook`), and message type (`Slop` vs. `Non-Slop`).
- **Top 5 Sloppers** (the biggest senders of AI slop) and **Top 5 P-Doomers** (the colleagues who refuse to touch AI and type 100% human messages).

---

## Technical Documentation

For architecture details, API endpoints, build/test commands, and container deployment templates, see [TECHNICAL.md](./TECHNICAL.md).
