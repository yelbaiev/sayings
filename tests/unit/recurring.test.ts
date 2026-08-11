import type { Recurring } from "@shared/schema";
import { describe, expect, it } from "vitest";
import {
  catchUp,
  dueRecurring,
  monthlyEquivalent,
  monthlyTotal,
  nextOccurrence,
} from "~/lib/recurring";

describe("nextOccurrence — monthly", () => {
  it("advances to the same day next month", () => {
    expect(nextOccurrence("2026-08-05", "monthly", 5)).toBe("2026-09-05");
  });

  it("crosses a year boundary", () => {
    expect(nextOccurrence("2026-12-10", "monthly", 10)).toBe("2027-01-10");
  });

  it("clamps a 31st to the last day of a shorter month", () => {
    expect(nextOccurrence("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(nextOccurrence("2026-03-31", "monthly", 31)).toBe("2026-04-30");
  });

  it("returns to the intended day after a clamped month, rather than drifting earlier", () => {
    // The whole reason dayOf is carried separately. Reading the day back off the previous
    // occurrence would pin rent to the 28th forever after one February.
    const feb = nextOccurrence("2026-01-31", "monthly", 31);
    expect(feb).toBe("2026-02-28");
    expect(nextOccurrence(feb, "monthly", 31)).toBe("2026-03-31");
  });

  it("handles February in a leap year", () => {
    expect(nextOccurrence("2028-01-31", "monthly", 31)).toBe("2028-02-29");
  });

  it("handles a 30th across February", () => {
    expect(nextOccurrence("2026-01-30", "monthly", 30)).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", "monthly", 30)).toBe("2026-03-30");
  });
});

describe("nextOccurrence — weekly and yearly", () => {
  it("adds seven days", () => {
    expect(nextOccurrence("2026-08-05", "weekly", 3)).toBe("2026-08-12");
    expect(nextOccurrence("2026-08-28", "weekly", 3)).toBe("2026-09-04");
  });

  it("advances a year, keeping the anniversary", () => {
    expect(nextOccurrence("2026-08-05", "yearly", 5)).toBe("2027-08-05");
  });

  it("moves 29 February to the 28th in a non-leap year without losing the anniversary", () => {
    expect(nextOccurrence("2028-02-29", "yearly", 29)).toBe("2029-02-28");
    // And back to the 29th at the next leap year.
    expect(nextOccurrence("2031-02-28", "yearly", 29)).toBe("2032-02-29");
  });
});

describe("catchUp", () => {
  it("skips past every missed period in one step", () => {
    // A template left alone for three months should prompt once, not three times.
    const result = catchUp("2026-05-01", "monthly", 1, "2026-08-05");
    expect(result.next).toBe("2026-09-01");
    expect(result.skipped).toBe(4);
  });

  it("advances exactly once when today is the due date", () => {
    const result = catchUp("2026-08-05", "monthly", 5, "2026-08-05");
    expect(result.next).toBe("2026-09-05");
    expect(result.skipped).toBe(1);
  });

  it("leaves a future date alone", () => {
    const result = catchUp("2026-09-01", "monthly", 1, "2026-08-05");
    expect(result.next).toBe("2026-09-01");
    expect(result.skipped).toBe(0);
  });

  it("terminates on a very stale schedule instead of looping", () => {
    const result = catchUp("1990-01-01", "weekly", 1, "2026-08-05", 50);
    expect(result.skipped).toBe(50);
    expect(result.next > "1990-01-01").toBe(true);
  });
});

function item(overrides: Partial<Recurring> & { next_on: string }): Recurring {
  return {
    id: crypto.randomUUID(),
    household_id: "hh_default",
    label: "Аренда",
    template: "{}",
    cadence: "monthly",
    day_of: 1,
    active: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
    ...overrides,
  } as Recurring;
}

describe("dueRecurring", () => {
  it("returns schedules whose date has arrived, oldest first", () => {
    const due = dueRecurring(
      [item({ next_on: "2026-08-05" }), item({ next_on: "2026-07-01" }), item({ next_on: "2026-09-01" })],
      "2026-08-05",
    );
    expect(due.map((i) => i.next_on)).toEqual(["2026-07-01", "2026-08-05"]);
  });

  it("ignores paused and deleted schedules", () => {
    const due = dueRecurring(
      [item({ next_on: "2026-01-01", active: 0 }), item({ next_on: "2026-01-01", deleted: 1 })],
      "2026-08-05",
    );
    expect(due).toHaveLength(0);
  });
});

describe("monthlyEquivalent", () => {
  it("leaves a monthly amount alone", () => {
    expect(monthlyEquivalent(2_500_000, "monthly")).toBe(2_500_000);
  });

  it("spreads a yearly amount over twelve months", () => {
    expect(monthlyEquivalent(120_000, "yearly")).toBe(10_000);
  });

  it("scales weekly by 52/12, not by 4", () => {
    // ₴100/week is ₴433.33/month, not ₴400. Using 4 would understate fixed costs by ~8%.
    expect(monthlyEquivalent(10_000, "weekly")).toBe(43_333);
  });

  it("rounds to whole minor units so totals never carry a fraction of a kopeck", () => {
    expect(Number.isInteger(monthlyEquivalent(99_999, "yearly"))).toBe(true);
    expect(Number.isInteger(monthlyEquivalent(99_999, "weekly"))).toBe(true);
  });
});

describe("monthlyTotal", () => {
  // ₴40 to the euro, ₴38 to the dollar — round numbers so the arithmetic is checkable by eye.
  const rates: Record<string, number> = { EUR: 40, USD: 38 };
  const convert = (minor: number, currency: string) =>
    currency === "UAH" ? minor : (rates[currency] ?? 0) * minor || null;

  it("sums one currency across mixed cadences", () => {
    const total = monthlyTotal(
      [
        { amount_minor: 2_500_000, currency: "UAH", cadence: "monthly" },
        { amount_minor: 120_000, currency: "UAH", cadence: "yearly" },
      ],
      convert,
      "UAH",
    );
    expect(total.byCurrency).toEqual([["UAH", 2_510_000]]);
    expect(total.grand).toBe(2_510_000);
    expect(total.grandUsable).toBe(true);
  });

  it("keeps a subtotal per currency and converts the grand total", () => {
    const total = monthlyTotal(
      [
        { amount_minor: 2_500_000, currency: "UAH", cadence: "monthly" },
        { amount_minor: 1_000, currency: "EUR", cadence: "monthly" },
        { amount_minor: 1_200, currency: "USD", cadence: "yearly" },
      ],
      convert,
      "UAH",
    );
    // €10/mo → ₴400. $12/yr → $1/mo → ₴38.
    expect(total.byCurrency).toEqual([
      ["UAH", 2_500_000],
      ["EUR", 1_000],
      ["USD", 100],
    ]);
    expect(total.grand).toBe(2_500_000 + 40_000 + 3_800);
    expect(total.grandUsable).toBe(true);
  });

  it("puts the base currency first regardless of input order", () => {
    const total = monthlyTotal(
      [
        { amount_minor: 500, currency: "USD", cadence: "monthly" },
        { amount_minor: 700, currency: "UAH", cadence: "monthly" },
      ],
      convert,
      "UAH",
    );
    expect(total.byCurrency[0]?.[0]).toBe("UAH");
  });

  it("refuses the grand total when a rate is missing", () => {
    // Understating fixed commitments is the one direction this figure must not err in.
    const total = monthlyTotal(
      [
        { amount_minor: 2_500_000, currency: "UAH", cadence: "monthly" },
        { amount_minor: 1_000, currency: "EUR", cadence: "monthly" },
      ],
      (minor, currency) => (currency === "UAH" ? minor : null),
      "UAH",
    );
    expect(total.grandUsable).toBe(false);
    expect(total.byCurrency).toHaveLength(2);
  });

  it("is empty, not unusable, with no schedules", () => {
    const total = monthlyTotal([], convert, "UAH");
    expect(total.byCurrency).toEqual([]);
    expect(total.grand).toBe(0);
    expect(total.grandUsable).toBe(false);
  });
});
