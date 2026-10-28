<p align="center">
  <img src="docs/screenshots/slop-grenade-icon.png" width="120" alt="Slop Grenade funky pink grenade icon">
</p>

# Slop Grenade — Security Controls & Architecture

**Repository:** [`threadkeeper/slop-grenade`](https://github.com/threadkeeper/slop-grenade)

Slop Grenade is engineered around a **local-first, zero-trust, read-only** security posture so that personal emails, chats, and OAuth credentials never leave your device or persist on disk.

---

## 1. Strictly Read-Only Data Access

- **Gmail OAuth Scope Pinning**: Desktop and Android Gmail integrations request only `https://www.googleapis.com/auth/gmail.readonly`. Any OAuth response or authorization URL that does not match this single read-only scope is rejected.
- **No Write Surface**: The codebase contains no API routes, client methods, or scopes capable of composing, sending, modifying, labeling, drafting, or deleting emails or chat messages.
- **Bounded Queries**: Gmail synchronization is strictly bounded by page count, message count, 7-day lookback window, decoded body byte limits, and request timeouts, excluding Drafts, Spam, and Trash. No email attachments are ever downloaded.

---

## 2. Authentication & Credential Protection

- **Standalone User-Auth Registration (No Client Secrets)**:
  - **Desktop Gmail**: Uses Google's OAuth 2.0 installed-application Authorization Code flow with **PKCE (`S256`)** (32-byte CSPRNG verifier) and a 32-byte single-use CSPRNG `state` token with a 5-minute expiration. No client secret is embedded, accepted, or distributed.
  - **Android Gmail**: Uses Google Play Services `AuthorizationClient` bound to package name `com.threadkeeper.slopgrenade` and a pinned signing certificate SHA-1 fingerprint.
  - **Microsoft 365**: Uses the local first-party brokered **WorkIQ MCP** CLI (`workiq`), requiring zero enterprise admin app registrations.
- **In-Memory Ephemeral Tokens (Desktop)**: Google OAuth access and refresh tokens are held exclusively in the Rust daemon's volatile memory and are never written to disk, logs, or browser storage. Restarting the daemon requires re-authorization.
- **Sign-Out Revocation & Complete Data Wipe**: Disconnecting an account revokes the Google token grant, clears in-memory credentials, increments the reset epoch, and wipes all communication-derived ledger entries and active overlay effects.

---

## 3. Network & Local API Isolation

- **Loopback-Only Binding**: The desktop HTTP/SSE daemon binds to `127.0.0.1:8090` by default. Mutating and OAuth callback routes verify that the peer socket is loopback (`127.0.0.1` or `::1`).
- **Browser Popup & Redirect Hardening**: The web dashboard validates that authorization URLs use `https://accounts.google.com` on default port `443` with no embedded credentials, opens Google sign-in in a detached browser tab (`popup.opener = null`), and never accepts bearer tokens from dashboard JavaScript.
- **Cache & Header Controls**: All `/api/v1/auth/*` and `/api/v1/gmail/*` responses set `Cache-Control: no-store` and omit sensitive error details.
- **TLS Enforcement & Endpoint Pinning**: Outbound HTTPS calls use `rustls` (`reqwest` with TLS verification enabled; OpenSSL is banned via `cargo-deny`) and validate exact hosts (`accounts.google.com`, `oauth2.googleapis.com`, `gmail.googleapis.com`, `api.githubcopilot.com`).

---

## 4. Data Minimization, Redaction & Untrusted-Input Handling

- **Ephemeral Scoring Pipeline**: Raw message bodies and headers are scored in memory and immediately dropped.
- **Sanitized In-Memory Ledger**: Before any report enters the in-memory ledger or SSE event bus, sender/recipient identifiers, subjects, and previews are sanitized and truncated, and account IDs are hashed with SHA-256.
- **Prompt-Injection & XSS Prevention**: Email subjects, senders, headers, and MIME bodies are treated strictly as untrusted data. HTML bodies are converted to plain text before scoring and are never rendered as raw HTML or interpreted as LLM tool instructions.
- **Allowlisted Error Mapping**: Provider exceptions and raw HTTP error bodies are never surfaced to the UI or logs; only allowlisted status categories are displayed.

---

## 5. Memory Safety & Supply-Chain Assurance

- **Rust Memory Safety**: Both `core/Cargo.toml` and `rust/Cargo.toml` enforce `unsafe_code = "forbid"` and `missing_docs = "deny"`.
- **Supply-Chain Auditing**: Continuous integration enforces `cargo-deny` (blocking known advisories, yanked crates, wildcards, unknown registries/git sources, and `openssl`), `rustsec/audit-check`, `npm audit`, and Dependabot across Cargo, npm, Gradle, Docker, and GitHub Actions.
- **Verifiable Releases**: Every portable Windows, macOS, and Android artifact is published with a companion `.sha256` checksum file, and container images run as a non-root user (`UID 10001`).

---

## 6. Reporting a Vulnerability

If you discover a security issue in Slop Grenade, please report it via [GitHub Issues / Security Advisories](https://github.com/threadkeeper/slop-grenade/security) without including any personal credentials, tokens, or private message content.

---

[← Back to README](./README.md) · [Privacy Policy](./PRIVACY.md) · [Terms of Service](./TERMS.md)
