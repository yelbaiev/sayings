/**
 * Refuses to serve a database that is behind the code.
 *
 * The dangerous update is not the one that fails — it is the one that half-succeeds. Deploy a
 * Worker built against migration `0005` onto a database still at `0003` and nothing announces
 * itself: the app loads, the ledger appears, and then some query touches a column that does not
 * exist and returns an error with no relationship to the actual problem. Worse, writes that
 * happened to avoid the new columns succeed, so the failure is intermittent and the data drifts.
 *
 * Every installation is self-hosted and self-supported, so this has to be caught by the software.
 * One check, one clear message, naming the command to run.
 *
 * The comparison is on the numeric prefix rather than the whole filename. D1 applies migrations in
 * lexical order and records the filename, so a prefix is the ordering that actually matters — and
 * it means a rename of an already-applied migration is not mistaken for a missing one.
 */

export interface SchemaStatus {
  ok: boolean;
  /** Highest migration number recorded in the database, or 0 if none have been applied. */
  applied: number;
  /** Highest migration number this build of the code was compiled against. */
  expected: number;
}

/** `0004_app_meta.sql` -> 4. Returns 0 for anything unparseable. */
export function migrationNumber(filename: string): number {
  const digits = /^(\d+)/.exec(filename);
  return digits ? Number(digits[1]) : 0;
}

/**
 * Result cached per isolate. The schema cannot change under a running Worker without a new
 * deployment, so one query per isolate is enough — and putting this in front of every request
 * must not add a database round trip to every request.
 */
let cached: SchemaStatus | null = null;

/** Exported for tests, which need each case to start from a clean slate. */
export function resetSchemaStatusCache(): void {
  cached = null;
}

export async function checkSchema(db: D1Database, expectedFilename: string): Promise<SchemaStatus> {
  if (cached) return cached;

  const expected = migrationNumber(expectedFilename);
  let applied = 0;

  try {
    const rows = await db
      .prepare(`SELECT name FROM d1_migrations`)
      .all<{ name: string }>();
    for (const row of rows.results) {
      applied = Math.max(applied, migrationNumber(row.name));
    }
  } catch {
    // No `d1_migrations` table at all: migrations have never been run here. That is the same
    // problem as being behind, and is reported the same way rather than as an internal error.
    applied = 0;
  }

  // Deliberately not an equality check. A database *ahead* of the code happens during a rollback,
  // and because migrations are additive by rule (docs/decisions/0004) the old code's columns are
  // all still there. Blocking that would turn a working rollback into an outage.
  cached = { ok: applied >= expected, applied, expected };
  return cached;
}

export function schemaErrorMessage(status: SchemaStatus): string {
  return (
    `The database is at migration ${status.applied} but this version of the app needs ` +
    `${status.expected}. Run: npm run db:migrate`
  );
}
