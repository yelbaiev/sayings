# Apple-calculator amount input

## Why

Two complaints, one root cause.

1. **The decimal separator feels dead.** The amount display renders `evaluate(expression)` — a
   *number* — so anything typed that does not change the number is invisible. Typing `45` `,` `4`
   showed `45`, `45,` (special-cased), then jumped straight to `45,40`: the "4" never appeared as a
   tenth, and `45,0` looked identical to `45`. Every keypress must visibly move the display.

2. **Arithmetic hides its working.** The expression itself is not retained — only a running total,
   one operator and the current term — so `120+45+90` shows `165 +` above `255`. The request is the
   Apple-calculator reading: show the whole expression as typed, and only collapse it to a result
   when `=` is pressed.

Also found while reading: `pressDigit` never clears `settled`, so after `=` only the *last* digit
of a new number survives (`= 5 3` lands on 3, not 53).

## Phase 1 — the expression keeps its terms (single phase, ~350 lines)

**Goal.** The amount display shows exactly what was typed, and a result only after `=`.

**Allowed files**
- `src/lib/calc.ts`
- `src/lib/format.ts`
- `src/features/entry/EntrySheet.tsx`
- `src/features/entry/Keypad.tsx`
- `tests/unit/calc.test.ts`
- `tests/unit/format.test.ts`
- `CHANGELOG.md`

**Forbidden files**
- `shared/money.ts`, `shared/currency.ts` — parsing and minor-unit rules are correct and are used
  by the worker, the importer and the reports. Nothing here needs them changed.
- `src/db/**`, `worker/**` — what gets *saved* is unchanged; this is a display and keying change.
- `src/ui/index.tsx` — `Amount` renders a stored figure. A part-typed expression is not one, and
  bending `Amount` into taking a string would leak keypad state into every list row.
- Anything under `migrations/`, `package.json`.

**Behaviour change**
- `Expression` becomes `{ terms: string[]; operators: Operator[]; current: string; settled?: boolean }` —
  the typed text of every term is retained, not just a running total.
- The big amount line renders the expression as typed: `120 + 45,5`, grouped per locale, with the
  currency symbol on the side the locale puts it. Trailing separators and trailing zeros survive,
  so `45`, `45,`, `45,0`, `45,04` are four distinct displays.
- `=` collapses to the result; nothing else does. The small "working" line above is removed —
  it existed only because the big line showed the answer.
- Backspace unwinds a term at a time out of the operator, as before.
- After `=`, digits start a new number and keep *all* of their digits.

**Verification**
- `npm run verify` (lint, typecheck, all tests).
- New unit tests: literal display of every keystroke through `45 , 0 4`; `120+45+90` rendering the
  whole expression; `=` collapsing it; `= 5 3` giving 53.
- The existing `tests/dom/entry-layout.test.tsx` "pending decimal separator" test must still pass
  unchanged — it is the original bug report for (1).
