import type { Account, Budget, Category, Transaction } from "@shared/schema";
import { describe, expect, it } from "vitest";
import { savingsAccountFor, savingsSuggestion, suggestionMonth } from "~/lib/savings";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    household_id: "hh_default",
    name: id,
    type: "debit_card",
    currency: "UAH",
    opening_balance_minor: 0,
    exclude_from_totals: 0,
    archived: 0,
    sort_order: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
    ...overrides,
  } as Account;
}

function category(id: string): Category {
  return {
    id,
    household_id: "hh_default",
    kind: "expense",
    name: id,
    icon: "🛒",
    color: "#E5484D",
    archived: 0,
    sort_order: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
  };
}

function budget(categoryId: string, amount: number, rollover: 0 | 1 = 0): Budget {
  return {
    id: `b_${categoryId}`,
    household_id: "hh_default",
    category_id: categoryId,
    period_month: null,
    amount_minor: amount,
    currency: "UAH",
    rollover,
    rev: 1,
    updated_at: 1,
    deleted: 0,
  };
}

function tx(
  kind: Transaction["kind"],
  occurredOn: string,
  amount: number,
  extra: Partial<Transaction> = {},
): Transaction {
  return {
    id: crypto.randomUUID(),
    household_id: "hh_default",
    kind,
    occurred_on: occurredOn,
    account_id: "card",
    category_id: kind === "transfer" ? null : kind === "income" ? "salary" : "food",
    amount_minor: amount,
    currency: "UAH",
    base_amount_minor: amount,
    fx_rate: 1,
    fx_estimated: 0,
    rev: 1,
    updated_at: 1,
    deleted: 0,
    ...extra,
  } as Transaction;
}

const accounts = [
  account("card"),
  account("stash", { type: "savings" }),
  account("saldo", { exclude_from_totals: 1 }),
];
const categories = [category("food"), category("fun")];

describe("suggestionMonth", () => {
  it("looks back at the closed month during the first week", () => {
    expect(suggestionMonth("2026-10-07")).toEqual({ month: "2026-09", inProgress: false });
  });

  it("reads the current month after that", () => {
    expect(suggestionMonth("2026-10-08")).toEqual({ month: "2026-10", inProgress: true });
  });
});

describe("savingsSuggestion", () => {
  const today = "2026-10-03"; // looks back at September

  it("suggests income minus expenses, less what already went to savings", () => {
    const rows = [
      tx("income", "2026-09-01", 6_000_000),
      tx("expense", "2026-09-10", 4_000_000),
      tx("transfer", "2026-09-15", 500_000, { to_account_id: "stash" }),
    ];
    const s = savingsSuggestion(rows, accounts, [], categories, today);
    expect(s.leftover).toBe(2_000_000);
    expect(s.alreadySaved).toBe(500_000);
    expect(s.suggested).toBe(1_500_000);
  });

  it("does not add the under-limit amount on top of the leftover", () => {
    const rows = [
      tx("income", "2026-09-01", 1_000_000),
      tx("expense", "2026-09-10", 600_000, { category_id: "food" }),
    ];
    const s = savingsSuggestion(rows, accounts, [budget("food", 800_000)], categories, today);
    expect(s.underLimits).toBe(200_000);
    expect(s.underCount).toBe(1);
    expect(s.suggested).toBe(400_000);
  });

  it("leaves rollover limits out of the under-limit figure but still reports them over", () => {
    const rows = [
      tx("income", "2026-09-01", 1_000_000),
      tx("expense", "2026-09-10", 100_000, { category_id: "food" }),
      tx("expense", "2026-09-11", 300_000, { category_id: "fun" }),
    ];
    const s = savingsSuggestion(
      rows,
      accounts,
      [budget("food", 500_000, 1), budget("fun", 200_000, 1)],
      categories,
      today,
    );
    expect(s.underLimits).toBe(0);
    expect(s.over.map((o) => o.category.id)).toEqual(["fun"]);
  });

  it("ignores accounts excluded from totals and other months", () => {
    const rows = [
      tx("income", "2026-09-01", 1_000_000),
      tx("expense", "2026-09-01", 900_000, { account_id: "saldo" }),
      tx("expense", "2026-08-30", 900_000),
    ];
    expect(savingsSuggestion(rows, accounts, [], categories, today).leftover).toBe(1_000_000);
  });

  it("counts withdrawals from savings against what was saved, and never suggests below zero", () => {
    const rows = [
      tx("income", "2026-09-01", 1_000_000),
      tx("expense", "2026-09-05", 1_200_000),
      tx("transfer", "2026-09-06", 300_000, { account_id: "stash", to_account_id: "card" }),
    ];
    const s = savingsSuggestion(rows, accounts, [], categories, today);
    expect(s.alreadySaved).toBe(-300_000);
    expect(s.leftover).toBe(-200_000);
    expect(s.suggested).toBe(0);
  });
});

describe("savingsAccountFor", () => {
  it("prefers a savings account in the base currency", () => {
    const list = [
      account("eur", { type: "savings", currency: "EUR" }),
      account("uah", { type: "savings" }),
    ];
    expect(savingsAccountFor(list, "UAH")?.id).toBe("uah");
  });

  it("returns null when there is none", () => {
    expect(savingsAccountFor([account("card")], "UAH")).toBeNull();
  });
});
