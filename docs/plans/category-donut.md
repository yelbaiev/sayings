# Expenses and income by category

From two screenshots of another household app: a donut with the period's total in the middle, a
strip of months under it to move between periods, and a ranked list of categories with a colour,
a share and an amount. Adopted, not copied — the pieces that are wrong at ten categories are
changed on the way in.

## What we already have

The month tab holds most of the bottom half already: the ranked list with each category's icon,
share, month-on-month change and a drill-down into the transactions behind it, plus an
income / expenses / net card. What is missing is the donut, the month strip, and the split.

## What is wrong today

`monthOverview.byCategory` puts **every** category in one list regardless of kind, and computes
each share against total *expenses*. A salary therefore appears among the spending categories at
"226% of expenses". The screenshots are two separate reports precisely because these are two
different questions, and splitting them is also the fix.

## Phase 1 — the split (engine)

**Allowed**: `src/lib/report-engine.ts`, `tests/unit/report-engine.test.ts`.
**Forbidden**: everything else — this phase changes no pixels.

`byCategory` becomes `{ expense: Row[]; income: Row[] }`, each share taken against its own side's
total. The change ratio against the same category last month is unaffected.

## Phase 2 — the donut

**Allowed**: `src/features/reports/charts.tsx`, `src/i18n/*.ts`, `tests/dom/charts.test.tsx`.
**Forbidden**: `src/ui/**` — this is a report component, not a primitive.

- **Six slices and a seventh for the rest.** The screenshots run to a dozen, and the tail is a
  smear of arcs too thin to point at, in colours too close to tell apart. The list below is where
  the tail is read; the donut answers "what is most of this".
- Each slice wears its **category's own colour**, the one on its icon everywhere else in the app —
  identity the household chose. Colour is never the only channel: the list beneath names every
  category with its share and its amount.
- The centre carries the total. Touching a slice puts that category in the centre instead.
- 2px surface gaps between arcs, per the mark spec — no strokes around slices.

## Phase 3 — the month strip

**Allowed**: `src/features/reports/charts.tsx`, `src/features/reports/ReportsPage.tsx`.

Nine columns ending at the selected month, each the size of that month's total, the selected one
filled. Tapping one selects it. The existing ‹ › arrows stay: they move one month at a time and
the window follows, which is how a strip of nine reaches a year ago.

## Phase 4 — wiring

**Allowed**: `src/features/reports/ReportsPage.tsx`, `src/i18n/*.ts`, tests.

A kind toggle above the donut, reusing the existing `kind.expense` / `kind.income` strings. One new
string for the folded tail.

**Verification**: `npm run verify`; render both reports and look at them at phone width in both
themes before shipping.
