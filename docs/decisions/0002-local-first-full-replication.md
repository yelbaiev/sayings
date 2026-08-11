# 0002 — Mirror the whole dataset on every device

**Status**: accepted
**Date**: 2026-08-05

## Context

Two users, five years of history, phones daily and desktop occasionally. The previous app
went offline for over a week, which is what prompted the rebuild.

The usual shape for this app would be a server that owns the data and endpoints that return
paginated lists and pre-aggregated reports.

## Decision

Replicate the entire dataset into IndexedDB on every device. All reads and **all reports** run
client-side. The server only syncs, fetches FX rates, stores files, and backs up.

## Why

The dataset is small enough to make the usual trade-off unnecessary: ~20 transactions a day
over five years is ~35k rows, roughly 7 MB. That fits comfortably in IndexedDB and sums in a
few milliseconds.

What that buys:

- **No loading states anywhere.** Nothing in the UI waits on the network, including reports.
- **Full offline capability**, including five years of history and every report — not just a
  cached last-viewed screen.
- **No report endpoints at all.** The report engine is a file of pure functions, which is also
  why it is cheap to test exhaustively against fixtures.
- **Entry is instant.** A save writes locally and returns; the outbox drains in the background.

## Consequences

- Balances are **derived by summing**, never stored. A stored balance is a second source of
  truth that drifts the moment a sync arrives out of order.
- The server stays authoritative. iOS evicts IndexedDB for sites not installed to the home
  screen, so onboarding requires installing — but eviction costs a re-sync, not data. The
  Settings screen offers a deliberate "re-sync from scratch" for the same reason.
- Sync is whole-row upserts with last-write-wins on `updated_at`. Whole rows rather than field
  deltas make a replayed push a no-op, which removes the need for a dedupe table and lets the
  client retry freely after a dropped mobile connection.
- This does not scale to a large multi-tenant product. That is fine: it is a two-person
  household ledger, and designing for a scale that will never arrive would cost the offline
  behaviour that is the whole point.
- If the dataset ever did grow past comfortable memory limits, the migration is to keep the
  same protocol and window the mirror by date. The sync cursor already supports it.
