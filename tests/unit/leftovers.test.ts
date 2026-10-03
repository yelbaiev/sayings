import { crc32 as nodeCrc32 } from "node:zlib";
import type { Budget, Recurring, Transaction } from "@shared/schema";
import { describe, expect, it } from "vitest";
import { mergeWrites } from "~/features/categories/merge";
import { exportFiles } from "~/features/settings/export";
import { rolloverCredit } from "~/lib/budget-engine";
import { addMonths, formatAmount } from "~/lib/format";
import { crc32, zipStore } from "~/lib/zip";

/** The small fixes from the 2026-10-03 bug check that close the data-integrity plan. */

const budget = (overrides: Partial<Budget> = {}) =>
  ({
    id: "b1",
    household_id: "hh_default",
    category_id: "cat_groceries",
    period_month: null,
    amount_minor: 1_000,
    currency: "UAH",
    rollover: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
    ...overrides,
  }) as Budget;

const spend = (month: string, amount: number, category = "cat_groceries") =>
  ({
    id: `${category}-${month}`,
    kind: "expense",
    category_id: category,
    occurred_on: `${month}-15`,
    amount_minor: amount,
    base_amount_minor: amount,
    currency: "UAH",
    account_id: "a",
    deleted: 0,
  }) as Transaction;

describe("rollover window", () => {
  it("counts the most recent 36 months, not the first 36", () => {
    // Five years of history. Old months underspent by 1 000; the last 36 overspent by 500.
    const rows: Transaction[] = [];
    for (let i = 60; i >= 1; i--) {
      const month = addMonths("2026-10", -i);
      rows.push(spend(month, i > 36 ? 0 : 1_500));
    }
    // 36 months × (1 000 limit − 1 500 spent) = −18 000. The old walk counted the first 36 months
    // instead: 24 × +1 000 and 12 × −500 = +18 000 — the opposite sign.
    expect(rolloverCredit(budget(), rows, "2026-10")).toBe(-18_000);
  });
});

describe("currency digits in plain amounts", () => {
  it("shows no decimals for yen and three for dinar", () => {
    expect(formatAmount(1_000, "JPY", "en", true)).toBe("1,000");
    expect(formatAmount(10_125, "TND", "en", true)).toBe("10.125");
    expect(formatAmount(10_050, "EUR", "en", true)).toBe("100.50");
  });
});

describe("merging categories", () => {
  const schedule = (category: string) =>
    ({
      id: `r-${category}`,
      template: JSON.stringify({
        kind: "expense",
        amount_minor: 400,
        currency: "UAH",
        category_id: category,
        account_id: "a",
      }),
      deleted: 0,
    }) as Recurring;

  it("moves transactions, recurring payments and an unclashing budget", () => {
    const writes = mergeWrites(
      "netflix",
      "subs",
      [spend("2026-09", 400, "netflix"), spend("2026-09", 900, "subs")],
      [schedule("netflix"), schedule("other")],
      [budget({ id: "b_netflix", category_id: "netflix" })],
    );
    expect(writes.transactions.map((t) => t.category_id)).toEqual(["subs"]);
    expect(writes.recurring).toHaveLength(1);
    expect(JSON.parse(writes.recurring[0]!.template).category_id).toBe("subs");
    expect(writes.budgets.map((b) => [b.id, b.category_id])).toEqual([["b_netflix", "subs"]]);
    expect(writes.removeBudgetIds).toEqual([]);
  });

  it("keeps the target's budget when both have one for the same period", () => {
    const writes = mergeWrites(
      "netflix",
      "subs",
      [],
      [],
      [budget({ id: "b_netflix", category_id: "netflix" }), budget({ id: "b_subs", category_id: "subs" })],
    );
    expect(writes.budgets).toEqual([]);
    expect(writes.removeBudgetIds).toEqual(["b_netflix"]);
  });
});

describe("export", () => {
  const bundle = {
    exported_at: "2026-10-03T00:00:00Z",
    app: "SAYings",
    tables: { categories: [{ id: "c1", name: "Продукты" }], budgets: [] },
  };

  it("puts a byte-order mark on each CSV so Excel reads Cyrillic", () => {
    const files = exportFiles(bundle, "2026-10-03");
    const csv = files.find((f) => f.name.endsWith(".csv"))!;
    // Checked as bytes: TextDecoder would silently strip the very mark being tested for.
    expect([...csv.data.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // Empty tables are left out; JSON plus one CSV.
    expect(files.map((f) => f.name)).toEqual(["sayings-2026-10-03.json", "sayings-categories-2026-10-03.csv"]);
  });

  it("packs everything into one well-formed zip", () => {
    const files = exportFiles(bundle, "2026-10-03");
    const zip = zipStore(files);
    const view = new DataView(zip.buffer);

    // End-of-central-directory record: last 22 bytes.
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(files.length);

    // Each local entry: signature, CRC that matches Node's own, and the data stored verbatim.
    let at = 0;
    for (const file of files) {
      expect(view.getUint32(at, true)).toBe(0x04034b50);
      expect(view.getUint32(at + 14, true)).toBe(nodeCrc32(file.data));
      const nameLength = view.getUint16(at + 26, true);
      const start = at + 30 + nameLength;
      expect(zip.slice(start, start + file.data.length)).toEqual(file.data);
      at = start + file.data.length;
    }
    expect(view.getUint32(end + 16, true)).toBe(at); // central directory starts where data ends
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
