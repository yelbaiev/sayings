# 0003 — Money is integer minor units, and direction comes from `kind`

**Status**: accepted
**Date**: 2026-08-05

## Context

The app holds a household's complete financial history across three currencies. A money bug
here does not crash — it silently produces wrong numbers that nobody notices until a
reconciliation fails, possibly years later.

## Decision

1. Every amount is an integer count of minor units (kopiyky, cents). The only `REAL` in the
   schema is `fx_rate`.
2. Stored amounts are always **positive magnitudes**. Direction is derived from the
   transaction's `kind` by `signedMinor()`.
3. All arithmetic lives in `shared/money.ts`. A lint rule keeps it out of the rest of the code.

## Why

**Integers, because floats are wrong.** `0.1 + 0.2 !== 0.3`, and the error compounds across
tens of thousands of rows. This was not theoretical: `parseMajorToMinor` originally did
`Number(x) * 100` and rounded `1.005` to 1.00 instead of 1.01, because the float is
`100.49999999999999`. It now uses decimal string arithmetic on BigInt with no float in the
path, and a test pins the cases.

**Magnitudes plus a kind, rather than signed amounts.** Storing both a sign and a `kind` means
every call site has to remember which is authoritative, and one of them eventually
double-negates. One derivation function removes the question.

**Transfers signal zero.** `signedMinor("transfer", …)` returns 0 deliberately: money moving
between the household's own accounts is neither income nor expense, and counting it as either
is the single most common way a spending report ends up overstated. Account balances handle
transfers separately through `accountDelta()`.

## Consequences

- Cross-currency transfers store **both legs explicitly** (`amount_minor` and
  `to_amount_minor`). Deriving the second from a rate would leave one balance carrying a
  rounding error forever.
- Historical figures use each transaction's **own snapshotted rate** (`base_amount_minor`,
  `fx_rate`), never today's rate. Otherwise last year's totals would change every morning.
- Conversion rounds **half away from zero**, not with bare `Math.round`, which rounds `-0.5`
  towards zero and would slowly understate expenses across thousands of rows.
- A transaction saved offline with no rate available is stored with `fx_estimated = 1` rather
  than refused, and corrected by the nightly reconcile. Losing the entry would be worse than
  an approximate base figure.
- `shared/` is type-checked under both the DOM and no-DOM configs, so this module cannot
  accidentally depend on a browser or Workers API and diverge between client and server.
