# Security

## Reporting a vulnerability

Use GitHub's **[Report a vulnerability](../../security/advisories/new)** button, which opens a
private advisory. Please do not open a public issue for anything exploitable.

This is a spare-time project with no security team and no SLA. A realistic expectation is a reply
within a week. Say so in the report if you intend to disclose publicly on a schedule, and it will be
respected rather than negotiated.

## What is and is not in scope

Every installation is separate. There is no shared service, no central database, and no
infrastructure belonging to this project — so there is nothing to compromise centrally. Findings
worth reporting are ones that would affect **every** installation:

**In scope**

- Anything that lets an unauthenticated request read or write data. The Worker verifies the Access
  JWT's signature, issuer and audience on every `/api/*` route (`worker/auth.ts`); a way around that
  is the most serious class of bug here.
- A way for one household member to read or alter data outside their household. Every query is
  scoped by `household_id`.
- Anything that causes silent data loss or corruption: money arithmetic, the sync merge, a migration
  that destroys rows.
- Secrets or personal data leaking into logs, error responses, or the client bundle.
- A default that leaves a fresh deployment open. The setup screen exists because Cloudflare Access
  cannot be configured by a deploy, and a finance app that serves itself without authentication is a
  vulnerability regardless of whose fault the configuration is.

**Not in scope**

- Your own Cloudflare account configuration — an Access policy set to `Everyone`, a preview URL left
  unrestricted, a leaked API token. Real risks, but yours to hold. `SELF-HOSTING.md` calls out the
  ones people actually get wrong.
- `npm audit` findings in the dev toolchain that are not in the deployed bundle. See the README's
  "Known audit findings"; report it if you can show it reaches production.
- Anything requiring a compromised device that already holds the full local mirror.

## What protects your data

Worth stating plainly, because "it's open source" invites the wrong conclusion:

- **The gate is a passkey, not the secrecy of this code.** Sign-in is WebAuthn: phishing-resistant,
  nothing to type, nothing reusable to steal. Sessions and invite links are stored only as SHA-256
  hashes, so even a full database read-out contains no working login. A fresh deployment must be
  claimed immediately — see SELF-HOSTING.md — because until then the first visitor owns it.
- **Cloudflare Access is optional hardening on top.** Identity is checked at
  Cloudflare's edge before a request reaches the Worker, and the Worker independently verifies the
  JWT against your team's public keys. Publishing the source does not weaken either.
- **This repository contains no credentials.** `TEAM_DOMAIN` and `POLICY_AUD` are public identifiers
  by design. `.dev.vars` is gitignored and has never been committed.
- **Your data is never in the repository.** It is in your D1 database and on your devices.
- **The Access policy is the whole membership list.** Anyone it lets through gets a member row on
  first sign-in, with no cap on how many — so the policy is not a first line of defence with the app
  as a second, it is the only line. See the warning in SELF-HOSTING.md about using an `Emails`
  selector rather than a domain match.

The residual risk in a public project like this is not the code being read — it is **phishing the
people whose addresses are in your Access policy**. Turning on 2FA for those accounts does more for
your finances than any change to this codebase will.
