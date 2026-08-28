# A second currency beside the totals

`463 967 ₴ ≈ 10 500 €` — the same figure said again in a currency the reader thinks in.

## What this is not

It is **not** a second base currency. The base is a household setting that re-prices every stored
transaction when it changes, which is why changing it has its own sheet and its own warnings. This
is a *display* preference: nothing is stored differently, nothing is re-priced, and turning it off
leaves no trace. Keeping those two apart is the whole design.

## Where it lives

`DevicePrefs`, beside the theme — no migration, no worker change, no schema permission needed.

That makes it per-device rather than per-person, with a cost worth stating: setting it on the phone
does not set it on the desktop. The alternative, a column on `members`, would sync and would mean a
migration plus an API change. Worth doing if the two-device annoyance bites; not worth doing first.

## The rate, and why `≈`

Today's rate, everywhere, from the same `useLatestRates` the home screen already totals with.

For a current figure — net worth, a balance — that is simply correct. For a historical one — July's
spending — it answers "what that is worth today" rather than "what it was worth then". Both are
defensible; being *consistent* across every screen matters more than picking the cleverer one, and
the `≈` is what marks the figure as a conversion rather than a fact. A currency with no rate held
shows nothing at all rather than a guess.

## Phase 1 — the preference and the display

**Allowed**: `src/db/dexie.ts`, `src/app/AppContext.tsx`, `src/db/useRates.ts`, `src/ui/index.tsx`,
`src/features/settings/SettingsPage.tsx`, `src/i18n/*.ts`, tests.
**Forbidden**:
- `migrations/**`, `worker/**` — a display preference has no business in the database schema.
- `shared/money.ts` — the arithmetic is unchanged; this reads figures, it does not make them.
- `src/features/settings/BaseChangeSheet.tsx` — that flow re-prices a ledger. Nothing here does.

## Phase 2 — the places it shows

**Allowed**: `src/features/home/HomePage.tsx`, `src/features/reports/ReportsPage.tsx`,
`src/features/reports/charts.tsx`, tests.

Totals only, never row amounts: a second figure beside every line in a list is noise, and the list
rows are already in their own account's currency. So — the household total on the home screen, net
worth, the month's income/expenses/net, the donut's centre, and the cashflow month.

**Verification**: `npm run verify`, plus a render of the home total and the report headers with a
secondary currency set and with none.
