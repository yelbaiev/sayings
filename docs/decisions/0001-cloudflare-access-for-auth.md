# 0001 — Use Cloudflare Access instead of building authentication

**Status**: accepted
**Date**: 2026-08-05

## Context

SAYings has exactly two users, both known by email address, on phones and occasionally on
desktop web. It holds the household's complete financial history. Authentication needs to be
strong and low-maintenance, and the project is committed to Cloudflare as a single vendor.

The alternatives considered were passkeys (WebAuthn), email magic links, and a shared
passphrase plus device PIN.

## Decision

Put Cloudflare Access (Zero Trust) in front of the entire Worker, with a policy allowing the
two email addresses, and have the Worker verify the injected JWT.

## Why

- Zero authentication code to own. For an app guarding financial data with a user base of
  two, the security value of *not* writing a session system outweighs any UX gain from a
  bespoke one.
- Free for up to 50 users, and stays inside the single-vendor constraint.
- Sessions can run up to a month, so the login friction is roughly monthly, not daily.
- Passkeys would have given the nicest daily login, but they mean owning credential storage,
  recovery, and session lifetime — a meaningful surface for a two-person app. Magic links
  would have required an email sender, breaking single-vendor.

## Consequences

- **The Worker must verify the JWT.** Access injects `Cf-Access-Jwt-Assertion`, but any client
  can set a header, so the signature, issuer, and audience are all checked in
  `worker/auth.ts`. Header presence proves nothing.
- **Verification fails closed.** If the audience is unset or still the placeholder, `/api/*`
  returns 500. A misconfigured deploy must not degrade into accepting unverified requests.
- **An expired session returns a 302, not a 401.** This is the sharp edge. Left unhandled, a
  `fetch` from the installed PWA hits an opaque cross-origin redirect and the app silently
  stops syncing. Handled once in `src/lib/api.ts` via `redirect: "manual"` plus a guarded
  full-page navigation, and the service worker never precaches `/api/*`.
- **That navigation must go through `/api/reauth`, not reload the page.** The service worker
  answers every other navigation from its precache, so a reload never reaches Access: until
  1.5.3 the installed app reloaded into the same cached shell, spent its one attempt and sat on
  an empty screen. `/api/reauth?to=<path>` is on the service worker's denylist, so Access intercepts it;
  once past, the Worker redirects back to `to` (same-origin paths only). If the trip still
  doesn't restore a session, the boot shows a "Sign in again" screen rather than looping.
- Identity comes from the JWT's `email` claim, mapped to a `members` row. Access service
  tokens (no email claim) are rejected — this app has no machine callers.
- There can be no public page. Acceptable: there is nothing here to show anyone.
