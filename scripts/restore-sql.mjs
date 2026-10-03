/**
 * Turns a nightly JSON snapshot into the SQL statements that restore it.
 *
 * Kept apart from `db-restore.mjs`, and free of Node imports, so the worker test suite can run the
 * very statements a real restore would — the restore path was once proven only by a hand-written
 * equivalent in the tests, which is a proof of the equivalent.
 *
 * What a restore has to get right, beyond the rows themselves:
 *
 * - **Every restored row gets a fresh rev, above anything seen.** Devices pull "everything above my
 *   cursor". Restored rows at their old revs sit below every device's cursor, so no phone would ever
 *   re-read the restored state — they would keep whatever they had cached. The counter is set past
 *   both the snapshot's and the database's own (a rollback restores into the same database, whose
 *   counter is already above every device), and every synced row is re-stamped with it.
 * - **Sessions, challenges and invites are cleared, not restored.** They are short-lived; reviving
 *   them would revive expired access. Everyone signs in again with the passkeys that *are* restored.
 * - **The household row is updated in place**, because everything else references it.
 *
 * Deletes before inserting, per table, so a restore replaces state rather than merging into it —
 * merging would keep rows deleted after the snapshot, which is exactly what restoring undoes.
 */

/** Tables a device replicates. Their rows are re-stamped with the new rev. */
const SYNCED = ["members", "accounts", "categories", "transactions", "budgets", "recurring", "quick_tiles"];

/** Restored by replacing the table's contents. Order: parents before the rows that point at them. */
const REPLACED = [...SYNCED, "credentials", "fx_rates", "app_meta"];

/** Present in every schema-2 snapshot. Their absence is what a schema-1 restore warns about. */
const SCHEMA_2_ONLY = ["households", "credentials", "app_meta", "household_seq"];

const quote = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

function insert(table, row, conflict = "") {
  const columns = Object.keys(row);
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
    .map((column) => quote(row[column]))
    .join(", ")})${conflict};`;
}

/**
 * @param {string} json  the snapshot file's contents
 * @returns {{ statements: string[], warnings: string[] }}
 */
export function snapshotToStatements(json) {
  const snapshot = JSON.parse(json);
  const tables = snapshot.tables ?? {};
  const statements = ["PRAGMA defer_foreign_keys=TRUE;"];
  const warnings = [];

  const missing = SCHEMA_2_ONLY.filter((table) => !Array.isArray(tables[table]));
  if (missing.length > 0) {
    warnings.push(
      `This snapshot (schema ${snapshot.schema ?? 1}) has no ${missing.join(", ")}. ` +
        "Passkeys, the main currency and the currency list are not in it: sign in again with " +
        "Cloudflare Access or claim the household afresh, then check the main currency in Settings.",
    );
  }

  statements.push(
    "DELETE FROM auth_sessions;",
    "DELETE FROM auth_challenges;",
    "DELETE FROM invites;",
  );

  for (const row of tables.households ?? []) {
    const columns = Object.keys(row).filter((column) => column !== "id");
    statements.push(
      insert("households", row, ` ON CONFLICT(id) DO UPDATE SET ${columns
        .map((column) => `${column} = excluded.${column}`)
        .join(", ")}`),
    );
  }

  for (const table of REPLACED) {
    const rows = tables[table];
    if (!Array.isArray(rows)) continue;
    statements.push(`DELETE FROM ${table};`);
    for (const row of rows) {
      if (Object.keys(row).length > 0) statements.push(insert(table, row));
    }
  }

  // The highest rev the snapshot knows of: its counter, or failing that (schema 1) its rows.
  let snapshotRev = 0;
  for (const row of tables.household_seq ?? []) snapshotRev = Math.max(snapshotRev, Number(row.rev) || 0);
  for (const table of SYNCED) {
    for (const row of tables[table] ?? []) snapshotRev = Math.max(snapshotRev, Number(row.rev) || 0);
  }

  statements.push(
    "INSERT OR IGNORE INTO household_seq (household_id, rev) VALUES ('hh_default', 0);",
    `UPDATE household_seq SET rev = MAX(rev, ${snapshotRev}) + 1 WHERE household_id = 'hh_default';`,
  );
  for (const table of SYNCED) {
    if (!Array.isArray(tables[table])) continue;
    statements.push(
      `UPDATE ${table} SET rev = (SELECT rev FROM household_seq WHERE household_id = 'hh_default');`,
    );
  }

  return { statements, warnings };
}
