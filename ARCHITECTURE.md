# Architecture

One Cloudflare Worker serves both the SPA and the API. The client mirrors the entire dataset
locally and computes everything, including reports, on-device. The Worker syncs, fetches FX
rates, stores files, and backs up — it never computes a report.

```
                    Cloudflare Access (Zero Trust)
                              │  two allowed emails
                              ▼
┌──────────────────────────────────────────────────────────┐
│  Worker  (worker/index.ts)                               │
│    /api/*  → auth.ts → sync.ts / fx.ts / backup.ts       │
│    else    → ASSETS (the SPA)                            │
│    cron    → FX refresh → reconcile → R2 snapshot        │
└───────────┬──────────────────────────┬───────────────────┘
            │                          │
        D1 (SQLite)                R2 (backups, receipts)
            ▲
            │  POST /api/sync   whole-row upserts, LWW on updated_at
            │  GET  /api/fx     rates by date
            ▼
┌──────────────────────────────────────────────────────────┐
│  Client                                                  │
│    IndexedDB mirror (Dexie) ── every read, every report  │
│    outbox ── drains in background, never blocks a save    │
│    src/lib/*.ts ── pure engines: reports, budgets, fx,    │
│                    prediction, keypad arithmetic          │
└──────────────────────────────────────────────────────────┘
```

## Layers

| Directory | Responsibility |
| --- | --- |
| `worker/` | Access verification, sync, FX, backup. No business logic beyond persistence. |
| `shared/` | Imported by both sides: zod schema, money, currency, CSV import. |
| `src/db/` | Local mirror, outbox, sync client, read queries. The only place that writes. |
| `src/lib/` | Pure functions: report engine, budget engine, FX lookup, prediction, calculator. |
| `src/features/` | Screens. Read through `src/db/queries`, write through `src/db/mutations`. |
| `src/ui/` | Primitives. `Amount` is the only component that renders money. |
| `src/i18n/` | Three flat dictionaries. No hardcoded strings in components. |

## Data flow for a saved transaction

1. `EntrySheet` computes the amount from the keypad expression (`src/lib/calc.ts`).
2. It looks up the FX rate for that date from the local mirror (`src/lib/fx.ts`).
3. `put()` writes the row to Dexie **and** the outbox in one transaction, then returns. The
   sheet closes immediately; nothing awaits the network.
4. The sync client drains the outbox, sends whole rows, and applies the server's response —
   including the caller's own rows with their server-assigned `rev`.
5. Every open screen updates through `useLiveQuery`, on both devices.

## Invariants

- **Money is integer minor units, always.** All arithmetic in `shared/money.ts`. See ADR 0003.
- **Amounts are magnitudes; direction comes from `kind`.** Transfers contribute zero to income
  and expense by construction.
- **Historical figures use each transaction's own snapshotted rate**, never today's.
- **Balances are derived, never stored.** A stored balance is a second source of truth.
- **Category and account names are shared data, not translated strings.** Both members read the
  interface in their own language but see one ledger.
- **No dynamic code evaluation.** `no-eval` / `no-new-func` are errors; a test asserts the
  keypad's evaluator module contains neither.

## Decisions

- [0001 — Cloudflare Access for auth](docs/decisions/0001-cloudflare-access-for-auth.md)
- [0002 — Local-first full replication](docs/decisions/0002-local-first-full-replication.md)
- [0003 — Money representation](docs/decisions/0003-money-representation.md)
