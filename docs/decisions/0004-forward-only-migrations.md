# 0004 — Migrations are forward-only, additive, and idempotent

**Status**: accepted
**Date**: 2026-08-06

## Context

The app is distributed by self-hosting: every household runs it on their own Cloudflare account,
owns its database, and updates when they choose. There is no fleet to coordinate, no version anyone
is obliged to support, and — the part that matters here — **nobody who can fix a broken upgrade
except the person it broke on**.

That inverts the usual migration calculus. In a hosted product you can migrate everyone at once,
watch it, and roll forward with a patch within the hour. Here, someone deploys v1 in January, never
touches it, and in December pulls v9 and applies eight migrations in one transaction on a database
containing four years of their financial history. If that goes wrong they have a SQL prompt and a
README.

D1 supplies the mechanics: `wrangler d1 migrations apply` records each applied file in a
`d1_migrations` table and runs only the missing ones, in lexical order. So a v1 → v9 jump already
runs `0002 … 0009` in sequence, which is the same path an installation that upgraded every month
would have taken. What D1 cannot check is whether the *contents* are safe to apply that way.

## Decision

Four rules, all machine-checked by `tests/unit/migrations.test.ts`:

1. **Additive only.** No `DROP TABLE`, no `DROP COLUMN`, no `RENAME`, no `DELETE FROM`. `ALTER
   TABLE` only in its `ADD COLUMN` form.
2. **Sequentially numbered, no gaps.** `0001_`, `0002_`, … A gap is not cosmetic: if `0004` is
   skipped in the repository and added later, installations that already ran `0005` will never
   receive it, because D1 tracks names rather than a high-water mark.
3. **Idempotent.** `CREATE TABLE/INDEX IF NOT EXISTS`, `INSERT OR IGNORE`. A migration that fails
   partway is not recorded, so the next deploy retries the whole file — without this, the retry
   fails on whatever the first attempt managed to create.
4. **A backup is taken before migrations run.** `npm run deploy` is
   `db:backup && db:migrate && build && deploy`, in that order, so no update can proceed without a
   restorable snapshot existing first.

The Worker also refuses to serve a database that is behind the code
(`worker/schema-guard.ts`): it compares the highest migration baked into the build against
`d1_migrations` and returns 503 naming `npm run db:migrate`. A database *ahead* of the code is
allowed, because rule 1 guarantees the older code's columns are all still present — blocking that
would turn a working rollback into an outage.

### Renaming and removing, when it becomes necessary

Rule 1 forbids the convenient version, not the outcome. To retire a column: add the replacement,
write to both for a release, migrate readers, and leave the old column in place unread. It costs a
few bytes per row in SQLite and it means no intermediate state can lose data. If a column ever
genuinely must go, that is a major version with its own migration guide, not a routine release.

### On the client

`src/db/dexie.ts` has its own schema version. Adding a store or an index requires bumping
`this.version(n)` and never reusing a number — existing devices carry a populated IndexedDB, and
Dexie replays version upgrades in order for exactly the same reason D1 does.

## Consequences

- Migrations `0001`–`0003` were retrofitted with `IF NOT EXISTS` and `INSERT OR IGNORE` when this
  rule was adopted. Editing an already-applied migration is normally forbidden, and it was safe here
  for a specific reason: **D1 records migrations by filename, not by content**, so an edited file
  never re-runs anywhere it has already been applied. The change is therefore invisible to every
  existing database and affects only what a fresh one receives. That reasoning does not generalise —
  if an edit would change the schema a fresh database ends up with, it must be a new migration
  instead.
- The schema accumulates columns that are no longer read. Accepted: the alternative is a class of
  data-loss bug whose blast radius is somebody else's five years of records.
- Test coverage here is static analysis of the SQL, not execution. The execution side is covered
  separately — `tests/worker/setup.ts` applies the real migrations to a real local D1 on every test
  run, using wrangler's own applier, so "the whole sequence applies to an empty database" is proven
  continuously.
