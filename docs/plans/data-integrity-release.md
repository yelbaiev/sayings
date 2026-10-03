# Data-integrity release

## 1. Goal

Close the server-side and currency bugs found in the 2026-10-03 bug check, so that sync can never
lose rows, every figure stays correct through a base-currency change, and a nightly backup can
rebuild a working installation on its own.

## 2. Why

A four-area bug check on 2026-10-03 (after 1.3.7) found these. The quick, client-only half shipped as
1.3.8; this is the other half: the parts that touch sync, the worker, migrations or backups.

None of them has damaged the live household. Checked against D1 that day: 932 transactions, head rev
478, base UAH, currencies UAH/EUR/USD only, no budgets, no `fx_estimated` rows, every row's
`fx_base` equal to the base. They are latent: each fires on growth (more than 2000 changes in one
pull), on a settings change (switching the base), on a currency with 0 or 3 decimals, or on a
restore. Those are the cases this app exists to survive: it was built because Saldo went dark for
a week and took five years of history with it.

## 3. Current state audit

| # | Bug | Where | Fires when |
|---|-----|-------|------------|
| A | A truncated pull still returns the global head rev as the cursor, so the rows past the cap are skipped forever | `worker/sync.ts` `handleSync` (`rev: await currentRev(db)`), `PULL_LIMIT = 2000`; `src/db/sync-client.ts` stores `response.rev` | One table has more than 2000 rows above a device's cursor: a new device, a reset mirror, a big import |
| B | `bumpRev` and the upsert are two awaited statements; `currentRev` is read after the pull | `worker/sync.ts` loop, `worker/db.ts` `bumpRev` | Two devices sync at the same moment: a row lands below a cursor another device has already passed |
| C | The nightly reconcile rewrites price fields without bumping `rev`/`updated_at`, and its rate subquery ignores `fx_rates.base` | `worker/fx/index.ts` reconcile (~l.280-315) | Any entry saved offline (`fx_estimated = 1`). The server fixes it; phones never hear |
| D | No client write sets `fx_base`, so every new row gets the column default `'UAH'` | `migrations/0009_tx_fx_base.sql`; writers in `EntrySheet.tsx`, `QuickTiles.tsx`, `useRecurring.ts`, `useRepeatLast.tsx`, `HistoryPage.tsx`, `ImportPage.tsx` | Any household whose base is not UAH, then a base change: those rows are skipped by `repriceTransactions` (`fx_base != ?`) |
| E | Reprice converts 400 rate dates per call, then reprices 500 transactions against whatever is converted so far; later rows take the newest converted rate and are never revisited | `worker/reprice.ts` `repriceToBase` → `convertRates` then `repriceTransactions` | A base change on a household with more than 400 rate dates |
| F | Budgets are not converted on a base change; `budget.currency` is never read | `src/lib/budget-engine.ts`, `worker/reprice.ts` | Any base change with budgets: ₴20 000 becomes €20 000 |
| G | Every price path computes `amount_minor * rate`, ignoring minor-unit digits; `convertMinor` exists and is unused | `src/features/entry/EntrySheet.tsx`, `QuickTiles.tsx`, `RateField.tsx`, `ImportPage.tsx`, `src/lib/fx.ts` (`toBase`, `pricingFor`), `src/db/useRates.ts`, `src/lib/report-engine.ts` `netWorthOverTime`, `worker/reprice.ts`, `worker/fx/index.ts` | Any 0-digit (JPY, KRW, ISK, VND) or 3-digit (TND) currency: 100× or 10× wrong |
| H | The nightly JSON backup leaves out `households`, `app_meta`, `credentials`, `household_seq`, and the `base`/`source` of `fx_rates`; the restore script carries only what it gets | `worker/backup.ts` `runBackup`, `scripts/db-restore.mjs` `jsonToSql` | Restoring a nightly snapshot to a fresh D1: no passkeys (locked out), base reset, cursor restarts at 1 so every existing device misses new writes |
| I | `/api/sync` lets any member write any `members` row, including `role`, `email`, `deleted` | `worker/sync.ts` (only `household_id`, `updated_by` are forced) | A member pushes `role: "owner"` for themselves, or `deleted: 1` for the owner |
| J | The invite is marked used, but the result is not checked, so two parallel verifies both mint a member | `worker/passkeys.ts` `inviteVerify` | One invite link opened twice at once |
| K | The rollover walk starts at the earliest month and stops after 36, so it counts the *oldest* 36 months | `src/lib/budget-engine.ts` `rolloverCredit` | A rollover budget on a category with more than 36 months of history |

Not covered by the existing `npm run deploy` safety net: the pre-deploy `.sql` export is a complete
`wrangler d1 export`, so H only matters when a *nightly* snapshot is what you have.

Client writes to `members` are only ever the caller's own row, and only `display_name`, `locale` and
`default_account_id` (`src/app/AppContext.tsx`, `src/features/settings/SettingsPage.tsx`). That sets
the rule for I.

## 4. Canonical conventions

- **A cursor never passes a row it has not delivered.** The `rev` a pull returns is the highest rev
  *in that response*, never the table head.
- **Rev allocation and the write it labels are one `db.batch`.** No await between them.
- **Every server-side rewrite of a synced row bumps `rev` and `updated_at`.** One rev per batch is
  enough (see `repriceTransactions`).
- **Money crosses currencies only through `convertMinor`** (`shared/money.ts`). A `* rate` on a
  `*_minor` value outside that function is a bug; a lint rule or a grep test enforces it.
- **Every priced row says what it was priced in** (`fx_base`), written by the client that priced it.
- **A backup is complete if a fresh D1 plus that file is a working installation.** Proven by a
  round-trip test, not by reading the table list.
- Forward-only migrations (ADR 0004), and backup before migrate (`npm run deploy` already does it).

## 5. Phased plan

Each phase is one commit, one version bump, one `npm run deploy`. Versions follow the workspace
scheme: 1.3.9, 1.4.0, 1.4.1, …

### Phase 1 — Sync never skips a row (A, B) — shipped 1.3.9

- **Goal:** a device that is any number of rows behind always catches up completely.
- **Files in scope:** `worker/sync.ts`, `worker/db.ts`, `tests/worker/sync.test.ts`.
- **Deliberately out of scope:** `src/db/sync-client.ts`. The client already loops while `more`
  and stores whatever `rev` it is given, so a correct server cursor fixes it with no client change,
  which also fixes it for phones that haven't updated yet.
- **Behaviour change:**
  - Pull: query each table with `LIMIT PULL_LIMIT`. If any table hits the limit, the cursor is the
    smallest "last rev" among the truncated tables. Rows above it (in any table) are dropped from
    this response and come next time. `more = true`.
  - A truncated table's page is completed to the end of its last rev (`changesThrough`). Revs are
    not unique: the seed put 30 categories at rev 1, and the Saldo import wrote 611 live
    transactions under one rev. A page that stopped partway through a rev would skip the rest of it.
    Found by the Phase 1 tests, not the original check.
  - Otherwise the cursor is the max rev in the response, or `since` if it is empty. `currentRev` is
    no longer used for the cursor.
  - Push: each accepted row is written in one `db.batch([bump, upsert])`, with the upsert reading the
    new rev from `household_seq` inside the batch, so no rev is ever visible before its row.
  - `PULL_LIMIT` becomes a parameter (default 2000) so a test can use 2.
- **New files:** none.
- **Modified files:**
  - `worker/sync.ts`: cursor calculation and the batched push.
  - `worker/db.ts`: an upsert variant that takes its rev from a subquery.
  - `tests/worker/sync.test.ts`: the new cases below.
- **Verification:**
  - New tests:
    - 5 transactions and 3 categories, limit 2: three looping pulls from `since = 0` return all 8,
      in rev order, with `more` false on the last.
    - A push and a pull interleaved never yield a cursor above an undelivered row.
  - `npm run verify`.
  - After deploy: on one phone, Settings → reset local mirror. The row count afterwards matches
    `SELECT COUNT(*) FROM transactions WHERE deleted = 0`.

### Phase 2 — Every priced row says its base, and corrections reach phones (C, D) — shipped 1.4.0

- **Goal:** `fx_base` is always true, and the nightly reconcile is visible to clients.
- **Files in scope:** the six writers listed in D, `src/lib/fx.ts`, `worker/fx/index.ts`,
  `worker/sync.ts`, tests.
- **Deliberately out of scope:** the `* rate` arithmetic itself. That is Phase 4. Mixing the two
  makes a wrong figure impossible to bisect.
- **Behaviour change:**
  - Every client write sets `fx_base: baseCurrency`. `pricingFor` returns it too.
  - The server: a pushed transaction without `fx_base` (an old client) is stamped with the
    household's current base. This is the old default made honest, not a guess, because that client
    priced it against the base it knew.
  - Reconcile:
    - one `bumpRev` per run, written with `updated_at = now`
    - the rate subquery adds `AND f.base = <household base>`
    - only rows with `fx_base = <household base>` are touched; rows mid-reprice are Phase 3's job
- **New files:** none.
- **Modified files:**
  - the six client writers: send `fx_base`
  - `worker/sync.ts`: stamp a missing `fx_base`
  - `worker/fx/index.ts`: reconcile rev, base filter
  - tests
- **Verification:**
  - New worker tests:
    - Reconcile bumps rev; a pull from the old cursor returns the corrected row.
    - A row without `fx_base` gets the household's base.
  - New unit test: every writer's row includes `fx_base`. A grep test over `put("transactions"`
    call sites is acceptable.
  - After deploy: `SELECT COUNT(*) FROM transactions WHERE fx_base != (SELECT base_currency FROM
    households)` stays 0.

### Phase 3 — A base change converts everything, correctly (E, F) — shipped 1.4.1

- **Goal:** switching the base gives the same totals a fresh household in that base would have.
- **Files in scope:** `worker/reprice.ts`, `src/features/settings/BaseChangeSheet.tsx` (progress
  text only), `tests/worker/reprice.test.ts`.
- **Deliberately out of scope:** `src/lib/budget-engine.ts` arithmetic. Budgets are converted at
  rest by the worker, so the engine keeps summing one currency.
- **Behaviour change:**
  - `repriceToBase` reprices no transaction until `convertRates` reports no dates left. A call that
    converted rates returns `remaining > 0` and the client calls again, as it already does.
  - Rate conversion only picks dates that quote the new base. Unconvertible dates used to fill
    every batch, so with more than 400 of them the change stalled. Found while building this phase.
  - Budgets whose `currency != newBase` are converted at the latest rate and get a fresh rev.
    Converted, not reset, so the limit still means the same money (decision 3).
- **New files:** none.
- **Modified files:**
  - `worker/reprice.ts`: ordering, plus a `repriceBudgets` step
  - `BaseChangeSheet.tsx`: "converting rates…" vs "re-pricing entries…"
  - tests
- **Verification:**
  - New worker tests:
    - 3 years of rates (more than 400 dates) and 600 transactions, UAH→EUR. Every transaction's
      `fx_rate` equals the converted rate for its own date, not the newest one.
    - A budget of ₴20 000 becomes about €450 at the seeded rate.
  - Round trip: UAH→EUR→UAH returns every `base_amount_minor` to within 1 minor unit of the start.
  - No production smoke test. The live household isn't changing its base; the tests are the proof.

### Phase 4 — Minor-unit digits (G) — shipped 1.4.2

- **Goal:** ¥1000 is ₴270, not ₴2.70.
- **Files in scope:** every path listed in G; `shared/money.ts` only if `convertMinor` needs a
  rounding mode; `migrations/0015_reprice_minor_digits.sql` (decision 1).
- **Deliberately out of scope:** display formatting of 0- and 3-digit currencies in
  `formatAmount(cents=true)`. Cosmetic, and listed in the leftovers phase.
- **Behaviour change:** all conversions go through `convertMinor`. A test fails the build if
  `_minor * rate` (or `* fx.rate`, `* resolved.rate`) appears outside `shared/money.ts`.
- **New files:**
  - `tests/unit/no-raw-conversion.test.ts`
  - `migrations/0015_reprice_minor_digits.sql` (decision 1)
- **Modified files:** about 10 call sites, each a one-line swap.
- **Verification:**
  - Unit tests: JPY, TND and EUR into UAH, each against a hand-worked figure.
  - Existing entry-rate DOM tests unchanged for UAH, EUR and USD.
  - After deploy: `SELECT SUM(base_amount_minor) FROM transactions WHERE deleted = 0` is unchanged.
    The household has only 2-digit currencies, so the sum must not move.

### Phase 5 — A nightly backup is a whole installation (H) — shipped 1.4.3

- **Goal:** a fresh D1, the migrations, and one nightly JSON file give a working app that the
  existing devices can keep syncing with.
- **Files in scope:** `worker/backup.ts`, `scripts/db-restore.mjs`, `tests/worker/backup.test.ts`,
  `SELF-HOSTING.md` (restore section).
- **Behaviour change:**
  - The snapshot gets `schema: 2` and adds:
    - `households`
    - `app_meta`
    - `credentials` (WebAuthn public keys and counters; no secrets)
    - `household_seq`
    - full `fx_rates` rows
  - It still excludes sessions, challenges and invites. Those are short-lived; restoring them would
    revive expired access.
  - The restore script handles `schema: 1` (as now, with a printed warning about what it can't
    bring back) and `schema: 2`.
  - `household_seq` is set to `max(database's own, snapshot's, max rev in rows) + 1`, and every
    restored row is re-stamped with it, so every device re-reads the restored state. (Planned as
    snapshot-only; a rollback into the same database has a counter above every device, which the
    snapshot's alone would not beat.)
  - Also fixed: `db-restore.mjs` called wrangler without `-c`, so it read the blank template config.
    Found while verifying this phase.
- **New files:** none.
- **Modified files:** the four above.
- **Verification:**
  - New worker test: back up a seeded DB, restore into an empty migrated DB, then:
    - log in with the stored credential
    - the base is unchanged
    - a pull from the old cursor gets new writes
  - After deploy: trigger the cron once (or wait a night), download the snapshot, run
    `npm run db:restore -- <file> --local` and open the local app against it.

### Phase 6 — Members can only change themselves; one invite, one member (I, J) — shipped 1.4.4

- **Goal:** sync can't be used to promote, rename or delete another member, and an invite is
  single-use under concurrency.
- **Files in scope:** `worker/sync.ts`, `worker/passkeys.ts`, `tests/worker/members.test.ts`,
  `tests/worker/passkeys.test.ts`.
- **Deliberately out of scope:** any owner-only admin UI for removing a member. That's a feature,
  not this fix.
- **Behaviour change:**
  - A `members` change is accepted only for `row.id === member.id`. `role`, `email`, `deleted`,
    `avatar_color` and `created_at` come from the stored row, never the payload. A row for anyone
    else is dropped and returned in `conflicts` with the stored version, so the client heals.
  - `inviteVerify` checks the `UPDATE`'s `meta.changes === 1` and refuses otherwise.
- **Modified files:** the four above.
- **Verification:**
  - New tests:
    - Pushing `role: "owner"` for self leaves role `member`.
    - Pushing another member's row changes nothing and returns a conflict.
    - Two parallel `inviteVerify` calls produce one member.
  - Existing passkey and members suites green.

### Phase 7 — Leftovers — shipped 1.4.5

- **Goal:** the small items from the check, none needing the server.
- **Behaviour change:**
  - K: the rollover walk starts at `max(start, addMonths(month, -36))`.
  - Merging categories also moves recurring templates and budgets from the merged category.
  - CSV export gets a UTF-8 BOM; everything is one zip (`src/lib/zip.ts`, stored entries, no
    dependency).
  - `AccountsPage.tsx` currency hint goes through i18n.
  - `formatAmount(cents=true)` uses the currency's own digits.
- **Files in scope:**
  - `src/lib/budget-engine.ts`
  - `src/features/categories/CategoriesPage.tsx`
  - `src/features/settings/export.ts`
  - `src/features/accounts/AccountsPage.tsx`
  - `src/lib/format.ts`
  - `src/i18n/*.ts`
  - tests
- **Verification:**
  - Unit tests for K and the formatting.
  - A DOM test for the merge.
  - Open an exported CSV in Excel and check the Cyrillic.

## 6. Guardrails

Run before and after every deploy, and compare. Each phase except 3 must leave these identical:

```sql
SELECT COUNT(*) AS n, SUM(base_amount_minor) AS base_sum, SUM(amount_minor) AS native_sum
  FROM transactions WHERE deleted = 0;
SELECT COUNT(*) FROM transactions WHERE fx_base != (SELECT base_currency FROM households);
SELECT rev FROM household_seq;          -- only ever increases
SELECT id, role, deleted FROM members;  -- unchanged
```

Also:

- **Both phones keep syncing:** after each deploy, add one entry on each phone and see it on the
  other within a pull. The old client must also keep working with the new server until it updates.
  Phases 1, 2 and 6 are designed so it does.
- **Pre-deploy `.sql` export exists:** `npm run deploy` does it; confirm the file landed in
  `backups/` and R2.
- **No new `* rate` on a minor amount** (after Phase 4, enforced by the test).

## 7. Order

1 → 2 → 3 → 4 → 5 → 6 → 7.

- Phase 1 goes first: it is the only one that can lose data for the live household just through
  growth.
- Phases 2 and 3 are ordered because Phase 3's reprice relies on `fx_base` being true.
- Phase 4 comes after 3 so the reprice code is already settled when its arithmetic changes.
- Phases 5, 6 and 7 are independent and can go in any order.

## 8. Decisions (answered 2026-10-03)

1. **Phase 4, existing 0/3-digit rows:** fix them with a forward-only migration that recomputes
   `base_amount_minor` from `amount_minor` and `fx_rate` for those currencies. A no-op for this
   household.
2. **Phase 5, passkeys in backups:** include the public keys and counters. Sessions, challenges and
   invites stay out.
3. **Phase 3, budgets on a base change:** convert at today's rate.
4. **Phase 6, renaming members:** own profile only. No owner exception.
