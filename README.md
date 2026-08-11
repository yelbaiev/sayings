# SAYings

Household finance and budgeting for two people, running entirely on **your own** Cloudflare
account. Offline-first, installable to the home screen, with the whole dataset mirrored on every
device and a nightly backup you control.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yelbaiev/sayings)

Built to replace a commercial budgeting app after a multi-day vendor outage left five years of a
household's financial history unreachable. Every design decision follows from that: the full
dataset lives on each device, every report is computed locally, exports are one tap, and backups
are automatic. If this project disappeared tomorrow, your deployment would keep working.

**There is no service behind this.** No account to create, no telemetry, no analytics, no server
of ours your data passes through — because there is no "ours". You deploy it, you own the
database, and nobody else can read it or take it away. That also means nobody else can recover it
for you, which is why the backup and restore paths are treated as features rather than chores.

## Currencies

You pick the currency you report in on first run, from **43** — every currency quoted by either the
National Bank of Ukraine or the European Central Bank, so anything on offer can actually be
converted. Rates come from whichever of the two publishes the pair, cross-rated through their shared
pivot when neither quotes it directly; the ECB does not publish a hryvnia rate, which is why there
are two sources rather than one.

Each account is denominated in its own currency, and every transaction stores the rate it was priced
at, on its own date. That rate is **editable**: a bank's actual conversion differs from a central
bank's reference rate, and for a household ledger the rate the bank used is the fact. A rate you
correct by hand is frozen on the transaction and never overwritten, including by the nightly job that
repairs entries recorded offline.

The reporting currency can be changed later. It re-prices what is already recorded, at the rate on
each transaction's own date, after taking a backup — and it does **not** touch account balances,
which are held in each account's own currency and stay reconciled with your cards.

Money is stored in integer minor units throughout, with each currency's real ISO 4217 precision: the
yen has no minor unit and the Tunisian dinar has three, and getting that wrong is a hundred- or
thousandfold error that nothing else would catch.

## Stack

The UI is [shadcn/ui](https://ui.shadcn.com) on Tailwind v4 — components vendored into `src/ui/`,
zinc theme, money-direction colours as first-class extensions. Dialogs are vaul (drawer) below
900px and Radix Dialog above, behind one `Sheet` wrapper. See `docs/decisions/0006-shadcn-ui.md`.


| Concern | Cloudflare primitive |
| --- | --- |
| SPA + API | One Worker with Static Assets (`run_worker_first: ["/api/*"]`) |
| Database | D1 (SQLite) |
| Receipts, backups | R2 |
| Auth | Access (Zero Trust) — free for ≤ 50 users |
| Daily FX, nightly backup | Cron Triggers |

Client is React 19 + Vite, with the whole dataset mirrored into IndexedDB (Dexie). The Worker only
syncs, fetches FX rates, stores files, and backs up — it never computes a report.

**Cloudflare only, deliberately.** D1, R2, Access and Cron Triggers are not deployment details
here, they are the application. A Vercel or Netlify target would mean a different database, a
different auth model and a different scheduler — a rewrite of everything below the UI, not a
config change. Rather than pretend to be portable, the project commits to one vendor and keeps
your escape hatch as *data* instead: a one-tap full export in JSON and CSV, at any time, with no
server involved.

## Install it

See **[SELF-HOSTING.md](SELF-HOSTING.md)**. The short version: press the button above, then add a
Cloudflare Access policy with the email addresses allowed in. The app refuses to serve itself
until you do — an unauthenticated finance app is worse than no app.

## Develop

```sh
npm install
cp .env.example .dev.vars   # then fill in the two values
npm run dev                 # http://localhost:5173
```

```sh
npm run verify   # lint + typecheck (4 tsconfigs) + tests — run before every commit
npm run build    # client -> dist/client, worker -> dist/
npm run preview  # runs the built output in the real workerd runtime
npm run deploy   # backup + migrate + build + deploy
```

`npm run deploy` takes a database snapshot and applies migrations before deploying. That order is
the point — see [SELF-HOSTING.md](SELF-HOSTING.md#updating).

## Configuration

`TEAM_DOMAIN` and `POLICY_AUD` are public identifiers, not secrets — the AUD tag travels inside
every Access JWT and the team domain is visible in the sign-in URL. See
[`.env.example`](.env.example) for where to find them in the Zero Trust dashboard. They live in
`wrangler.jsonc` `vars` for deploys and in `.dev.vars` (gitignored) for local work.

No secrets belong in this repo, in any file, ever. If one is genuinely needed later it goes in
`wrangler secret put NAME`.

The Worker **fails closed**: if `POLICY_AUD` is unset or still holds the `CHANGEME` placeholder,
every `/api/*` route refuses the request rather than silently accepting an unverified one.
Verifying the JWT is mandatory — Access adds the `Cf-Access-Jwt-Assertion` header, but a client
can set any header it likes, so the signature, issuer, and audience are all checked
(`worker/auth.ts`).

### Gotchas worth knowing

- **`.dev.vars` is read by `vite dev`, not by `vite preview`.** Preview uses the vars baked into
  `wrangler.jsonc`, so `/api/*` fails closed there until those are real.
- **`wrangler types` generates *literal* types from `wrangler.jsonc` vars**
  (`POLICY_AUD: "CHANGEME"`). Config is therefore read through explicit interfaces
  (`AccessConfig`) rather than by passing `Env` around, so the types don't narrow against a
  placeholder that never exists in production.
- **Regenerate types after editing `wrangler.jsonc`**: `npm run cf-typegen`.
- **The local IndexedDB is named `sayfinance`** (`src/db/dexie.ts`), from before the app was
  renamed. Left alone on purpose: it is a storage key, and changing it would orphan every
  existing device's mirror and force a full re-sync for no visible gain.

## Known audit findings

`npm audit` reports findings that all trace to a single root: `undici@7.28.0`, which `miniflare`
pins exactly, reached via `@cloudflare/vite-plugin` and `wrangler`. That is the local development
emulator's HTTP client — it is not in the deployed Worker bundle, which contains only Hono, jose,
and the app code. A patched `undici` exists (7.29.0) but forcing it past miniflare's hard pin
risks breaking local dev for no production benefit, so it is left alone. Recheck when Cloudflare
bumps miniflare.

## Layout

```
worker/      Worker: routing, Access verification, sync, FX, files, backup
shared/      Imported by BOTH client and worker — schema, money, currency
src/         React client (local-first; reads only from IndexedDB)
migrations/  D1 schema — forward-only, see docs/decisions/
tests/       unit/ (pure engines) worker/ (real D1 + R2) fixtures/ (synthetic)
docs/        decisions/ (ADRs)
```

`shared/` is type-checked under both `tsconfig.json` (DOM libs) and `tsconfig.worker.json` (no
DOM), which is what stops shared code from reaching for browser- or Workers-only APIs.

Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md). Contributing:
[`CONTRIBUTING.md`](CONTRIBUTING.md). Reporting a vulnerability:
[`SECURITY.md`](SECURITY.md).

## Conventions

- **Money is always integer minor units.** Never a float. All sign logic lives in
  `shared/money.ts` — `amount_minor` is a positive magnitude and the sign is derived from `kind`.
  A lint rule keeps arithmetic on amounts out of the rest of the codebase.
- **Migrations are forward-only and additive.** Never rename or drop a column in place; every
  migration must apply cleanly to a database created by `0001`. This is what makes upgrading from
  any old version safe.
- **No dynamic code evaluation.** `no-eval` / `no-new-func` are errors; the entry keypad's inline
  arithmetic is a hand-written token evaluator.
- **Never log** request bodies, `Authorization` / `Cookie` headers, raw env values, or tokens.
  Errors log message and code only.
- Version bump before every push: patch by default, `1.0.0 → 1.0.1 → … → 1.0.9 → 1.1.0`. Every
  bump gets a real `CHANGELOG.md` entry — those notes are what self-hosters read to decide whether
  to update.

## License

MIT. See [LICENSE](LICENSE).
