import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { latestBackup, listBackups, runBackup } from "../../worker/backup";
import { currentRev, upsertStatement } from "../../worker/db";
import { handleSync } from "../../worker/sync";
import { accountRow, resetHousehold, testMember, txRow } from "./helpers";

/**
 * The restore path, exercised end to end.
 *
 * This is the feature the whole project exists for, and an untested backup is not a backup —
 * it is a file nobody has ever tried to read. These tests write real data, snapshot it to a
 * real R2 bucket, wipe the database, restore from the snapshot, and check the numbers match.
 */

beforeEach(async () => {
  await resetHousehold();
  // R2 is not rolled back between tests, so clear anything a previous test left behind.
  const listing = await env.FILES.list({ prefix: "backups/" });
  if (listing.objects.length) await env.FILES.delete(listing.objects.map((o) => o.key));
});

async function seed() {
  await handleSync(env.DB, testMember, {
    since: 0,
    changes: [
      { table: "accounts", row: accountRow() },
      { table: "accounts", row: accountRow({ id: "acc_eur", name: "EUR cash", currency: "EUR" }) },
      { table: "transactions", row: txRow({ id: "tx_1", amount_minor: 124_000 }) },
      { table: "transactions", row: txRow({ id: "tx_2", amount_minor: 42_000 }) },
      {
        table: "transactions",
        row: txRow({
          id: "tx_3",
          kind: "transfer",
          category_id: null,
          to_account_id: "acc_eur",
          amount_minor: 5_000_000,
          to_amount_minor: 102_045,
          to_currency: "EUR",
        }),
      },
    ],
  });
}

describe("runBackup", () => {
  it("writes a snapshot to R2 and records it", async () => {
    await seed();
    const result = await runBackup(env.DB, env.FILES, "2026-08-05");

    expect(result.key).toBe("backups/daily/2026-08-05.json");
    expect(result.bytes).toBeGreaterThan(0);
    // 30 seeded categories + 2 accounts + 3 transactions. No member row: resetHousehold
    // clears them and these tests call handleSync directly rather than through ensureMember.
    expect(result.rows).toBe(35);

    const stored = await env.FILES.get(result.key);
    expect(stored).not.toBeNull();
  });

  it("records the schema version, so a restore years later knows what it is reading", async () => {
    await seed();
    const result = await runBackup(env.DB, env.FILES, "2026-08-05");
    const body = await (await env.FILES.get(result.key))!.json<{ schema: number; app: string }>();
    expect(body.schema).toBe(1);
    expect(body.app).toBe("SAYings");
  });

  it("promotes a month-end snapshot to the monthly set", async () => {
    await seed();
    // 31 August is the last day of the month, so this one is kept for a year, not a month.
    const result = await runBackup(env.DB, env.FILES, "2026-08-31");
    expect(result.kind).toBe("monthly");
    expect(result.key).toBe("backups/monthly/2026-08-31.json");

    const midMonth = await runBackup(env.DB, env.FILES, "2026-08-15");
    expect(midMonth.kind).toBe("daily");
  });

  it("handles February correctly when deciding month-end", async () => {
    await seed();
    expect((await runBackup(env.DB, env.FILES, "2026-02-28")).kind).toBe("monthly");
    // 2028 is a leap year, so the 28th is not month-end.
    expect((await runBackup(env.DB, env.FILES, "2028-02-28")).kind).toBe("daily");
    expect((await runBackup(env.DB, env.FILES, "2028-02-29")).kind).toBe("monthly");
  });

  it("is idempotent for the same day", async () => {
    await seed();
    await runBackup(env.DB, env.FILES, "2026-08-05");
    await runBackup(env.DB, env.FILES, "2026-08-05");
    expect(await listBackups(env.DB)).toHaveLength(1);
  });

  it("prunes daily snapshots beyond the retention window", async () => {
    await seed();
    // 32 consecutive days, avoiding month ends so they all land in the daily set.
    for (let day = 1; day <= 32; day++) {
      const date = `2026-07-${String(day).padStart(2, "0")}`;
      if (day <= 30) await runBackup(env.DB, env.FILES, date);
    }
    await runBackup(env.DB, env.FILES, "2026-08-01");
    await runBackup(env.DB, env.FILES, "2026-08-02");

    const listing = await env.FILES.list({ prefix: "backups/daily/" });
    expect(listing.objects).toHaveLength(30);
    // The oldest went first; keys are ISO-dated so lexical order is chronological.
    expect(listing.objects.map((o) => o.key)).not.toContain("backups/daily/2026-07-01.json");
    expect(listing.objects.map((o) => o.key)).toContain("backups/daily/2026-08-02.json");
  });

  it("reports the latest backup for the Settings screen", async () => {
    await seed();
    await runBackup(env.DB, env.FILES, "2026-08-05");
    const latest = await latestBackup(env.DB);
    expect(latest?.key).toBe("backups/daily/2026-08-05.json");
    expect(latest?.row_count).toBe(35);
  });
});

describe("restore", () => {
  it("reproduces the data exactly after the database is wiped", async () => {
    await seed();

    const before = {
      rev: await currentRev(env.DB),
      transactions: (await env.DB.prepare(`SELECT * FROM transactions ORDER BY id`).all()).results,
      accounts: (await env.DB.prepare(`SELECT * FROM accounts ORDER BY id`).all()).results,
      spend: (
        await env.DB.prepare(
          `SELECT SUM(base_amount_minor) AS total FROM transactions
            WHERE kind = 'expense' AND deleted = 0`,
        ).first<{ total: number }>()
      )?.total,
    };

    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");

    // Wipe everything a real disaster would take with it.
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM transactions`),
      env.DB.prepare(`DELETE FROM accounts`),
      env.DB.prepare(`DELETE FROM categories`),
      env.DB.prepare(`DELETE FROM members`),
    ]);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM transactions`).first<{ n: number }>())!.n).toBe(0);

    // Restore from the snapshot alone.
    const snapshot = await (await env.FILES.get(key))!.json<{
      tables: Record<string, Record<string, unknown>[]>;
    }>();

    for (const table of ["members", "accounts", "categories", "transactions"] as const) {
      for (const row of snapshot.tables[table] ?? []) {
        await upsertStatement(env.DB, table, row).run();
      }
    }

    const after = {
      transactions: (await env.DB.prepare(`SELECT * FROM transactions ORDER BY id`).all()).results,
      accounts: (await env.DB.prepare(`SELECT * FROM accounts ORDER BY id`).all()).results,
      spend: (
        await env.DB.prepare(
          `SELECT SUM(base_amount_minor) AS total FROM transactions
            WHERE kind = 'expense' AND deleted = 0`,
        ).first<{ total: number }>()
      )?.total,
    };

    expect(after.transactions).toEqual(before.transactions);
    expect(after.accounts).toEqual(before.accounts);
    // The figure that actually matters: reports over restored data must agree.
    expect(after.spend).toBe(before.spend);
    expect(after.spend).toBe(166_000);
  });

  it("preserves both legs of a cross-currency transfer through a restore", async () => {
    await seed();
    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");
    await env.DB.prepare(`DELETE FROM transactions`).run();

    const snapshot = await (await env.FILES.get(key))!.json<{
      tables: Record<string, Record<string, unknown>[]>;
    }>();
    for (const row of snapshot.tables.transactions ?? []) {
      await upsertStatement(env.DB, "transactions", row).run();
    }

    const transfer = await env.DB.prepare(`SELECT * FROM transactions WHERE id = 'tx_3'`).first<{
      amount_minor: number;
      to_amount_minor: number;
      to_currency: string;
    }>();

    // Both legs are stored explicitly, so neither balance depends on reconstructing a rate.
    expect(transfer!.amount_minor).toBe(5_000_000);
    expect(transfer!.to_amount_minor).toBe(102_045);
    expect(transfer!.to_currency).toBe("EUR");
  });

  it("includes soft-deleted rows, so a restore reproduces deletions too", async () => {
    await seed();
    await handleSync(env.DB, testMember, {
      since: 0,
      changes: [{ table: "transactions", row: txRow({ id: "tx_1", updated_at: 9_999_999_999_999, deleted: 1 }) }],
    });

    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");
    const snapshot = await (await env.FILES.get(key))!.json<{
      tables: Record<string, Record<string, unknown>[]>;
    }>();

    const deleted = snapshot.tables.transactions!.find((row) => row.id === "tx_1");
    // A backup that silently drops deletions is not a faithful copy — restoring it would
    // resurrect every transaction ever removed.
    expect(deleted?.deleted).toBe(1);
  });
});
