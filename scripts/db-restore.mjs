import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { snapshotToStatements } from "./restore-sql.mjs";
import { configPath } from "./wrangler-config.mjs";

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

let sqlFile = source;
if (source.endsWith(".json")) {
  sqlFile = `${source.replace(/\.json$/, "")}.restore.sql`;
  const { statements, warnings } = snapshotToStatements(readFileSync(source, "utf8"));
  writeFileSync(sqlFile, statements.join("\n"));
  console.log(`→ converted ${source} to ${sqlFile}`);
  for (const warning of warnings) console.warn(`! ${warning}`);
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
    // This installation's config, as db:backup uses. Without it wrangler read the tracked template,
    // whose database id is blank, so a restore to the real database could not run at all.
    "-c",
    configPath(),
  ],
  { stdio: "inherit" },
);

console.log("✓ restored. Check Reports against a figure you remember before trusting it.");
console.log(
  "  Every restored row has a fresh sync number, so phones re-download it on their next sync. " +
    "Anything entered on a phone after the snapshot is not in it — open Settings → reset local mirror " +
    "on each phone to drop those local-only rows.",
);
