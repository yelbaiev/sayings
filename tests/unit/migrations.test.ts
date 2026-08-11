import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Enforces the migration rules that make an upgrade from any old version safe.
 *
 * Every installation is on its own Cloudflare account and updates when its owner feels like it, so
 * somebody out there is on v1 and will one day jump straight to v9. D1 handles the mechanics —
 * `d1_migrations` records what has been applied and only the missing files run, in order — but it
 * cannot tell whether the *contents* are safe to apply in sequence. That is a discipline, and a
 * discipline nobody checks is a discipline that lapses.
 *
 * The full sequence is separately proven to apply to an empty database on every test run:
 * `tests/worker/setup.ts` runs wrangler's own migration applier against a real local D1.
 *
 * See docs/decisions/0004-forward-only-migrations.md.
 */

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");

/** Strips comments so the destructive-statement checks cannot be fooled by prose about them. */
function stripSqlComments(text: string): string {
  return text.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("migrations", () => {
  it("has at least one", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("is numbered sequentially with no gaps or duplicates", () => {
    // A gap is not cosmetic. D1 applies what it has not seen, so if 0004 is skipped in the repo
    // and later added, installations that already ran 0005 will never receive it.
    const numbers = files.map((name) => Number(/^(\d+)/.exec(name)?.[1]));
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  it("names every file <number>_<slug>.sql", () => {
    for (const name of files) {
      expect(name, name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
  });

  it("contains no destructive schema changes", () => {
    // The rule that makes an upgrade from any version safe: only ever add. Renaming or dropping a
    // column is what turns "four migrations at once" into data loss, because the intermediate
    // states are never observed by anyone testing a single-step upgrade.
    const forbidden = [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bRENAME\s+TO\b/i,
      /\bRENAME\s+COLUMN\b/i,
      /\bDELETE\s+FROM\b/i,
    ];
    for (const name of files) {
      const body = stripSqlComments(sql(name));
      for (const pattern of forbidden) {
        expect(pattern.test(body), `${name} contains ${pattern}`).toBe(false);
      }
    }
  });

  it("only ever adds columns to existing tables", () => {
    // ALTER TABLE is allowed, but only in its ADD COLUMN form.
    for (const name of files) {
      const body = stripSqlComments(sql(name));
      for (const [statement] of body.matchAll(/\bALTER\s+TABLE\b[^;]*/gi)) {
        expect(/\bADD\s+COLUMN\b/i.test(statement), `${name}: ${statement.trim()}`).toBe(true);
      }
    }
  });

  it("creates tables and indexes idempotently", () => {
    // A migration that fails partway is not recorded, so the next deploy retries the whole file.
    // Without IF NOT EXISTS that retry fails on the first object the first attempt managed to
    // create, and someone who has just discovered this project is left hand-editing SQL on their
    // very first deploy.
    for (const name of files) {
      const body = stripSqlComments(sql(name));
      for (const [statement] of body.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b[^;]*/gi)) {
        expect(/\bIF\s+NOT\s+EXISTS\b/i.test(statement), `${name}: ${statement.trim()}`).toBe(true);
      }
    }
  });

  it("seeds idempotently", () => {
    // Same reason, for data. A retried INSERT would fail on a primary key that already exists.
    for (const name of files) {
      const body = stripSqlComments(sql(name));
      for (const [statement] of body.matchAll(/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\b[^;]*/gi)) {
        expect(
          /\bINSERT\s+OR\s+(?:IGNORE|REPLACE)\b/i.test(statement),
          `${name}: ${statement.slice(0, 60).trim()}…`,
        ).toBe(true);
      }
    }
  });
});
