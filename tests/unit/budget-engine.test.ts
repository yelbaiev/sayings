import type { Budget } from "@shared/schema";
import { describe, expect, it } from "vitest";
import { budgetFor, limitInBase } from "~/lib/budget-engine";

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

describe("limitInBase", () => {
  // €1 = ₴45, with no rate for USD — the shape of converter the app passes.
  const toBase = (minor: number, currency: string) =>
    currency === "UAH" ? minor : currency === "EUR" ? minor * 45 : null;

  it("converts a limit set in another currency", () => {
    expect(limitInBase(budget({ currency: "EUR", amount_minor: 30_000 }), toBase)).toBe(1_350_000);
  });

  it("returns null when there is no rate, rather than reading the figure as base", () => {
    expect(limitInBase(budget({ currency: "USD", amount_minor: 30_000 }), toBase)).toBeNull();
  });

  it("takes the stored amount as base when no converter is given", () => {
    expect(limitInBase(budget({ amount_minor: 1_000_000 }))).toBe(1_000_000);
  });
});
