# Due-payment reminders: daily push and app-icon badge

## 1. Goal

Each morning, anyone with recurring payments due gets one notification on their iPhone ("2 payments
due: Rent, iCloud"), and the SAYings icon shows how many are waiting, without opening the app.

## 2. Why

Asked for on 2026-10-04, as a follow-up to the long-press shortcuts (1.4.6). The user picked "daily
push + badge" over a badge that only updates while the app is open.

The constraints that shape the plan (WebKit, iOS 16.4+):

- **Badges need notification permission.** `navigator.setAppBadge()` can be called at any time, but
  the number only shows after the user allows notifications. The request has to come from a tap,
  and only inside the home-screen app, not a Safari tab.
- **A closed app can only change its badge from a push event.** Without push, the badge is frozen
  at whatever it was when the app was last open.
- **iOS has no silent push.** Every push must show a notification, or Safari may revoke the
  subscription. So there is no badge-only update in the background: the morning notification *is*
  the background badge update.

Sources: [Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/),
[Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## 3. Current state audit

- **What "due" means is already settled.** `useDueRecurring` (`src/features/recurring/useRecurring.ts`)
  returns the active schedules with `next_on <= today` that belong to the caller (`isMine`,
  `src/lib/recurring.ts`, 1.3.6). The server needs the same rule in SQL: `active = 1`,
  `deleted = 0`, `next_on <= today`, and `COALESCE(created_by, updated_by) = member`.
- **Service worker:** `vite-plugin-pwa` in `generateSW` mode (`vite.config.ts`). It only precaches
  and has no `push` or `notificationclick` handler. We can add one with `workbox.importScripts`
  pointing at a hand-written `public/push-sw.js`, without switching to `injectManifest`.
- **Daily job:** one cron, `30 0 * * *` UTC (`wrangler.jsonc` and the local config). It runs FX
  update → reconcile → backup in `worker/index.ts` `scheduled()`.
- **Secrets:** today only `TEAM_DOMAIN` and `POLICY_AUD` (`.dev.vars.example`). Nothing to sign
  pushes with yet.
- **Recurring page:** route `recurring` exists, so a notification tap can open it.
- **Members** carry `locale` (en/uk/ru), so the server can write the notification in each person's
  language.
- **Sign-in is Cloudflare Access.** The live installation has no passkeys. A service worker woken by
  a push in the background may not have a usable Access session, so the plan does not rely on the
  worker fetching anything after a push: **the push carries its own text** (an encrypted payload).

## 4. Canonical conventions

- **One notification per person per day, and only when something is due.** Nothing due means
  nothing sent.
- **The badge always means "your payments due now".** The app sets it whenever it's open, the
  morning push sets it in the background, and it clears at 0.
- **Push endpoints are treated as secrets.** They're capability URLs, so they're never logged
  (security baseline).
- **The payload is encrypted** (RFC 8291 `aes128gcm`) and signed with VAPID (RFC 8292), using
  WebCrypto in the Worker. No Node `web-push` library, because it doesn't run on Workers.
- **Subscriptions are per device and server-only.** They aren't synced, aren't exported, and aren't
  in backups. A restore leaves you to turn reminders on again, the same as signing in again.
- **The lock screen shows the count and names** (decision 2 in §8).

## 5. UX

### Settings → Reminders (new section, under Recurring)

```
┌──────────────────────────────────────────────┐
│ REMINDERS                                     │
│                                               │
│ Due payments                          [ ○—]   │
│ A notification at 8:00 when a regular         │
│ payment is due, and a count on the app icon.  │
└──────────────────────────────────────────────┘
```

- **Tapping the switch** asks iOS for permission (its own system dialog). If allowed, the phone
  subscribes and the switch turns on. Each phone is separate, so you and your partner each turn it
  on for yourselves.
- **Opened in a Safari tab, not the home-screen app:** the switch is disabled, and the hint reads
  "Add SAYings to your Home Screen first — iPhone only allows reminders there."
- **Permission refused earlier:** the switch is off, and the hint reads "Notifications are off for
  SAYings. Turn them on in iPhone Settings → Notifications → SAYings." Browsers can't ask a second
  time.
- **When on, a "Send a test" link** appears, and sends one notification right away.

### The notification

```
┌──────────────────────────────────────────────┐
│ SAYings                                  now │
│ 2 payments due                                │
│ Rent · Apple iCloud                           │
└──────────────────────────────────────────────┘
```

- In each person's language: "2 payments due", "2 платежа к оплате", "2 платежі до сплати", with
  correct plural forms.
- Tapping it opens Regular payments, where Add now / Skip are already the actions.
- The icon shows **2**. It drops as you post or skip, because the open app sets the badge from the
  live count.

## 6. Phased plan

### Phase 1 — Badge while open, and the permission switch (client only) — shipped 1.4.7

- **Goal:** the icon count works, and reminders can be switched on and off, before any server work.
- **Files in scope:**
  - `src/app/Shell.tsx` (badge effect)
  - `src/features/settings/SettingsPage.tsx`
  - new `src/lib/notifications.ts`
  - `src/i18n/*`
  - tests
- **Deliberately out of scope:** subscribing to push. The switch only handles permission here, so
  this phase ships without a migration or a secret.
- **Behaviour change:**
  - Whenever the app is open, `setAppBadge(dueCount)`, or `clearAppBadge()` at 0. Called whenever
    `useDueRecurring` changes, and a quiet no-op where the API doesn't exist.
  - Settings → Reminders shows the switch with the three states above.
- **New files:** `src/lib/notifications.ts` (support detection, home-screen detection, permission,
  badge), `tests/dom/reminders-setting.test.tsx`.
- **Verification:**
  - `npm run verify`.
  - On an iPhone: turn the switch on, allow notifications, close the app. With a payment due, the
    icon shows the number.

### Phase 2 — Push plumbing and "Send a test" — shipped 1.4.8

- **Goal:** the server can deliver an encrypted notification to a subscribed iPhone.
- **Files in scope:**
  - new `migrations/0016_push_subscriptions.sql`
  - new `worker/push.ts` (VAPID JWT, RFC 8291 encryption, send)
  - `worker/index.ts` (routes)
  - `public/push-sw.js`
  - `vite.config.ts` (`workbox.importScripts`)
  - `src/lib/notifications.ts` (subscribe and unsubscribe)
  - `.dev.vars.example`, `SELF-HOSTING.md`
  - new `scripts/push-keys.mjs`
  - tests
- **Behaviour change:**
  - **Table** `push_subscriptions (endpoint PRIMARY KEY, member_id, p256dh, auth, created_at,
    last_sent_at, failures)`.
  - **Routes:**
    - `POST /api/push/subscribe` and `DELETE /api/push/subscribe`, for the caller's own device only
    - `POST /api/push/test`, which sends to the caller's own devices
  - **Service worker:** `push` shows the payload's title and body and calls `setAppBadge(count)`;
    `notificationclick` focuses or opens `/recurring`.
  - **Keys:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all Worker secrets
    (not config vars), so neither wrangler config changes. The subject is the app's https address,
    not an email.
    - `npm run push:keys` generates the key pair
    - if they're missing, the switch explains that reminders aren't set up on this installation
  - **Dead subscriptions:** a 404 or 410 from the push service deletes the row.
- **Verification:**
  - **Encryption:** a worker unit test checks RFC 8291's published test vector byte for byte.
  - **VAPID token:** a test checks its claims and that it verifies with the public key.
  - **Live:** after deploy, turn reminders on on one iPhone and tap "Send a test". The notification
    arrives and the icon shows the count.

### Phase 3 — The daily reminder — shipped 1.4.9

- **Goal:** the morning notification, sent with no one opening the app.
- **Files in scope:** `worker/index.ts` `scheduled()`, new `worker/reminders.ts`, both wrangler
  configs (second cron), `src/i18n` strings duplicated server-side for en/uk/ru, and tests.
- **Behaviour change:**
  - New hourly cron `7 * * * *`. Each run sends only if it's past 08:00 `Europe/Kyiv` and
    today's reminder hasn't gone out (`last_sent_at` compared as a Kyiv date), so it stays 08:00
    through the clock change (decision 1).
  - For each member with reminders on: count their due payments with the SQL rule from §3. If above
    zero, send one notification to each of their devices with the count and names, and record
    `last_sent_at`. A second run on the same day sends nothing.
  - Only the daily job stamps `last_sent_at`; "Send a test" records results without it, so a test
    at 07:30 does not count as that morning's reminder (found while building this phase).
  - Failures are counted per subscription. A 404 or 410 removes it. One person's failure never
    stops another's reminder or the nightly backup (separate try blocks, as now).
- **Verification:**
  - **Worker tests:**
    - two members with different due schedules each get only their own count and names
    - nothing due sends nothing
    - a re-run the same day sends nothing
    - a 410 deletes the subscription
  - **Live:** set a test schedule due today, then trigger the cron with
    `wrangler triggers` / `curl` against `__scheduled` locally. The next morning, the real one
    arrives.

## 7. Guardrails

- The nightly FX/backup job runs unchanged; the reminder job is a separate cron and try block.
- Totals, members and the sync counter are unchanged after each deploy (same before/after
  queries as the data-integrity plan).
- No endpoint, key or payload is ever passed to `console.*` (grep check in the Phase 2 tests).
- Without VAPID keys set, everything else works and the reminder switch says why it can't turn on.

## 8. Decisions (answered 2026-10-04)

1. **Time: 08:00 Kyiv time all year.** An hourly cron (`7 * * * *`) checks whether it is past
   08:00 in `Europe/Kyiv` and nobody has been sent today's reminder yet. `scheduled()` branches on
   `controller.cron`, so the nightly FX/backup run at `30 0 * * *` is untouched.
2. **Lock screen: count and names**, e.g. "2 payments due · Rent · Apple iCloud".
3. **Overdue: remind every morning until handled**, the same rule as the badge.
