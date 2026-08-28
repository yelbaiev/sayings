# Amount entry everywhere, and three smaller repairs

Four things, ordered so each is shippable on its own and the cheap ones land first. One release at
the end.

## Phase 1 — hold ⌫ to clear

**Goal.** Wiping a mistyped amount stops costing one press per digit.

**Allowed**: `src/lib/calc.ts`, `src/features/entry/Keypad.tsx`, `tests/unit/calc.test.ts`,
`tests/dom/entry-layout.test.tsx`.
**Forbidden**: `src/lib/press-gesture.ts` — it decides what a press on the *add button* means, and
its one invariant (a tap always fires) is not this. A backspace that deletes on the way down and
clears if held is a different shape; tangling them would put the FAB's deadlock bug back in reach.

**Behaviour**: pressing ⌫ deletes one character as now; holding it past 550ms clears the whole
expression, once, and does not also delete on release.

**Verify**: unit test for `pressClear`; a DOM test that a held backspace empties the field and a
tapped one does not.

## Phase 2 — repeat-last stops being invisible

**Goal.** The long-press on the add button is discoverable.

**Allowed**: `src/app/Shell.tsx`, `src/i18n/*.ts` (the `entry.repeatLast` string already exists in
all three), `tests/dom/shell-entry-context.test.tsx`.
**Forbidden**: `src/features/entry/useRepeatLast.tsx` — the behaviour is right, only its visibility
is wrong.

**Behaviour**: the add button's tooltip names the long press when there is something to repeat.

**Verify**: DOM test that the label appears only with a previous transaction to repeat.

## Phase 3 — the pad wherever an amount is typed

**Goal.** Six more fields get the keypad, the arithmetic and the typed-number display.

**Allowed**: `src/features/entry/AmountField.tsx` (new), the six call sites
(`BudgetsPage`, `AccountsPage`, `RecurringPage`, `QuickTiles`, `SplitSheet`,
`EntrySheet`'s transfer leg), `src/styles/components.css`, new tests.
**Forbidden**:
- `src/features/entry/RateField.tsx` — an FX rate is not money. It needs more decimal places than
  any currency has, and `Expression` is scaled to a currency's minor unit. Forcing it through would
  round 41.2345 to 41.23.
- `RecurringPage`'s day-of-month input — a count, not an amount.
- `src/lib/calc.ts` — it is complete; this phase consumes it.

**Behaviour**: the field shows the amount as typed, tapping opens the pad beneath it, and the same
`120+45` arithmetic applies. The entry sheet keeps its own footer-mounted pad: it is amount-first,
where these are forms with one amount among several fields.

**Verify**: each site still saves the same figure it did with a plain input, including the currency
switchers next to three of them.

## Phase 4 — a running balance down the history

**Goal.** "What did this card hold after that transaction."

**Allowed**: `src/lib/running-balance.ts` (new), `src/features/transactions/HistoryPage.tsx`,
`TransactionRow.tsx`, new tests, `src/i18n/*.ts` (`history.runningBalance` exists already).
**Forbidden**: `src/db/queries.ts` — `computeBalances` is the current figure and is used by three
screens; a running series is a different shape and belongs beside it, not inside it.

**Behaviour**: with one account filtered and no other filter narrowing the list, each row also
shows the account's balance immediately after it. Accumulated over *all* of that account's rows in
date order, not over the visible slice — otherwise a search term would silently change the numbers.
Hidden whenever another filter is on, because the series would be wrong rather than partial.

**Verify**: unit tests over an out-of-order set, including both legs of a transfer.

## Phase 5 — dead strings

**Goal.** The locale files stop describing screens that do not exist.

Roughly 35 keys are referenced nowhere. Two clusters are not leftovers but specifications:
`onboarding.*` (7 keys — welcome, household name, accounts, categories, finish) and `import.map*`
(column mapping, create-new, skip). Those are left alone and raised as a question; deleting them
would quietly close a decision that is not mine. The rest go.
