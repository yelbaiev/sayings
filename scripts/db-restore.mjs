import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Restores a database from a backup.
 *
 * Exists because until now restore was only a helper inside `tests/worker/backup.test.ts` — the
 * behaviour was proven but there was no way for anyone to actually do it. An untested backup is not
 * a backup; an un-runnable restore is not much better.
 *
 * Accepts either kind of snapshot this project produces:
 *   - a `.sql` dump from `npm run db:backup` — applied directly
 *   - a `.json` nightly snapshot from `worker/backup.ts` — converted to SQL first
 *
 *   npm run db:restore -- backups/pre-deploy-2026-08-06T10-30-00.sql
 *   npm run db:restore -- ~/Downloads/sayings-2026-08-06.json --local
 */

const args = process.argv.slice(2);
const local = args.includes("--local");
const source = args.find((arg) => !arg.startsWith("--"));

if (!source) {
  console.error("usage: npm run db:restore -- <file.sql|file.json> [--local]");
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`no such file: ${source}`);
  process.exit(1);
}

const quote = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

/**
 * Turns a nightly JSON snapshot into SQL.
 *
 * Deletes before inserting, per table, so a restore replaces state rather than merging into it —
 * merging would leave rows that were deleted after the snapshot was taken, which is precisely what
 * someone restoring is trying to undo. Soft-deleted rows are in the snapshot on purpose and are
 * reinserted, so deletions are reproduced too.
 *
 * Table order does not matter. The only foreign keys in the schema point at `households`, which is
 * created by migration `0001` rather than carried in a snapshot — nothing here references anything
 * else here. The pragma is emitted anyway, matching what `wrangler d1 export` itself writes.
 */
function jsonToSql(json) {
  const { tables } = JSON.parse(json);
  const statements = ["PRAGMA defer_foreign_keys=TRUE;"];

  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue;
    statements.push(`DELETE FROM ${table};`);
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      statements.push(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
          .map((column) => quote(row[column]))
          .join(", ")});`,
      );
    }
  }
  return statements.join("\n");
}

let sqlFile = source;
if (source.endsWith(".json")) {
  sqlFile = `${source.replace(/\.json$/, "")}.restore.sql`;
  writeFileSync(sqlFile, jsonToSql(readFileSync(source, "utf8")));
  console.log(`→ converted ${source} to ${sqlFile}`);
}

console.log(`→ restoring ${sqlFile} into the ${local ? "local" : "remote"} database`);
console.log("  This replaces the current contents. Ctrl-C now if that is not what you want.");

execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "DB",
    local ? "--local" : "--remote",
    `--file=${sqlFile}`,
    "--yes",
  ],
  { stdio: "inherit" },
);

console.log("✓ restored. Check Reports against a figure you remember before trusting it.");
