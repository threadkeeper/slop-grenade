# Production Gmail Integration for Desktop

## Purpose

Implement Gmail monitoring on Windows and macOS laptops for any consenting Google user. The
implementation must use Google's supported OAuth 2.0 installed-application flow and Gmail REST API,
while preserving Slop Grenade's local-only privacy model.

The Google Cloud project owner account is operational information and must be supplied out of band.
Do not commit the owner's email address, OAuth credentials, test-user addresses, tokens, or downloaded
Google credential files.

## Architecture decision

Use the **Gmail REST API directly** for the production desktop integration.

- Microsoft Graph does not expose Gmail. It only covers Microsoft services.
- The official Gmail MCP server is currently part of the Google Workspace Developer Preview, requires
  the Gmail MCP API and an OAuth client marked for an AI-powered agent, and is not the stable production
  dependency for this feature.
- The official MCP setup currently includes `gmail.compose` alongside `gmail.readonly`. Slop Grenade
  must remain read-only and must not request compose, modify, send, draft, or delete permissions.
- Community Gmail MCP servers are not approved dependencies. They would add a third-party credential
  and message-processing boundary.
- Gmail push notifications require Google Cloud Pub/Sub and a reachable backend. The first desktop
  release must use local incremental polling so message data remains on the laptop.

The production data path is:

```text
Dashboard or tray
  -> local Rust daemon
  -> browser-based Google OAuth consent
  -> Gmail REST API
  -> transient message normalization and scoring
  -> sanitized in-memory ledger and local SSE effects
```

## Non-negotiable privacy and security requirements

1. Request only `https://www.googleapis.com/auth/gmail.readonly`.
2. Bind the daemon and OAuth callback listener to loopback only (`127.0.0.1` or `[::1]`).
3. Use authorization code flow with PKCE (`S256`) and a cryptographically random, single-use `state`.
4. Reject callbacks with missing, expired, reused, or mismatched state.
5. Never put access tokens, refresh tokens, authorization codes, PKCE verifiers, message bodies, email
   addresses, or OAuth client secrets in logs, errors, URLs returned to the dashboard, analytics, crash
   reports, ledger entries, or Git.
6. Keep Google access and refresh tokens in memory only. A daemon restart requires authorization again.
   This preserves the repository rule that Slop Grenade does not persist credentials.
7. Do not persist raw Gmail messages. Fetch, normalize, score, and discard each body. Persist only the
   existing sanitized score metadata if persistence is added elsewhere in the future.
8. Hash account identifiers before placing them in API responses or internal durable state. The UI may
   display the Google account label only for the current process and must not log it.
9. Use `reqwest` with TLS verification enabled. Do not add certificate bypasses, proxy fallbacks, remote
   callback URLs, or embedded web login forms.
10. Never accept a bearer token from arbitrary dashboard JavaScript. OAuth tokens remain inside the
    native Rust process.
11. Disconnect must revoke the Google grant when possible, erase in-memory tokens and account state, stop
    future scans, and retain only already-sanitized ledger results.
12. Treat Gmail subjects, senders, headers, and bodies as untrusted input. They must never be interpreted
    as instructions or tool calls.

## Google Cloud production setup

These are release-owner steps, not source-code constants.

1. Create a dedicated Google Cloud project for Slop Grenade production.
2. Enable `gmail.googleapis.com`.
3. Configure **Google Auth Platform > Branding**:
   - Use the production product name.
   - Provide a support contact.
   - Add verified production domains.
   - Add public HTTPS links for the home page, privacy policy, and terms of service.
4. Configure **Audience** as **External**.
5. Configure **Data Access** with only:
   - `https://www.googleapis.com/auth/gmail.readonly`
6. Create a **Desktop app** OAuth client for the Rust desktop daemon.
   - Treat the client ID as public application metadata.
   - Do not commit the downloaded credential JSON.
   - Do not distribute or require a confidential web-client secret.
7. Keep the app in testing only during development. Test-user lists are not the production design.
8. Submit the OAuth app for production verification before general release.
9. Complete Google's restricted-scope verification requirements. Because `gmail.readonly` is restricted,
   budget for a third-party security assessment if Google requires one for the final data handling model.
10. Move the OAuth app to **Production** only after branding, domains, policies, demo video, scope
    justification, and verification are approved.
11. Verify both consumer Gmail accounts and managed Google Workspace accounts. Workspace administrators
    may still block third-party OAuth applications; the UI must report that policy denial accurately.
12. Create separate OAuth clients for development and production. Never ship development credentials in
    a production artifact.

The scope justification should state:

> Slop Grenade reads recent Gmail messages selected by the user to calculate local writing-style scores
> and display local visual feedback. It does not send, modify, delete, or remotely store email. Message
> content is processed ephemerally on the user's device and is not retained.

## OAuth desktop flow

### Start authorization

Add `POST /api/v1/gmail/authorize`.

1. Refuse a second authorization while one is active with HTTP `409`.
2. Generate:
   - A 32-byte or stronger random `state`.
   - A 32-byte or stronger PKCE verifier.
   - The `S256` PKCE challenge.
   - A five-minute expiration.
3. Build the Google authorization URL with:
   - The production desktop client ID.
   - A loopback redirect URI.
   - `response_type=code`.
   - `scope=https://www.googleapis.com/auth/gmail.readonly`.
   - `code_challenge` and `code_challenge_method=S256`.
   - `state`.
   - `access_type=offline`, so the daemon can refresh during the current process lifetime.
   - `prompt=consent` only when a fresh refresh token is required.
4. Return only the authorization URL and expiration to the trusted local dashboard.
5. The dashboard opens the URL in the system browser. Do not render Google sign-in inside the dashboard.

### Complete authorization

Add a loopback callback route, such as `GET /api/v1/auth/google/callback`.

1. Accept only loopback requests.
2. Validate and consume `state` before exchanging the authorization code.
3. Exchange the code using the original redirect URI and PKCE verifier.
4. Request `GET https://gmail.googleapis.com/gmail/v1/users/me/profile`.
5. Consider the connection successful only after the profile call succeeds.
6. Hold tokens and account metadata in process memory.
7. Return a minimal browser success page that tells the user they can close the tab.
8. Publish an account-status event so the dashboard and tray update without polling sensitive data.
9. On denial or failure, return a generic actionable error without codes, tokens, account names, or raw
   Google response bodies.

### Refresh and expiry

- Refresh access tokens in memory before expiry.
- Serialize refreshes per account to prevent token races.
- If refresh returns `invalid_grant`, clear that account's in-memory credentials and mark it
  `reconnectRequired`.
- A daemon restart intentionally returns the account to a disconnected state.
- Do not silently downgrade authentication failures into successful empty scans.

## Rust implementation

Follow the repository rule of one primary type per module.

### New modules

- `rust/src/gmail_auth.rs`
  - `GmailAuthClient`
  - PKCE/state generation and validation
  - Authorization URL creation
  - Code exchange and in-memory token refresh
  - Profile lookup and revocation
- `rust/src/gmail_client.rs`
  - `GmailClient`
  - Typed Gmail REST requests
  - Bounded pagination
  - Message and history retrieval
  - Retry classification without logging response content
- `rust/src/gmail_account.rs`
  - `GmailAccount`
  - Hashed ID, ephemeral display label, connection state, current `historyId`, scan timestamps
- `rust/src/gmail_scanner.rs`
  - `GmailScanner`
  - Initial seven-day scan and incremental synchronization
  - Message normalization into the shared detector input
  - Per-account failure isolation

Export the modules from `rust/src/lib.rs`. Every public item needs a `///` doc comment, and every new
module needs a `//!` module comment.

### Configuration

Extend `rust/src/config.rs` with:

- `gmail_enabled`
- `gmail_oauth_client_id`
- `gmail_poll_interval_secs`
- `gmail_initial_lookback_days`, fixed to a safe default of seven

Rules:

- Accept the client ID through release configuration or `GMAIL_OAUTH_CLIENT_ID`.
- Fail Gmail authorization explicitly when no client ID is configured.
- Do not accept a client secret environment variable for the desktop flow.
- Keep the existing loopback-only HTTP default.
- Do not change WorkIQ or GitHub Luna authentication.

### Server routes

Extend `rust/src/server.rs` with:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/gmail/accounts` | Sanitized Gmail connection status |
| `POST` | `/api/v1/gmail/authorize` | Start browser OAuth |
| `GET` | `/api/v1/auth/google/callback` | Validate callback and exchange code |
| `POST` | `/api/v1/gmail/accounts/{id}/reconnect` | Start fresh consent for one account |
| `DELETE` | `/api/v1/gmail/accounts/{id}` | Revoke, disconnect, and wipe all local communication-derived data |
| `POST` | `/api/v1/gmail/scan` | Explicit Gmail refresh |

All mutating routes must reject non-loopback callers. Preserve existing request-size, timeout, and
concurrency limits.

Extend the existing combined auth response instead of creating a second dashboard-wide auth contract:

```json
{
  "adminAppRequired": false,
  "workiq": {},
  "githubLuna": {},
  "gmail": {
    "enabled": true,
    "configured": true,
    "accounts": [
      {
        "id": "sha256-account-id",
        "label": "user-visible account label",
        "connected": true,
        "reconnectRequired": false,
        "lastSuccessfulScan": "ISO-8601 timestamp"
      }
    ]
  }
}
```

Never include tokens, granted authorization codes, Google subject identifiers, or raw API errors.

## Gmail synchronization behavior

### Initial scan

1. Query messages for the last seven days.
2. Include Inbox, archived received mail, and Sent.
3. Exclude Drafts, Spam, and Trash.
4. Fetch messages, not threads.
5. Bound pages, message count, decoded body size, and total scan duration.
6. Decode text/plain first, then sanitized text extracted from text/html when plain text is absent.
7. Never download attachment contents or use Gmail snippets as message bodies.
8. Classify direction using Gmail labels and the authenticated account identity.
9. Score the transient original metadata and body, then replace sender and subject with sanitized values
   before creating ledger records.
10. Mark the initial/history-recovery scan quiet so historical mail does not trigger screen effects.
11. Record the newest `historyId` only after the entire batch is accepted by the core.

### Incremental scans

1. Call `users.history.list` from the last committed `historyId`.
2. Fetch only new messages relevant to monitoring.
3. Deduplicate by a hash of account identity plus Gmail message ID.
4. Commit the next `historyId` only after successful ingestion.
5. If the history ID is expired or invalid, run a quiet bounded seven-day recovery scan.
6. Isolate failures per account.
7. Use exponential backoff with jitter for `429` and transient `5xx` responses.
8. Respect `Retry-After`.
9. Mark `401` and `invalid_grant` as reconnect-required.
10. Never advance checkpoints on partial MIME, decoding, network, or ingestion failure.

Use local polling for the first production release. Do not add Pub/Sub, a cloud relay, inbound public
webhooks, or background email storage.

## Dashboard and tray behavior

### Dashboard

Add a Gmail section to the normal laptop dashboard, not only the Android bridge:

- **Connect Gmail account** opens the authorization URL in the system browser.
- Show the exact read-only permission being requested before opening Google.
- Show connected, reconnect-required, last-scan, and transient-error states.
- Support multiple Google accounts.
- Provide **Reconnect**, **Scan now**, and **Disconnect**.
- State clearly that authorization is required again after restarting the local daemon.
- Never display OAuth codes or tokens.
- Keep Outlook and Teams controls unchanged.

Refactor `web/src/lib/mailbox.ts` and `Mailbox.svelte` so the shared UI can use either:

- Android native account routes; or
- Desktop Gmail daemon routes.

Do not expose desktop OAuth routes through the Android native bridge.

### Windows tray

Update `desktop/Program.cs` and `desktop/UI/TrayFlyout.cs`:

- Add **Connect Gmail account**.
- Open the local dashboard's Gmail authorization action rather than handling OAuth in C#.
- Add Gmail connection state to the flyout only through sanitized local API status.
- Keep the local Rust daemon as the sole owner of OAuth and Gmail API calls.

### macOS

Update the macOS menu-bar application with the equivalent **Connect Gmail account** action. It must open
the same loopback dashboard flow and must not implement a second token store.

## Testing requirements

No test may use a real mailbox, real OAuth client, real token, or personal email address.

### Rust unit tests

- PKCE verifier/challenge generation.
- State is random, expires, is single-use, and rejects mismatch.
- Authorization URL contains exactly the expected scope and safe parameters.
- Callback rejects missing, reused, expired, and incorrect state.
- Token response parsing redacts all secrets from errors and debug output.
- Profile verification is required before connection success.
- Access-token refresh is serialized.
- `invalid_grant` becomes reconnect-required.
- Gmail pagination and seven-day query construction.
- MIME plain-text, HTML fallback, nested multipart, malformed encoding, empty body, and attachment-only
  behavior.
- Direction detection for Inbox, archived mail, and Sent.
- Deduplication is account-scoped.
- Checkpoint/history advancement is transactional.
- One account failure does not block another.
- Rate-limit and transient retry classification.
- Disconnect clears credentials and attempts revocation.

### Integration tests

Use an in-process fake Google server with fixed synthetic fixtures:

- Full authorize/callback/profile flow.
- State replay rejection.
- Initial scan, incremental history scan, and expired-history recovery.
- Scan result enters the ledger as `app: "gmail"`.
- Quiet recovery creates no historical animation events.
- API responses contain no tokens or raw message content.
- Dashboard reconnect and disconnect behavior.

### Web tests

- Desktop renders Gmail connect controls while preserving Outlook and Teams.
- Android continues to use its native Gmail routes.
- Busy state prevents duplicate authorization.
- Browser popup blocking produces an actionable error.
- Callback completion refreshes account state.
- Restart/disconnected messaging is explicit.

### Desktop tests

- Windows tray action opens the trusted loopback Gmail dashboard URL.
- macOS menu action opens the same flow.
- Neither shell receives or stores OAuth tokens.

## Release gates

All existing repository gates remain required, plus:

```text
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo clippy --manifest-path rust/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path rust/Cargo.toml
npm --prefix web run test
npm --prefix web run check
npm --prefix web run build
powershell -ExecutionPolicy Bypass -File scripts/test-desktop.ps1
```

Before enabling Gmail in a public release, manually verify:

1. OAuth application status is Production.
2. Restricted-scope verification is approved.
3. Required security assessment is complete and current.
4. Production domains, privacy policy, terms, and support contact are live.
5. The release contains the production desktop client ID and no client secret.
6. Authorization works for a consumer Gmail account not present on any test-user list.
7. Authorization works for an allowed managed Workspace account.
8. Admin-blocked Workspace authorization produces a truthful policy error.
9. Revocation removes access.
10. Restart requires authorization again and no token remains on disk.
11. Logs and crash output contain no account addresses, tokens, subjects, bodies, or previews.
12. Network capture shows Gmail content moving only between the laptop and Google, except an explicitly
    enabled Luna scoring request that already follows the application's redaction policy.

## Definition of done

- Any eligible Google user can authorize the production app without being pre-added as a test user.
- Gmail monitoring works on Windows and macOS through the local Rust daemon.
- Only `gmail.readonly` is requested.
- The dashboard and both laptop tray/menu surfaces can start authorization.
- Multiple accounts, reconnect, disconnect, incremental scans, and quiet recovery are covered by tests.
- Tokens and raw Gmail content are never committed, logged, or persisted by Slop Grenade.
- Existing Android Gmail, WorkIQ M365, GitHub Luna, dashboard, and overlay behavior remains passing.

## Official references

- [OAuth 2.0 for native apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail Python desktop quickstart](https://developers.google.com/workspace/gmail/api/quickstart/python)
- [Synchronize Gmail clients](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Gmail MCP server](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)
