import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import migration from "../../migrations/0015_reprice_minor_digits.sql?raw";
import { currentRev } from "../../worker/db";
import { handleSync } from "../../worker/sync";
import { accountRow, resetHousehold, testMember, txRow } from "./helpers";

/**
 * Migration 0015 against rows stored the old way: `amount_minor * fx_rate`, unscaled.
 *
 * The migration already ran on this database at setup, on an empty ledger; here it is re-run over
 * rows written in the broken shape, which is exactly the state a self-hosted install upgrades from.
 */

async function seed(id: string, currency: string, amount: number, rate: number, base?: number) {
  await handleSync(env.DB, testMember, {
    since: 0,
    changes: [
      {
        table: "transactions",
        row: txRow({
          id,
          account_id: "acc",
          currency,
          amount_minor: amount,
          fx_rate: rate,
          fx_base: "UAH",
          // The old, unscaled figure.
          base_amount_minor: base ?? Math.round(amount * rate),
        }),
      },
    ],
  });
}

async function baseOf(id: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT base_amount_minor FROM transactions WHERE id = ?`)
    .bind(id)
    .first<{ base_amount_minor: number }>();
  return row!.base_amount_minor;
}

/** D1's exec takes one statement per line, so the file's comments and line breaks are folded. */
async function runMigration() {
  const statements = migration
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((sql: string) => sql.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((sql: string) => env.DB.prepare(sql)));
}

beforeEach(async () => {
  await resetHousehold();
  await handleSync(env.DB, testMember, {
    since: 0,
    changes: [{ table: "accounts", row: accountRow({ id: "acc" }) }],
  });
});

describe("0015_reprice_minor_digits", () => {
  it("rescales zero- and three-decimal rows, and leaves two-decimal ones alone", async () => {
    await seed("yen", "JPY", 1_000, 0.27); // stored ₴2.70, should be ₴270.00
    await seed("dinar", "TND", 10_000, 13.5); // stored ₴1 350.00, should be ₴135.00
    await seed("euro", "EUR", 10_000, 51.6423); // already right

    await runMigration();

    expect(await baseOf("yen")).toBe(27_000);
    expect(await baseOf("dinar")).toBe(13_500);
    expect(await baseOf("euro")).toBe(516_423);
  });

  it("gives corrected rows a new rev, so phones receive them", async () => {
    await seed("yen", "JPY", 1_000, 0.27);
    const cursor = await currentRev(env.DB);
    await runMigration();

    const { changes } = await handleSync(env.DB, testMember, { since: cursor, changes: [] });
    expect(changes.some((c) => c.table === "transactions" && c.row.id === "yen")).toBe(true);
  });

  it("is safe to run twice", async () => {
    await seed("yen", "JPY", 1_000, 0.27);
    await runMigration();
    await runMigration();
    expect(await baseOf("yen")).toBe(27_000);
  });

  it("leaves a row alone whose figure is not the old unscaled product", async () => {
    // Already right — priced by a fixed client — so it must not be scaled again.
    await seed("yen_fixed", "JPY", 1_000, 0.27, 27_000);
    await runMigration();
    expect(await baseOf("yen_fixed")).toBe(27_000);
  });
});
