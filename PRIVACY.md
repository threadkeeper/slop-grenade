<p align="center">
  <img src="docs/screenshots/slop-grenade-icon.png" width="120" alt="Slop Grenade funky pink grenade icon">
</p>

# Slop Grenade — Privacy Policy & Google User Data Disclosure

**Effective Date:** October 28, 2026  
**Repository:** [`threadkeeper/slop-grenade`](https://github.com/threadkeeper/slop-grenade)

Slop Grenade is a local-first communication habit monitor and desktop/mobile visual overlay that detects AI-generated writing patterns ("AI slop") across your own communication platforms.

---

## 1. Google API Services User Data Policy & Limited Use Compliance

Slop Grenade's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the **Limited Use** requirements.

---

## 2. Strictly Read-Only Nature of the Application

Slop Grenade operates strictly as a **read-only** observer on your own device:

- **Google / Gmail Scope**: Requests exclusively `https://www.googleapis.com/auth/gmail.readonly`.
- **Microsoft 365**: Queries read-only message metadata via your local first-party brokered WorkIQ MCP client (`workiq`).
- **Zero Write Capabilities**: Slop Grenade never requests permission to—and cannot—compose, send, reply, forward, modify, label, draft, archive, or delete any email, chat message, contact, or calendar item.

---

## 3. Data Accessed, Processed, and Stored

### 3.1 What Data Is Accessed
- **Gmail Profile Verification**: `GET https://gmail.googleapis.com/gmail/v1/users/me/profile` confirms the selected account's identity and connection health. Gmail's message labels determine whether mail was sent or received.
- **Recent Message Content (Bounded 7-Day Window)**: Recent messages from Inbox, archived received mail, and Sent mail within a rolling 7-day window (excluding Drafts, Spam, and Trash) are fetched directly to your local device for writing-style evaluation. Attachments are never downloaded.

### 3.2 How Data Is Used (Ephemeral On-Device Scoring)
- Message text (`text/plain` or sanitized text extracted from `text/html`) is evaluated locally on your device by the 4-signal linguistic detector (Lexical, Structural, Burstiness, and Handoff heuristics) to compute an AI-writing score (`0`–`100`) and trigger local screen-edge animations.
- Raw message bodies and headers used for scoring are discarded afterward. While the Android dashboard is visible, it can separately fetch sender and recipient addresses, subjects, and short Gmail snippets for the current view; these details are discarded when the view changes, the app is backgrounded, or communication data is wiped.
- Google user data is **never** used for advertising, profiling, creditworthiness, or training generalized AI/ML models, and is never read by humans.

### 3.3 How Data Is Stored & Retained
- **No Cloud Database or Remote Storage**: Slop Grenade has no central backend server that collects or stores your emails, chats, or credentials.
- **Ephemeral In-Memory Ledger**: Only sanitized, redacted score summaries and coaching insights are retained in the ledger. Android's separately fetched display details are transient, never added to the ledger or event stream, logged, or saved to disk.
- **In-Memory OAuth Tokens**:
  - **Desktop (Windows & macOS)**: Google OAuth 2.0 access and refresh tokens live exclusively in local daemon process memory (`127.0.0.1`) and are **never written to disk**. Restarting the local daemon clears all tokens and requires re-authorization.
  - **Android**: Account labels and synchronization checkpoints are encrypted with an Android Keystore-backed key and excluded from backup (`allowBackup="false"`). Access tokens are not stored.

### 3.4 Data Sharing & Third-Party Transfers
- Slop Grenade **does not sell, rent, license, or share** Google user data or Microsoft 365 data with any third party.
- All Gmail API traffic occurs directly over TLS (`HTTPS`) between your device and `googleapis.com`.
- When optional semantic evaluation via GitHub Copilot (`gpt-5.6-luna` at `https://api.githubcopilot.com/responses`) is explicitly enabled by the user on desktop, only redacted/sanitized text snippets are evaluated under the user's own GitHub authentication token; Gmail OAuth tokens and raw mailbox records are never shared.

---

## 4. Revocation, Sign-Out & Immediate Data Wipe

You are in full control of your connected accounts at all times:

1. **In-App Sign-Out & Data Wipe**: Clicking **Sign out of Gmail** or **Sign out of Microsoft 365** removes the selected local connection and wipes communication-derived ledger history, statistics, transient display details, and active screen effects. Other connected accounts remain authorized and can repopulate history. Desktop Gmail also attempts token revocation when Google is reachable; on Android, revoke the grant through the Google Account Permissions page if desired.
2. **Google Account Permissions Page**: You may also revoke Slop Grenade's access at any time directly from your Google Account at [https://myaccount.google.com/permissions](https://myaccount.google.com/permissions).
3. **Daemon Restart**: Stopping or restarting the desktop daemon immediately clears all in-memory OAuth tokens and ledger data.

---

## 5. Security Controls Summary

Slop Grenade enforces strict local-first security controls detailed in [SECURITY.md](./SECURITY.md), including loopback-only binding (`127.0.0.1`), OAuth 2.0 PKCE (`S256`) with single-use CSPRNG `state`, memory-safe Rust (`unsafe_code = "forbid"`), strict PII redaction before ledger storage, and locked supply-chain verification (`cargo-deny` + SHA-256 release hashes).

---

## 6. Contact & Support

For privacy questions, security reports, or support inquiries, please open an issue on GitHub at [https://github.com/threadkeeper/slop-grenade/issues](https://github.com/threadkeeper/slop-grenade/issues).

---

[← Back to README](./README.md) · [Terms of Service](./TERMS.md) · [Security Controls](./SECURITY.md)
