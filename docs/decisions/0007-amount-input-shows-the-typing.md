# 0007 — The amount field shows the typing, not the value

**Status**: accepted
**Date**: 2026-08-27

## Context

The entry keypad has inline arithmetic, so a receipt can be added up in the field it will be saved
from. Both the display and the expression behind it were built around the *value*: the expression
kept a running total plus one pending operator, and the display rendered
`formatMoney(evaluate(expression))`.

Two complaints, one cause.

The decimal key looked broken. `45`, `45,` and `45,0` are one value, so they drew as one thing —
`45`. Typing `45 , 4 0` moved the display twice out of four presses, and the "4" never appeared as
four tenths, so the field seemed to swallow keys and then jump.

Arithmetic hid its working. `120+45+90` showed `165 +` in small type above `255`: two of the three
numbers typed were no longer on screen, and the largest figure in the sheet was one nobody had
keyed. A mistyped receipt line could not be spotted, which defeats the point of adding up in the
field rather than on a calculator.

## Decision

1. `Expression` keeps every term as **typed text** — `{ terms: string[]; operators: Operator[];
   current: string }` — not a running total.
2. The amount line renders that text: `120 + 45,5`, grouped per locale, trailing separator and
   trailing zeros intact.
3. **`=` is the only key that shows a result.** Nothing else collapses the expression.
4. A plain amount carries the currency symbol; an expression in progress does not.

## Why

**Text, because the value cannot tell four states apart.** `45`, `45,`, `45,0` and `45,00` parse to
two distinct numbers and are four distinct states of typing. A display driven by the parsed value
cannot echo the keys, and a keypad that does not echo keys reads as a keypad that drops them. The
previous fix for this — splicing a comma into the formatted figure when the term ended in one —
handled exactly one of the four.

**The whole expression, because that is what is being checked.** The running total is a derived
fact; the terms are what the person typed and the only thing they can verify against a receipt.

**No result before `=`, because a number in that field is a claim.** The figure sits where the
saved amount goes, at 32px. Showing `255` while `120 + 45 + 90` is still being typed puts a number
nobody has committed to in the place the committed one belongs. This follows the platform
calculator, which is the interaction people already have in their fingers.

**No currency symbol mid-expression.** It has nowhere honest to sit while a term is missing —
`120 + ₴` reads as a typo — and for the seconds an expression is open the account row below still
says which currency this is.

## Consequences

- Saving with an operator still pending commits the evaluated total, which the display has not
  shown. That is the same figure `=` would produce, and the terms that make it are on screen.
- `formatMoney` cannot serve this field: it formats a number. `formatTypedNumber` and
  `withCurrency` in `src/lib/format.ts` format the text and place the symbol from the same `Intl`
  data, so the two agree on grouping, separator and symbol placement.
- The figure shrinks by length rather than clipping — an expression is longer than any amount.
- `src/lib/calc.ts` now imports from `src/lib/format.ts` for the one display function it owns.
  The dependency runs in that direction only.
- Fixed on the way: `settled` was never cleared by `pressDigit`, so after `=` every digit restarted
  the term and only the last one survived — `= 5 3` gave 3.
