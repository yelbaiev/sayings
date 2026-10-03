import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { currentRev } from "../../worker/db";
import { SyncError, dumpHousehold, handleSync } from "../../worker/sync";
import { accountRow, otherMember, resetHousehold, testMember, txRow } from "./helpers";

// Migrations run once in tests/worker/setup.ts; each test then starts from the freshly
// seeded state.
beforeEach(resetHousehold);

const push = (
  changes: { table: string; row: Record<string, unknown> }[],
  since = 0,
  member = testMember,
) => handleSync(env.DB, member, { since, changes });

describe("seed migration", () => {
  it("seeds the categories from the Saldo export at rev 1 so a fresh client can see them", async () => {
    // rev 0 rows would be invisible forever to a client syncing from cursor 0.
    const { changes } = await push([], 0);
    const categories = changes.filter((c) => c.table === "categories");
    expect(categories).toHaveLength(30); // 24 expense + 6 income
    expect(categories.every((c) => (c.row.rev as number) > 0)).toBe(true);
  });

  it("orders expense categories by 2026 spend, so entry tiles are useful before any history", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM categories WHERE kind = 'expense' ORDER BY sort_order LIMIT 4`,
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(["Groceries", "Travel", "Home", "Transport"]);
  });
});

describe("push", () => {
  it("assigns a server rev and returns the row back to its author", async () => {
    const row = txRow();
    const { changes, rev } = await push([
      { table: "accounts", row: accountRow() },
      { table: "transactions", row },
    ]);

    const stored = changes.find((c) => c.table === "transactions" && c.row.id === row.id);
    expect(stored).toBeDefined();
    expect(stored!.row.rev as number).toBeGreaterThan(1);
    expect(rev).toBe(await currentRev(env.DB));
  });

  it("is idempotent: replaying the same batch changes nothing", async () => {
    const batch = [
      { table: "accounts", row: accountRow() },
      { table: "transactions", row: txRow({ id: "tx_fixed" }) },
    ];

    await push(batch);
    const { results: afterFirst } = await env.DB.prepare(
      `SELECT * FROM transactions WHERE id = 'tx_fixed'`,
    ).all();

    // A dropped mobile connection means the client retries the identical batch.
    await push(batch);
    const { results: afterSecond } = await env.DB.prepare(
      `SELECT * FROM transactions`,
    ).all();

    expect(afterSecond).toHaveLength(1);
    // Same content, and specifically not duplicated under a new id.
    expect(afterSecond[0]!.amount_minor).toBe(afterFirst[0]!.amount_minor);
  });

  it("overwrites authorship rather than trusting updated_by from the payload", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    await push(
      [{ table: "transactions", row: txRow({ id: "tx_forged", updated_by: "mem_someone_else" }) }],
      0,
      otherMember,
    );

    const row = await env.DB.prepare(`SELECT updated_by FROM transactions WHERE id = 'tx_forged'`)
      .first<{ updated_by: string }>();
    expect(row!.updated_by).toBe(otherMember.id);
  });

  it("forces household_id, so a client cannot write into another household", async () => {
    await push([{ table: "accounts", row: accountRow({ household_id: "hh_someone_else" }) }]);
    const row = await env.DB.prepare(`SELECT household_id FROM accounts WHERE id = 'acc_mono'`)
      .first<{ household_id: string }>();
    expect(row!.household_id).toBe("hh_default");
  });

  it("rejects a transfer with no destination account", async () => {
    await expect(
      push([{ table: "transactions", row: txRow({ kind: "transfer", category_id: null }) }]),
    ).rejects.toBeInstanceOf(SyncError);
  });

  it("rejects a transfer into the account it leaves", async () => {
    await expect(
      push([
        {
          table: "transactions",
          row: txRow({ kind: "transfer", category_id: null, to_account_id: "acc_mono" }),
        },
      ]),
    ).rejects.toBeInstanceOf(SyncError);
  });

  it("rejects an expense with no category", async () => {
    await expect(
      push([{ table: "transactions", row: txRow({ category_id: null }) }]),
    ).rejects.toBeInstanceOf(SyncError);
  });

  it("rejects a negative amount — magnitudes only, direction comes from kind", async () => {
    await expect(
      push([{ table: "transactions", row: txRow({ amount_minor: -500 }) }]),
    ).rejects.toBeInstanceOf(SyncError);
  });

  it("rejects a non-integer amount, so a float can never reach the ledger", async () => {
    await expect(
      push([{ table: "transactions", row: txRow({ amount_minor: 1240.5 }) }]),
    ).rejects.toBeInstanceOf(SyncError);
  });

  it("rejects an unparseable date", async () => {
    await expect(
      push([{ table: "transactions", row: txRow({ occurred_on: "05.08.2026" }) }]),
    ).rejects.toBeInstanceOf(SyncError);
  });
});

describe("last-write-wins", () => {
  it("keeps the newer version and reports the loser as a conflict", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    await push([
      { table: "transactions", row: txRow({ id: "tx_lww", amount_minor: 500, updated_at: 2000 }) },
    ]);

    // The other device edited the same row, but earlier in wall-clock terms.
    const { conflicts } = await push(
      [
        {
          table: "transactions",
          row: txRow({ id: "tx_lww", amount_minor: 900, updated_at: 1000 }),
        },
      ],
      0,
      otherMember,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.row.amount_minor).toBe(500);

    const stored = await env.DB.prepare(
      `SELECT amount_minor FROM transactions WHERE id = 'tx_lww'`,
    ).first<{ amount_minor: number }>();
    expect(stored!.amount_minor).toBe(500);
  });

  it("accepts a strictly newer version", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    await push([{ table: "transactions", row: txRow({ id: "tx_new", amount_minor: 500, updated_at: 1000 }) }]);
    const { conflicts } = await push([
      { table: "transactions", row: txRow({ id: "tx_new", amount_minor: 900, updated_at: 2000 }) },
    ]);

    expect(conflicts).toHaveLength(0);
    const stored = await env.DB.prepare(
      `SELECT amount_minor FROM transactions WHERE id = 'tx_new'`,
    ).first<{ amount_minor: number }>();
    expect(stored!.amount_minor).toBe(900);
  });
});

describe("pull cursor", () => {
  it("returns only rows above the cursor", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    const afterAccount = await currentRev(env.DB);

    await push([{ table: "transactions", row: txRow({ id: "tx_later" }) }]);

    const { changes } = await push([], afterAccount);
    expect(changes.map((c) => c.row.id)).toEqual(["tx_later"]);
  });

  it("advances monotonically, so no row can land below a cursor already passed", async () => {
    const revs: number[] = [];
    await push([{ table: "accounts", row: accountRow() }]);
    for (let i = 0; i < 5; i++) {
      const { rev } = await push([{ table: "transactions", row: txRow({ id: `tx_${i}` }) }]);
      revs.push(rev);
    }
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(new Set(revs).size).toBe(revs.length);
  });

  it("propagates soft deletes", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    await push([{ table: "transactions", row: txRow({ id: "tx_gone", updated_at: 1000 }) }]);
    const before = await currentRev(env.DB);

    await push([
      { table: "transactions", row: txRow({ id: "tx_gone", updated_at: 2000, deleted: 1 }) },
    ]);

    const { changes } = await push([], before);
    const deleted = changes.find((c) => c.row.id === "tx_gone");
    expect(deleted).toBeDefined();
    expect(deleted!.row.deleted).toBe(1);
  });

  it("orders parent tables before children, so a client never references a missing row", async () => {
    await push([
      { table: "transactions", row: txRow({ id: "tx_order" }) },
      { table: "accounts", row: accountRow() },
    ]);

    const { changes } = await push([], 0);
    const accountIndex = changes.findIndex((c) => c.table === "accounts");
    const txIndex = changes.findIndex((c) => c.table === "transactions");
    expect(accountIndex).toBeLessThan(txIndex);
  });
});

describe("dumpHousehold", () => {
  it("captures every row, which is what the backup and export paths rely on", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    await push([{ table: "transactions", row: txRow({ id: "tx_dump" }) }]);

    const dump = await dumpHousehold(env.DB);
    expect(dump.categories).toHaveLength(30);
    expect(dump.accounts).toHaveLength(1);
    expect(dump.transactions).toHaveLength(1);
  });
});

describe("authorship survives edits", () => {
  it("keeps created_by when the other member edits the row", async () => {
    /*
     * The rule, in the user's own words: if Лена recorded it and Сергей fixed a typo, it is still
     * Лена's transaction. updated_by must move (last-write-wins depends on it); created_by must
     * not. The upsert only writes columns present in the payload, so even an edit that omits
     * created_by preserves it — which is also what a pre-migration client's edit does.
     */
    await handleSync(env.DB, testMember, {
      since: 0,
      changes: [
        { table: "accounts", row: accountRow() },
        { table: "transactions", row: txRow({ id: "tx_lena", created_by: testMember.id }) },
      ],
    });

    // The other member edits the note — their client includes created_by preserved, as the entry
    // sheet does.
    await handleSync(env.DB, otherMember, {
      since: 0,
      changes: [
        {
          table: "transactions",
          row: txRow({
            id: "tx_lena",
            note: "исправил опечатку",
            created_by: testMember.id,
            updated_at: Date.now() + 1000,
          }),
        },
      ],
    });

    const row = await env.DB.prepare(
      `SELECT created_by, updated_by FROM transactions WHERE id = 'tx_lena'`,
    ).first<{ created_by: string; updated_by: string }>();
    expect(row!.created_by).toBe(testMember.id);
    expect(row!.updated_by).toBe(otherMember.id);
  });

  it("preserves created_by even when an old client's edit omits the column", async () => {
    await handleSync(env.DB, testMember, {
      since: 0,
      changes: [
        { table: "accounts", row: accountRow() },
        { table: "transactions", row: txRow({ id: "tx_old", created_by: testMember.id }) },
      ],
    });

    const edited = txRow({ id: "tx_old", note: "edited", updated_at: Date.now() + 1000 });
    delete (edited as Record<string, unknown>).created_by;
    await handleSync(env.DB, otherMember, { since: 0, changes: [{ table: "transactions", row: edited }] });

    const row = await env.DB.prepare(
      `SELECT created_by FROM transactions WHERE id = 'tx_old'`,
    ).first<{ created_by: string }>();
    expect(row!.created_by).toBe(testMember.id);
  });
});

describe("pull cursor", () => {
  /** Pulls from `since` until the server says there is no more, the way the client loops. */
  async function pullAll(since: number, limit: number) {
    const seen = new Map<string, number>();
    let cursor = since;
    for (let round = 0; round < 100; round++) {
      const response = await handleSync(env.DB, testMember, { since: cursor, changes: [] }, limit);
      for (const { table, row } of response.changes) seen.set(`${table}:${String(row.id)}`, row.rev as number);
      // The cursor only moves forward, and never past a row it has not handed over.
      expect(response.rev).toBeGreaterThanOrEqual(cursor);
      for (const { row } of response.changes) expect(row.rev as number).toBeLessThanOrEqual(response.rev);
      cursor = response.rev;
      if (!response.more) return { seen, cursor };
    }
    throw new Error("pull never finished");
  }

  async function everyRow(): Promise<Set<string>> {
    const dump = await dumpHousehold(env.DB);
    return new Set(
      Object.entries(dump).flatMap(([table, rows]) => rows.map((row) => `${table}:${String(row.id)}`)),
    );
  }

  it("delivers every row when a table is larger than one pull", async () => {
    // The bug: a truncated pull returned the head rev, and the rows past the cap were never sent.
    await push([{ table: "accounts", row: accountRow() }]);
    await push(Array.from({ length: 12 }, () => ({ table: "transactions", row: txRow() })));

    const { seen, cursor } = await pullAll(0, 5);
    expect(new Set(seen.keys())).toEqual(await everyRow());
    expect(cursor).toBe(await currentRev(env.DB));
  });

  it("holds back a later row in another table until the truncated one catches up", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    const before = await currentRev(env.DB);
    await push(Array.from({ length: 6 }, () => ({ table: "transactions", row: txRow() })));
    // Written last, so its rev is above every transaction's — and its table is not the one cut off.
    await push([{ table: "accounts", row: accountRow({ name: "Mono renamed", updated_at: Date.now() + 1 }) }]);

    const first = await handleSync(env.DB, testMember, { since: before, changes: [] }, 3);
    expect(first.more).toBe(true);
    expect(first.changes.some((c) => c.table === "accounts")).toBe(false);

    const { seen } = await pullAll(before, 3);
    expect([...seen.keys()].filter((key) => key.startsWith("transactions:"))).toHaveLength(6);
    expect(seen.has("accounts:acc_mono")).toBe(true);
  });

  it("never ends a page partway through rows that share a rev", async () => {
    // The seed puts all 30 categories at rev 1, and an import writes hundreds of rows under one rev.
    // A page cut at 5 used to leave the cursor at 1 with 25 categories never sent.
    const first = await handleSync(env.DB, testMember, { since: 0, changes: [] }, 5);
    const categories = first.changes.filter((c) => c.table === "categories");
    expect(categories).toHaveLength(30);
    expect(first.rev).toBe(1);
  });

  it("labels each pushed row with its own consecutive rev, allocated with the write", async () => {
    await push([{ table: "accounts", row: accountRow() }]);
    const before = await currentRev(env.DB);
    await push(Array.from({ length: 3 }, () => ({ table: "transactions", row: txRow() })));

    const { results } = await env.DB.prepare(
      `SELECT rev FROM transactions WHERE rev > ? ORDER BY rev`,
    )
      .bind(before)
      .all<{ rev: number }>();
    expect(results.map((r) => r.rev)).toEqual([before + 1, before + 2, before + 3]);
  });
});

describe("members through sync", () => {
  async function seedMembers() {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO members (id, household_id, email, display_name, avatar_color, locale, role, created_at, rev, updated_at, deleted)
         VALUES ('mem_test', 'hh_default', 'test@example.com', 'Test', '#3E63DD', 'en', 'owner', 1, 2, 1, 0)`,
      ),
      env.DB.prepare(
        `INSERT INTO members (id, household_id, email, display_name, avatar_color, locale, role, created_at, rev, updated_at, deleted)
         VALUES ('mem_other', 'hh_default', 'other@example.com', 'Other', '#E93D82', 'en', 'member', 1, 2, 1, 0)`,
      ),
    ]);
  }

  const memberRow = async (id: string) =>
    (await env.DB.prepare(`SELECT * FROM members WHERE id = ?`).bind(id).first<Record<string, unknown>>())!;

  it("lets a member change their own name, language and default account", async () => {
    await seedMembers();
    const own = await memberRow("mem_other");
    await push([{ table: "members", row: { ...own, display_name: "Лена", locale: "ru", updated_at: 50 } }], 0, otherMember);

    const after = await memberRow("mem_other");
    expect(after.display_name).toBe("Лена");
    expect(after.locale).toBe("ru");
  });

  it("ignores a role, deletion or email change on your own row", async () => {
    await seedMembers();
    const own = await memberRow("mem_other");
    await push(
      [{ table: "members", row: { ...own, role: "owner", deleted: 1, email: "x@evil.test", updated_at: 50 } }],
      0,
      otherMember,
    );

    const after = await memberRow("mem_other");
    expect(after.role).toBe("member");
    expect(after.deleted).toBe(0);
    expect(after.email).toBe("other@example.com");
  });

  it("refuses another member's row and sends the stored one back", async () => {
    await seedMembers();
    const owner = await memberRow("mem_test");
    const { conflicts } = await push(
      [{ table: "members", row: { ...owner, deleted: 1, display_name: "Gone", updated_at: 50 } }],
      0,
      otherMember,
    );

    const after = await memberRow("mem_test");
    expect(after.deleted).toBe(0);
    expect(after.display_name).toBe("Test");
    expect(conflicts.some((c) => c.table === "members" && c.row.id === "mem_test")).toBe(true);
  });
});
