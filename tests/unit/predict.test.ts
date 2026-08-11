import type { Transaction } from "@shared/schema";
import { describe, expect, it } from "vitest";
import { findLikelyDuplicate, resolveAccountId } from "~/lib/predict";

function tx(overrides: Partial<Transaction> & { occurred_on: string }): Transaction {
  return {
    id: crypto.randomUUID(),
    household_id: "hh_default",
    kind: "expense",
    account_id: "acc_mono",
    category_id: "cat_groceries",
    amount_minor: 100_000,
    currency: "UAH",
    base_amount_minor: 100_000,
    fx_rate: 1,
    fx_estimated: 0,
    rev: 1,
    updated_at: 1_780_000_000_000,
    deleted: 0,
    ...overrides,
  } as Transaction;
}

describe("findLikelyDuplicate", () => {
  const now = 1_780_000_100_000;

  const theirs = tx({
    occurred_on: "2026-08-05",
    category_id: "cat_groceries",
    amount_minor: 124_000,
    updated_by: "mem_wife",
    updated_at: now - 20 * 60_000,
  });

  it("flags the same amount, category and day from the other person", () => {
    const hit = findLikelyDuplicate(
      [theirs],
      {
        categoryId: "cat_groceries",
        amountMinor: 124_000,
        occurredOn: "2026-08-05",
        authorId: "mem_me",
      },
      now,
    );
    expect(hit?.memberId).toBe("mem_wife");
  });

  it("tolerates a small difference, since receipts get rounded when recalled", () => {
    const hit = findLikelyDuplicate(
      [theirs],
      {
        categoryId: "cat_groceries",
        amountMinor: 125_000, // within 2%
        occurredOn: "2026-08-05",
        authorId: "mem_me",
      },
      now,
    );
    expect(hit).not.toBeNull();
  });

  it("does not flag a clearly different amount", () => {
    const hit = findLikelyDuplicate(
      [theirs],
      {
        categoryId: "cat_groceries",
        amountMinor: 200_000,
        occurredOn: "2026-08-05",
        authorId: "mem_me",
      },
      now,
    );
    expect(hit).toBeNull();
  });

  it("never flags your own entries", () => {
    // Two coffees or two metro rides in a day are normal and deliberate.
    const mine = { ...theirs, updated_by: "mem_me" };
    const hit = findLikelyDuplicate(
      [mine],
      {
        categoryId: "cat_groceries",
        amountMinor: 124_000,
        occurredOn: "2026-08-05",
        authorId: "mem_me",
      },
      now,
    );
    expect(hit).toBeNull();
  });

  it("ignores entries older than six hours", () => {
    const stale = { ...theirs, updated_at: now - 7 * 3_600_000 };
    const hit = findLikelyDuplicate(
      [stale],
      {
        categoryId: "cat_groceries",
        amountMinor: 124_000,
        occurredOn: "2026-08-05",
        authorId: "mem_me",
      },
      now,
    );
    expect(hit).toBeNull();
  });

  it("ignores a different day or category", () => {
    for (const candidate of [
      { occurredOn: "2026-08-04", categoryId: "cat_groceries" },
      { occurredOn: "2026-08-05", categoryId: "cat_pets" },
    ]) {
      expect(
        findLikelyDuplicate(
          [theirs],
          { ...candidate, amountMinor: 124_000, authorId: "mem_me" },
          now,
        ),
      ).toBeNull();
    }
  });
});

describe("resolveAccountId", () => {
  const AVAILABLE = ["acc_mono", "acc_cash", "acc_eur"];
  const base = {
    categoryId: "cat_groceries" as string | null,
    transactions: [] as Transaction[],
    availableIds: AVAILABLE,
  };

  it("lets context win over everything — it is a statement of intent, not a guess", () => {
    expect(
      resolveAccountId({
        ...base,
        contextAccountId: "acc_eur",
        lastByCategory: { cat_groceries: "acc_mono" },
        defaultAccountId: "acc_cash",
        transactions: [tx({ occurred_on: "2026-08-01", account_id: "acc_mono" })],
      }),
    ).toBe("acc_eur");
  });

  it("prefers this device's memory for the category over the default", () => {
    // The pairing is evidence; the default is only a preference.
    expect(
      resolveAccountId({
        ...base,
        lastByCategory: { cat_groceries: "acc_mono" },
        defaultAccountId: "acc_cash",
      }),
    ).toBe("acc_mono");
  });

  it("falls back to category history when the device has no memory yet", () => {
    expect(
      resolveAccountId({
        ...base,
        defaultAccountId: "acc_cash",
        transactions: [
          tx({ occurred_on: "2026-08-01", category_id: "cat_groceries", account_id: "acc_eur" }),
        ],
      }),
    ).toBe("acc_eur");
  });

  it("uses the default when nothing about this category is known", () => {
    expect(
      resolveAccountId({
        ...base,
        categoryId: "cat_brand_new",
        defaultAccountId: "acc_cash",
        transactions: [tx({ occurred_on: "2026-08-01", account_id: "acc_mono" })],
      }),
    ).toBe("acc_cash");
  });

  it("uses the default on a completely empty ledger", () => {
    expect(resolveAccountId({ ...base, categoryId: null, defaultAccountId: "acc_eur" })).toBe(
      "acc_eur",
    );
  });

  it("ignores any candidate that is not selectable", () => {
    // An archived or deleted account must never be preselected, whatever points at it.
    expect(
      resolveAccountId({
        ...base,
        contextAccountId: "acc_deleted",
        lastByCategory: { cat_groceries: "acc_archived" },
        defaultAccountId: "acc_gone",
        transactions: [tx({ occurred_on: "2026-08-01", account_id: "acc_also_gone" })],
      }),
    ).toBe("acc_mono");
  });

  it("falls back to the first available account when there is nothing else at all", () => {
    expect(resolveAccountId({ ...base, categoryId: null })).toBe("acc_mono");
  });

  it("returns null when there are no accounts", () => {
    expect(resolveAccountId({ ...base, categoryId: null, availableIds: [] })).toBeNull();
  });
});
