import type { Budget, Category, Transaction } from "@shared/schema";
import { describe, expect, it } from "vitest";
import { budgetFor, budgetStatus, budgetStatuses, rolloverCredit, spentInMonth } from "~/lib/budget-engine";

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "b1",
    household_id: "hh_default",
    category_id: "cat_groceries",
    period_month: null,
    amount_minor: 1_000_000, // ₴10 000
    currency: "UAH",
    rollover: 0,
    rev: 1,
    updated_at: 1,
    deleted: 0,
    ...overrides,
  };
}

function category(id = "cat_groceries", name = "Groceries"): Category {
  return {
    id,
    household_id: "hh_default",
    kind: "expense",
    name,
    icon: "🛒",
    color: "#E5484D",
    archived: 0,
    sort_order: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
  };
}

function tx(occurredOn: string, amount: number, categoryId = "cat_groceries"): Transaction {
  return {
    id: crypto.randomUUID(),
    household_id: "hh_default",
    kind: "expense",
    occurred_on: occurredOn,
    account_id: "mono",
    category_id: categoryId,
    amount_minor: amount,
    currency: "UAH",
    base_amount_minor: amount,
    fx_rate: 1,
    fx_estimated: 0,
    rev: 1,
    updated_at: 1,
    deleted: 0,
  } as Transaction;
}

describe("spentInMonth", () => {
  it("sums only the requested category and month", () => {
    const rows = [
      tx("2026-08-01", 300_000),
      tx("2026-08-20", 200_000),
      tx("2026-07-15", 900_000),
      tx("2026-08-05", 500_000, "cat_travel"),
    ];
    expect(spentInMonth(rows, "cat_groceries", "2026-08")).toBe(500_000);
  });

  it("ignores transfers", () => {
    const transfer = {
      ...tx("2026-08-01", 700_000),
      kind: "transfer" as const,
      category_id: "cat_groceries",
    };
    expect(spentInMonth([transfer], "cat_groceries", "2026-08")).toBe(0);
  });
});

describe("budgetFor", () => {
  it("prefers a month-specific budget over the standing one", () => {
    // Lets a one-off December be set without disturbing the recurring limit.
    const recurring = budget({ id: "recurring", amount_minor: 1_000_000 });
    const december = budget({ id: "dec", period_month: "2026-12", amount_minor: 2_000_000 });

    expect(budgetFor([recurring, december], "cat_groceries", "2026-12")?.id).toBe("dec");
    expect(budgetFor([recurring, december], "cat_groceries", "2026-11")?.id).toBe("recurring");
  });

  it("ignores deleted budgets", () => {
    expect(budgetFor([budget({ deleted: 1 })], "cat_groceries", "2026-08")).toBeUndefined();
  });
});

describe("budgetStatus", () => {
  it("reports spend against the limit", () => {
    const status = budgetStatus(
      budget(),
      category(),
      [tx("2026-08-01", 400_000)],
      "2026-08",
      "2026-08-31",
    );
    expect(status.spent).toBe(400_000);
    expect(status.effectiveLimit).toBe(1_000_000);
    expect(status.remaining).toBe(600_000);
    expect(status.ratio).toBeCloseTo(0.4, 5);
  });

  it("reports a negative remaining when over budget", () => {
    const status = budgetStatus(
      budget(),
      category(),
      [tx("2026-08-01", 1_200_000)],
      "2026-08",
      "2026-08-31",
    );
    expect(status.remaining).toBe(-200_000);
    expect(status.ratio).toBeGreaterThan(1);
  });

  it("projects from the run rate for the month in progress", () => {
    // ₴2 000 over the first 10 days of a 31-day month projects to ₴6 200.
    const status = budgetStatus(
      budget(),
      category(),
      [tx("2026-08-05", 200_000)],
      "2026-08",
      "2026-08-10",
    );
    expect(status.projected).toBe(620_000);
  });

  it("does not project for a past month, where the actual is the answer", () => {
    const status = budgetStatus(
      budget(),
      category(),
      [tx("2026-07-05", 200_000)],
      "2026-07",
      "2026-08-10",
    );
    expect(status.projected).toBeNull();
  });

  it("handles February's length correctly when projecting", () => {
    // 2028 is a leap year: 29 days. ₴1 000 over 10 days projects to ₴2 900.
    const status = budgetStatus(
      budget(),
      category(),
      [tx("2028-02-05", 100_000)],
      "2028-02",
      "2028-02-10",
    );
    expect(status.projected).toBe(290_000);
  });
});

describe("rollover", () => {
  it("carries unspent budget forward", () => {
    const rolling = budget({ rollover: 1, period_month: null });
    const rows = [tx("2026-06-01", 400_000), tx("2026-07-01", 600_000)];
    // June left ₴6 000 unspent, July left ₴4 000 — ₴10 000 carried into August.
    expect(rolloverCredit(rolling, rows, "2026-08")).toBe(1_000_000);
  });

  it("carries overspend forward as a deficit", () => {
    // Carrying only surplus would let the limit drift upward forever.
    const rolling = budget({ rollover: 1 });
    const rows = [tx("2026-07-01", 1_500_000)];
    expect(rolloverCredit(rolling, rows, "2026-08")).toBe(-500_000);
  });

  it("carries nothing when rollover is off", () => {
    expect(rolloverCredit(budget({ rollover: 0 }), [tx("2026-07-01", 100)], "2026-08")).toBe(0);
  });

  it("carries nothing into the first month, or backwards", () => {
    const rolling = budget({ rollover: 1 });
    const rows = [tx("2026-08-01", 100_000)];
    expect(rolloverCredit(rolling, rows, "2026-08")).toBe(0);
    expect(rolloverCredit(rolling, rows, "2026-07")).toBe(0);
  });

  it("does not walk unbounded for a long-standing budget", () => {
    const rolling = budget({ rollover: 1 });
    const rows = [tx("2000-01-01", 0)];
    // Bounded at 36 months, so this returns rather than looping for two decades.
    expect(Number.isFinite(rolloverCredit(rolling, rows, "2026-08"))).toBe(true);
  });

  it("applies the carried credit to the effective limit", () => {
    const rolling = budget({ rollover: 1 });
    const rows = [tx("2026-07-01", 400_000), tx("2026-08-01", 300_000)];
    const status = budgetStatus(rolling, category(), rows, "2026-08", "2026-08-31");
    // ₴6 000 unspent in July, so August's effective limit is ₴16 000.
    expect(status.effectiveLimit).toBe(1_600_000);
    expect(status.remaining).toBe(1_300_000);
  });

  it("leaves a prior month's figures untouched when a later month changes", () => {
    // Rollover is walked forward from the start rather than stored, so editing a later month
    // cannot corrupt an earlier one.
    const rolling = budget({ rollover: 1 });
    const before = budgetStatus(rolling, category(), [tx("2026-07-01", 400_000)], "2026-07", "2026-08-31");
    const after = budgetStatus(
      rolling,
      category(),
      [tx("2026-07-01", 400_000), tx("2026-08-01", 999_999)],
      "2026-07",
      "2026-08-31",
    );
    expect(after.spent).toBe(before.spent);
    expect(after.effectiveLimit).toBe(before.effectiveLimit);
  });
});

describe("budgetStatuses", () => {
  it("returns only budgeted categories, worst-off first", () => {
    const categories = [category("cat_groceries", "Groceries"), category("cat_travel", "Travel")];
    const budgets = [
      budget({ id: "b1", category_id: "cat_groceries", amount_minor: 1_000_000 }),
      budget({ id: "b2", category_id: "cat_travel", amount_minor: 1_000_000 }),
    ];
    const rows = [tx("2026-08-01", 200_000, "cat_groceries"), tx("2026-08-01", 900_000, "cat_travel")];

    const statuses = budgetStatuses(budgets, categories, rows, "2026-08", "2026-08-31");
    expect(statuses.map((s) => s.category.name)).toEqual(["Travel", "Groceries"]);
  });

  it("omits categories with no budget", () => {
    const categories = [category("cat_groceries"), category("cat_travel", "Travel")];
    const statuses = budgetStatuses([budget()], categories, [], "2026-08", "2026-08-31");
    expect(statuses).toHaveLength(1);
  });
});
