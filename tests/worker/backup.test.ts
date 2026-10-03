import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { latestBackup, listBackups, runBackup } from "../../worker/backup";
import { snapshotToStatements } from "../../scripts/restore-sql.mjs";
import { currentRev } from "../../worker/db";
import { handleSync } from "../../worker/sync";
import { accountRow, otherMember, resetHousehold, testMember, txRow } from "./helpers";

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
    expect(body.schema).toBe(2);
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

/** Runs the statements `npm run db:restore` would, against the test database. */
async function restore(key: string): Promise<string[]> {
  const json = await (await env.FILES.get(key))!.text();
  const { statements, warnings } = snapshotToStatements(json);
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  return warnings;
}

/** A disaster: everything a fresh database would not have. */
async function wipe() {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM credentials`),
    env.DB.prepare(`DELETE FROM auth_sessions`),
    env.DB.prepare(`DELETE FROM transactions`),
    env.DB.prepare(`DELETE FROM accounts`),
    env.DB.prepare(`DELETE FROM categories`),
    env.DB.prepare(`DELETE FROM members`),
    env.DB.prepare(`DELETE FROM fx_rates`),
    env.DB.prepare(`DELETE FROM app_meta`),
    env.DB.prepare(`UPDATE households SET base_currency = 'UAH', enabled_currencies = '["UAH","EUR","USD"]'`),
    env.DB.prepare(`UPDATE household_seq SET rev = 1`),
  ]);
}

/** Rows without their rev, which a restore deliberately re-stamps. */
const withoutRev = (rows: Record<string, unknown>[]) => rows.map(({ rev: _rev, ...rest }) => rest);

describe("restore", () => {
  it("reproduces the data exactly after the database is wiped", async () => {
    await seed();

    const before = {
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
    await wipe();
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM transactions`).first<{ n: number }>())!.n).toBe(0);

    expect(await restore(key)).toEqual([]);

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

    expect(withoutRev(after.transactions)).toEqual(withoutRev(before.transactions));
    expect(withoutRev(after.accounts)).toEqual(withoutRev(before.accounts));
    // The figure that actually matters: reports over restored data must agree.
    expect(after.spend).toBe(before.spend);
    expect(after.spend).toBe(166_000);
  });

  it("brings back what makes it an installation: passkeys, main currency, rates, settings", async () => {
    await seed();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO members (id, household_id, email, display_name, created_at, rev, updated_at, deleted)
         VALUES ('mem_test', 'hh_default', 'test@example.com', 'Test', 1, 2, 1, 0)
         ON CONFLICT(id) DO NOTHING`,
      ),
      env.DB.prepare(
        `INSERT INTO credentials (id, member_id, public_key, counter, created_at)
         VALUES ('cred_1', 'mem_test', 'pk-base64url', 7, 1)`,
      ),
      env.DB.prepare(
        `UPDATE households SET base_currency = 'EUR', enabled_currencies = '["EUR","UAH"]'`,
      ),
      env.DB.prepare(
        `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES ('2026-08-04', 'UAH', 0.0194, 'derived', 'EUR')`,
      ),
      env.DB.prepare(`INSERT INTO app_meta (key, value, updated_at) VALUES ('currency_setup', 'done', 1)`),
    ]);

    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");
    await wipe();
    await restore(key);

    const credential = await env.DB.prepare(`SELECT member_id, counter FROM credentials WHERE id = 'cred_1'`)
      .first<{ member_id: string; counter: number }>();
    expect(credential).toEqual({ member_id: "mem_test", counter: 7 });

    const household = await env.DB.prepare(`SELECT base_currency, enabled_currencies FROM households`)
      .first<{ base_currency: string; enabled_currencies: string }>();
    expect(household).toEqual({ base_currency: "EUR", enabled_currencies: '["EUR","UAH"]' });

    const rate = await env.DB.prepare(`SELECT base, source FROM fx_rates WHERE quote = 'UAH' AND on_date = '2026-08-04' AND base = 'EUR'`)
      .first<{ base: string; source: string }>();
    expect(rate).toEqual({ base: "EUR", source: "derived" });

    const meta = await env.DB.prepare(`SELECT value FROM app_meta WHERE key = 'currency_setup'`)
      .first<{ value: string }>();
    expect(meta?.value).toBe("done");

    await env.DB.prepare(`UPDATE households SET base_currency = 'UAH', enabled_currencies = '["UAH","EUR","USD"]'`).run();
  });

  it("puts every restored row above every phone's cursor, so phones re-read it and keep syncing", async () => {
    await seed();
    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");
    // A phone that kept syncing after the snapshot: its cursor is past anything in the backup.
    await handleSync(env.DB, testMember, { since: 0, changes: [{ table: "transactions", row: txRow() }] });
    const phoneCursor = await currentRev(env.DB);

    // Rolled back in place — the counter is not wiped, which is the harder case.
    await restore(key);

    const pulled = await handleSync(env.DB, testMember, { since: phoneCursor, changes: [] });
    const ids = pulled.changes.filter((c) => c.table === "transactions").map((c) => c.row.id);
    expect(ids).toEqual(expect.arrayContaining(["tx_1", "tx_2", "tx_3"]));

    // And a write after the restore reaches that phone too.
    await handleSync(env.DB, otherMember, { since: 0, changes: [{ table: "transactions", row: txRow({ id: "tx_after" }) }] });
    const next = await handleSync(env.DB, testMember, { since: pulled.rev, changes: [] });
    expect(next.changes.some((c) => c.row.id === "tx_after")).toBe(true);
  });

  it("clears sessions and invites rather than reviving them", async () => {
    await seed();
    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");
    await env.DB.prepare(
      `INSERT INTO members (id, household_id, email, display_name, created_at, rev, updated_at, deleted)
       VALUES ('mem_s', 'hh_default', 's@example.com', 'S', 1, 2, 1, 0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO auth_sessions (token_hash, member_id, created_at, expires_at) VALUES ('h', 'mem_s', 1, 9999999999999)`,
    ).run();

    await restore(key);
    const sessions = await env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_sessions`).first<{ n: number }>();
    expect(sessions!.n).toBe(0);
  });

  it("restores an old schema-1 snapshot, and says what it could not bring back", async () => {
    await seed();
    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");
    const snapshot = await (await env.FILES.get(key))!.json<{
      schema: number;
      tables: Record<string, unknown>;
    }>();
    for (const table of ["households", "household_seq", "app_meta", "credentials"]) delete snapshot.tables[table];
    snapshot.schema = 1;
    await env.FILES.put("backups/daily/old.json", JSON.stringify(snapshot));

    await wipe();
    const warnings = await restore("backups/daily/old.json");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/passkeys/i);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM transactions`).first<{ n: number }>();
    expect(count!.n).toBe(3);
  });

  it("preserves both legs of a cross-currency transfer through a restore", async () => {
    await seed();
    const { key } = await runBackup(env.DB, env.FILES, "2026-08-05");
    await wipe();
    await restore(key);

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
    await wipe();
    await restore(key);

    const deleted = await env.DB.prepare(`SELECT deleted FROM transactions WHERE id = 'tx_1'`)
      .first<{ deleted: number }>();
    // A backup that silently drops deletions is not a faithful copy — restoring it would
    // resurrect every transaction ever removed.
    expect(deleted?.deleted).toBe(1);
  });
});
