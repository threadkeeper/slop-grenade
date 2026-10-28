<p align="center">
  <img src="docs/screenshots/slop-grenade-icon.png" width="120" alt="Slop Grenade funky pink grenade icon">
</p>

# Slop Grenade — Terms of Service

**Effective Date:** October 28, 2026  
**Repository:** [`threadkeeper/slop-grenade`](https://github.com/threadkeeper/slop-grenade)

By downloading, installing, or using **Slop Grenade**, you agree to these Terms of Service.

---

## 1. Description of Service & Read-Only Operation

Slop Grenade is an open-source, local-first desktop and mobile application that analyzes recent communication messages on your device to provide visual cues and habit metrics regarding AI-generated writing patterns ("AI slop").

- **Read-Only Access**: Slop Grenade operates strictly in read-only mode. When connected to Gmail, it requests only the `https://www.googleapis.com/auth/gmail.readonly` OAuth scope. It cannot and does not send, modify, draft, or delete messages on your behalf.
- **Local Execution**: You run Slop Grenade on your own workstation or mobile device using your own authenticated accounts.

---

## 2. License & Open-Source Software

Slop Grenade is distributed under the open-source [LICENSE](./LICENSE) included in the [`threadkeeper/slop-grenade`](https://github.com/threadkeeper/slop-grenade) repository. Subject to the terms of that license, you may inspect, build, and run the software locally.

---

## 3. User Responsibilities & Acceptable Use

1. **Authorized Accounts Only**: You may only connect Google or Microsoft 365 accounts that you are legally authorized to access.
2. **Compliance with Organization Policies**: If you connect a managed Google Workspace or Microsoft 365 account, you are responsible for complying with your organization's IT and data governance policies. Slop Grenade respects administrator OAuth policy blocks and will surface policy denials without attempting to bypass them.
3. **No Misuse**: You must not use Slop Grenade to harvest, exfiltrate, or store third-party communications in violation of applicable privacy or data protection laws.

---

## 4. Privacy & Google User Data

Your use of Slop Grenade is governed by our [Privacy Policy](./PRIVACY.md), which incorporates compliance with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) (including the Limited Use requirements) and our [Security Controls](./SECURITY.md).

---

## 5. Informational Nature of AI Detection Scores

AI detection scores (`0`–`100`) and tiers (`human`, `polish`, `sprinkled`, `ai-cannon`, `slop-grenade`) are heuristic and statistical estimates intended for personal self-awareness and coaching. They are not definitive proof that a message was or was not authored with AI assistance and must not be used as the sole basis for disciplinary, legal, or employment decisions.

---

## 6. Disclaimer of Warranties & Limitation of Liability

SLOP GRENADE IS PROVIDED **"AS IS"** AND **"AS AVAILABLE"** WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS, CONTRIBUTORS, OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## 7. Termination & Account Disconnection

You may stop using Slop Grenade at any time by signing out of connected accounts in the dashboard/tray (which immediately wipes local in-memory history and revokes OAuth grants), revoking access via [Google Account Permissions](https://myaccount.google.com/permissions), or uninstalling the software.

---

[← Back to README](./README.md) · [Privacy Policy](./PRIVACY.md) · [Security Controls](./SECURITY.md)
