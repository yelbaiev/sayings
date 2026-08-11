import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { backupBucketName, configPath } from "./wrangler-config.mjs";

/**
 * Snapshots the whole database before a deploy touches it.
 *
 * This runs *first* in `npm run deploy`, ahead of migrations, and that ordering is the point. An
 * installation may be several versions behind and about to apply four migrations in one go, with
 * nobody but its owner able to fix it if something goes wrong. Remembering to take a backup first
 * is not a plan; doing it automatically is.
 *
 * Hard-fails if the export fails, so a deploy cannot proceed unsnapshotted. The R2 upload that
 * follows is best-effort: a dump already on disk is a real backup, and losing a deploy over a
 * bucket permission would be the wrong trade.
 *
 * Uses the binding name `DB` rather than the database name, because the name differs per
 * installation while the binding is what the code refers to.
 *
 *   npm run db:backup            # remote (what deploy uses)
 *   npm run db:backup -- --local # against the local dev database
 */

const local = process.argv.includes("--local");
const scope = local ? "--local" : "--remote";

// Passed in rather than read from the clock inside a library, so the same stamp names the file on
// disk and the object in R2.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = "backups";
const file = `${dir}/pre-deploy-${stamp}.sql`;

mkdirSync(dir, { recursive: true });

const config = configPath();
const run = (args) => execFileSync("npx", ["wrangler", ...args, "-c", config], { stdio: "inherit" });

console.log(`→ exporting database (${local ? "local" : "remote"}) to ${file}`);
run(["d1", "export", "DB", scope, "--output", file, "--skip-confirmation"]);

const bytes = statSync(file).size;
if (bytes === 0) {
  // An empty file would pass as a backup and restore to nothing.
  throw new Error(`${file} is empty — refusing to treat that as a backup`);
}
console.log(`✓ ${file} (${(bytes / 1024).toFixed(1)} kB)`);

if (local) process.exit(0);

const bucket = backupBucketName();
if (!bucket) {
  console.warn("! no R2 bucket bound; the dump is on disk only");
  process.exit(0);
}

const key = `backups/pre-deploy/${stamp}.sql`;
try {
  run(["r2", "object", "put", `${bucket}/${key}`, `--file=${file}`, "--remote"]);
  console.log(`✓ uploaded to r2://${bucket}/${key}`);
} catch {
  // Deliberately not fatal — see the note at the top.
  console.warn(`! could not upload to R2; the dump is still at ${file}`);
}
