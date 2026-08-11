import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkSchema,
  migrationNumber,
  resetSchemaStatusCache,
  schemaErrorMessage,
} from "../../worker/schema-guard";

/**
 * The guard exists for one scenario: code deployed without its migrations. Every installation is
 * self-hosted and self-supported, so this has to fail with an instruction rather than with a
 * column-not-found error from whichever query happens to run first.
 */

/*
 * Taken from the migration list the test worker was handed, which is the same list wrangler applied
 * to this database. Naming a file here instead would make the test fail the moment a feature adds a
 * migration — and a test that must be edited to stay true is one that gets edited without thought.
 * Reading the directory is not an option: this runs in workerd, which has no filesystem.
 */
const HEAD = (env.TEST_MIGRATIONS as { name: string }[]).at(-1)!.name;
const HEAD_NUMBER = migrationNumber(HEAD);

beforeEach(() => {
  resetSchemaStatusCache();
});

describe("migrationNumber", () => {
  it("reads the numeric prefix", () => {
    expect(migrationNumber("0001_init.sql")).toBe(1);
    expect(migrationNumber("0012_something.sql")).toBe(12);
  });

  it("compares by number, not lexically", () => {
    // The reason a prefix is used at all: "0010" sorts before "0009" as a string in some
    // orderings, and a guard that got this wrong would block a correctly-migrated database.
    expect(migrationNumber("0010_x.sql")).toBeGreaterThan(migrationNumber("0009_x.sql"));
  });

  it("returns 0 for anything without a prefix", () => {
    expect(migrationNumber("init.sql")).toBe(0);
    expect(migrationNumber("")).toBe(0);
  });
});

describe("checkSchema", () => {
  it("passes when the database has the migration the code expects", async () => {
    // The test database is migrated by tests/worker/setup.ts, so it is at the current head.
    const status = await checkSchema(env.DB, HEAD);
    expect(status.ok).toBe(true);
    expect(status.applied).toBe(HEAD_NUMBER);
  });

  it("fails when the code is ahead of the database", async () => {
    const status = await checkSchema(env.DB, `${String(HEAD_NUMBER + 5).padStart(4, "0")}_not_applied_yet.sql`);
    expect(status.ok).toBe(false);
    expect(status.applied).toBe(HEAD_NUMBER);
    expect(status.expected).toBe(HEAD_NUMBER + 5);
  });

  it("passes when the database is ahead of the code, so a rollback still works", async () => {
    // Migrations are additive by rule, so every column the older code reads is still present.
    // Refusing here would turn a working rollback into an outage.
    const status = await checkSchema(env.DB, "0001_init.sql");
    expect(status.ok).toBe(true);
  });

  it("treats a database with no migrations table as behind, not as an error", async () => {
    const fresh = { prepare: () => ({ all: () => Promise.reject(new Error("no such table")) }) };
    const status = await checkSchema(fresh as unknown as D1Database, "0003_x.sql");
    expect(status.ok).toBe(false);
    expect(status.applied).toBe(0);
  });

  it("queries once per isolate rather than once per request", async () => {
    // This sits in front of every API call. A round trip per request would be a real cost, and
    // the schema cannot change under a running Worker without a new deployment.
    let queries = 0;
    const counting = {
      prepare: () => {
        queries++;
        return { all: () => Promise.resolve({ results: [{ name: "0003_x.sql" }] }) };
      },
    } as unknown as D1Database;

    await checkSchema(counting, "0003_x.sql");
    await checkSchema(counting, "0003_x.sql");
    await checkSchema(counting, "0003_x.sql");
    expect(queries).toBe(1);
  });

  it("names the command to run, because nobody else can run it for them", () => {
    const message = schemaErrorMessage({ ok: false, applied: 1, expected: 5 });
    expect(message).toContain("npm run db:migrate");
    expect(message).toContain("1");
    expect(message).toContain("5");
  });
});
