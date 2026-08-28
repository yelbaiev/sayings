import type { Account, Category, Member, Transaction } from "@shared/schema";
import { describe, expect, it } from "vitest";
import {
  cashflowByAccount,
  cashflowOverTime,
  categoryMatrix,
  matrixToTsv,
  monthOverview,
  netWorthOverTime,
  periodOf,
  periodRange,
  spendByMember,
} from "~/lib/report-engine";

function category(id: string, name: string, kind: "expense" | "income" = "expense"): Category {
  return {
    id,
    household_id: "hh_default",
    kind,
    name,
    icon: "🏷️",
    color: "#6E6E76",
    archived: 0,
    sort_order: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
  };
}

function account(id: string, currency: string, opening = 0): Account {
  return {
    id,
    household_id: "hh_default",
    name: id,
    type: "debit_card",
    currency: currency as Account["currency"],
    opening_balance_minor: opening,
    icon: "💳",
    color: "#3E63DD",
    exclude_from_totals: 0,
    archived: 0,
    sort_order: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
  };
}

function member(id: string, name: string): Member {
  return {
    id,
    household_id: "hh_default",
    email: `${id}@example.com`,
    display_name: name,
    avatar_color: "#3E63DD",
    locale: "en",
    role: "member",
    created_at: 1,
    rev: 1,
    updated_at: 1,
    deleted: 0,
  };
}

function tx(overrides: Partial<Transaction> & { occurred_on: string }): Transaction {
  const amount = overrides.amount_minor ?? 100_000;
  return {
    id: crypto.randomUUID(),
    household_id: "hh_default",
    kind: "expense",
    account_id: "mono",
    category_id: "cat_groceries",
    amount_minor: amount,
    currency: "UAH",
    base_amount_minor: overrides.base_amount_minor ?? amount,
    fx_rate: 1,
    fx_estimated: 0,
    rev: 1,
    updated_at: 1,
    deleted: 0,
    ...overrides,
  } as Transaction;
}

const CATEGORIES = [
  category("cat_groceries", "Groceries"),
  category("cat_travel", "Travel"),
  category("cat_salary", "Salary", "income"),
];

describe("periodRange", () => {
  it("produces every month inclusive, so a matrix has no missing columns", () => {
    expect(periodRange("2026-06-15", "2026-09-02", "month")).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(periodRange("2025-11-01", "2026-02-01", "month")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("produces years", () => {
    expect(periodRange("2021-01-01", "2026-08-05", "year")).toEqual([
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
  });

  it("returns nothing for an inverted range rather than looping", () => {
    expect(periodRange("2026-09-01", "2026-06-01", "month")).toEqual([]);
  });

  it("buckets a date correctly", () => {
    expect(periodOf("2026-08-05", "month")).toBe("2026-08");
    expect(periodOf("2026-08-05", "year")).toBe("2026");
  });
});

describe("categoryMatrix", () => {
  const rows = [
    tx({ occurred_on: "2026-07-10", category_id: "cat_groceries", amount_minor: 50_000 }),
    tx({ occurred_on: "2026-08-01", category_id: "cat_groceries", amount_minor: 30_000 }),
    tx({ occurred_on: "2026-08-02", category_id: "cat_travel", amount_minor: 200_000 }),
    tx({ occurred_on: "2026-08-03", category_id: "cat_salary", kind: "income", amount_minor: 900_000 }),
  ];

  it("totals by category and period, ordered by size like the Saldo export", () => {
    const matrix = categoryMatrix(rows, CATEGORIES, "expense", "month", "2026-07-01", "2026-08-31");

    expect(matrix.periods).toEqual(["2026-07", "2026-08"]);
    expect(matrix.rows.map((r) => r.category.name)).toEqual(["Travel", "Groceries"]);
    expect(matrix.rows[1]!.byPeriod.get("2026-07")).toBe(50_000);
    expect(matrix.rows[1]!.byPeriod.get("2026-08")).toBe(30_000);
    expect(matrix.totalsByPeriod.get("2026-08")).toBe(230_000);
    expect(matrix.grandTotal).toBe(280_000);
  });

  it("keeps income out of an expense matrix", () => {
    const matrix = categoryMatrix(rows, CATEGORIES, "expense", "month", "2026-07-01", "2026-08-31");
    expect(matrix.rows.some((r) => r.category.name === "Salary")).toBe(false);
  });

  it("excludes transfers entirely", () => {
    // The single most common way a spending report ends up overstated: money moved between
    // your own accounts counted as expenditure.
    const withTransfer = [
      ...rows,
      tx({
        occurred_on: "2026-08-04",
        kind: "transfer",
        account_id: "mono",
        to_account_id: "cash",
        category_id: null,
        amount_minor: 500_000,
      }),
    ];
    const matrix = categoryMatrix(
      withTransfer,
      CATEGORIES,
      "expense",
      "month",
      "2026-07-01",
      "2026-08-31",
    );
    expect(matrix.grandTotal).toBe(280_000);
  });

  it("respects the date range", () => {
    const matrix = categoryMatrix(rows, CATEGORIES, "expense", "month", "2026-08-01", "2026-08-31");
    expect(matrix.grandTotal).toBe(230_000);
  });

  it("uses base amounts, so a multi-currency month is comparable", () => {
    const multi = [
      tx({ occurred_on: "2026-08-01", amount_minor: 10_000, currency: "EUR", base_amount_minor: 516_423, fx_rate: 51.6423 }),
      tx({ occurred_on: "2026-08-02", amount_minor: 10_000, currency: "USD", base_amount_minor: 447_876, fx_rate: 44.7876 }),
      tx({ occurred_on: "2026-08-03", amount_minor: 100_000, currency: "UAH" }),
    ];
    const matrix = categoryMatrix(multi, CATEGORIES, "expense", "month", "2026-08-01", "2026-08-31");
    // €100 + $100 + ₴1000 at those rates.
    expect(matrix.grandTotal).toBe(516_423 + 447_876 + 100_000);
  });
});

describe("monthOverview", () => {
  const rows = [
    tx({ occurred_on: "2026-08-01", category_id: "cat_groceries", amount_minor: 100_000 }),
    tx({ occurred_on: "2026-08-02", category_id: "cat_travel", amount_minor: 300_000 }),
    tx({ occurred_on: "2026-08-03", category_id: "cat_salary", kind: "income", amount_minor: 900_000 }),
    // Last month, for the comparison.
    tx({ occurred_on: "2026-07-05", category_id: "cat_groceries", amount_minor: 50_000 }),
  ];

  it("separates income from expenses and nets them", () => {
    const overview = monthOverview(rows, CATEGORIES, "2026-08");
    expect(overview.income).toBe(900_000);
    expect(overview.expenses).toBe(400_000);
    expect(overview.net).toBe(500_000);
  });

  it("computes each category's share of the month's spending", () => {
    const overview = monthOverview(rows, CATEGORIES, "2026-08");
    const travel = overview.byCategory.expense.find((r) => r.category.name === "Travel")!;
    expect(travel.share).toBeCloseTo(0.75, 5);
  });

  it("keeps each side to itself, and shares it against its own total", () => {
    /*
     * One list used to hold both, with every share taken against expenses — so a ₴9 000 salary in
     * a month of ₴4 000 of spending appeared among the spending categories at 225%. They are two
     * reports, and this is the split that makes them two.
     */
    const overview = monthOverview(rows, CATEGORIES, "2026-08");

    expect(overview.byCategory.expense.map((r) => r.category.name)).toEqual(["Travel", "Groceries"]);
    expect(overview.byCategory.income.map((r) => r.category.name)).toEqual(["Salary"]);
    // The one income category is all of the income, not twice the expenses.
    expect(overview.byCategory.income[0]!.share).toBeCloseTo(1, 5);
  });

  it("compares against the same category last month", () => {
    const overview = monthOverview(rows, CATEGORIES, "2026-08");
    const groceries = overview.byCategory.expense.find((r) => r.category.name === "Groceries")!;
    // ₴500 last month, ₴1000 this month.
    expect(groceries.changeRatio).toBeCloseTo(1, 5);
  });

  it("reports no change ratio when there is no base to compare against", () => {
    const overview = monthOverview(rows, CATEGORIES, "2026-08");
    const travel = overview.byCategory.expense.find((r) => r.category.name === "Travel")!;
    expect(travel.changeRatio).toBeNull();
  });

  it("excludes transfers from both sides", () => {
    const withTransfer = [
      ...rows,
      tx({
        occurred_on: "2026-08-05",
        kind: "transfer",
        to_account_id: "cash",
        category_id: null,
        amount_minor: 700_000,
      }),
    ];
    const overview = monthOverview(withTransfer, CATEGORIES, "2026-08");
    expect(overview.expenses).toBe(400_000);
    expect(overview.income).toBe(900_000);
  });
});

describe("netWorthOverTime", () => {
  const accounts = [account("mono", "UAH", 1_000_000), account("eur", "EUR", 50_000)];

  it("accumulates opening balances plus movements", () => {
    const rows = [
      tx({ occurred_on: "2026-07-15", account_id: "mono", amount_minor: 200_000 }),
      tx({ occurred_on: "2026-08-10", account_id: "mono", amount_minor: 100_000 }),
    ];
    const points = netWorthOverTime(rows, accounts, ["2026-07", "2026-08"], "month", "UAH");

    expect(points[0]!.byCurrency.get("UAH")).toBe(800_000);
    expect(points[1]!.byCurrency.get("UAH")).toBe(700_000); // cumulative, not per-period
    expect(points[1]!.byCurrency.get("EUR")).toBe(50_000);
  });

  it("nets a cross-currency transfer to zero overall while moving both legs", () => {
    // ₴50 000,00 out, €1 020,45 in. Both legs are stored, so neither balance depends on a rate.
    const rows = [
      tx({
        occurred_on: "2026-08-01",
        kind: "transfer",
        account_id: "mono",
        to_account_id: "eur",
        category_id: null,
        amount_minor: 5_000_000,
        to_amount_minor: 102_045,
        to_currency: "EUR",
      }),
    ];
    const points = netWorthOverTime(rows, accounts, ["2026-08"], "month", "UAH");
    expect(points[0]!.byCurrency.get("UAH")).toBe(1_000_000 - 5_000_000);
    expect(points[0]!.byCurrency.get("EUR")).toBe(50_000 + 102_045);
  });

  it("ignores accounts excluded from totals", () => {
    const withExcluded = [...accounts, { ...account("invest", "UAH", 9_000_000), exclude_from_totals: 1 as const }];
    const points = netWorthOverTime([], withExcluded, ["2026-08"], "month", "UAH");
    expect(points[0]!.byCurrency.get("UAH")).toBe(1_000_000);
  });

  it("counts every currency in the total, converted", () => {
    /*
     * The bug this replaces: the total was `byCurrency.get(base)`, so a household keeping half its
     * savings in euro saw half its money — the other half was computed, held in the map, and
     * dropped on the way out.
     */
    const rates = new Map([["EUR", 45]]);
    const points = netWorthOverTime([], accounts, ["2026-08"], "month", "UAH", rates);

    // ₴10 000,00 plus €500,00 at 45 = ₴22 500,00 more.
    expect(points[0]!.byCurrency.get("UAH")).toBe(1_000_000);
    expect(points[0]!.byCurrency.get("EUR")).toBe(50_000);
    expect(points[0]!.total).toBe(1_000_000 + 50_000 * 45);
    expect(points[0]!.missing).toEqual([]);
  });

  it("names a currency it cannot price rather than counting it as base", () => {
    // Adding an unconverted euro balance to hryvnia at 1:1 is a wrong number that looks right.
    const points = netWorthOverTime([], accounts, ["2026-08"], "month", "UAH", new Map());

    expect(points[0]!.total).toBe(1_000_000);
    expect(points[0]!.missing).toEqual(["EUR"]);
  });

  it("says nothing about a currency held at zero", () => {
    // An emptied euro card must not raise a warning about a rate nobody needs.
    const emptied = [account("mono", "UAH", 1_000_000), account("eur", "EUR", 0)];
    const points = netWorthOverTime([], emptied, ["2026-08"], "month", "UAH", new Map());
    expect(points[0]!.missing).toEqual([]);
  });

  it("rounds the converted figure half away from zero, like every other conversion here", () => {
    const odd = [account("eur", "EUR", 1_005)];
    const points = netWorthOverTime([], odd, ["2026-08"], "month", "UAH", new Map([["EUR", 1.5]]));
    expect(points[0]!.total).toBe(1_508);
  });
});

describe("cashflowByAccount", () => {
  it("splits inflow from outflow and shows a transfer on both sides", () => {
    const accounts = [account("mono", "UAH"), account("cash", "UAH")];
    const rows = [
      tx({ occurred_on: "2026-08-01", account_id: "mono", amount_minor: 100_000 }),
      tx({ occurred_on: "2026-08-02", account_id: "mono", kind: "income", amount_minor: 900_000, category_id: "cat_salary" }),
      tx({
        occurred_on: "2026-08-03",
        kind: "transfer",
        account_id: "mono",
        to_account_id: "cash",
        category_id: null,
        amount_minor: 200_000,
      }),
    ];

    const flows = cashflowByAccount(rows, accounts, "2026-08-01", "2026-08-31");
    const mono = flows.find((f) => f.account.id === "mono")!;
    const cash = flows.find((f) => f.account.id === "cash")!;

    expect(mono.inflow).toBe(900_000);
    expect(mono.outflow).toBe(300_000);
    expect(cash.inflow).toBe(200_000);
    expect(cash.outflow).toBe(0);
  });

  it("omits accounts with no movement in the range", () => {
    const accounts = [account("mono", "UAH"), account("dormant", "UAH")];
    const flows = cashflowByAccount(
      [tx({ occurred_on: "2026-08-01", account_id: "mono" })],
      accounts,
      "2026-08-01",
      "2026-08-31",
    );
    expect(flows.map((f) => f.account.id)).toEqual(["mono"]);
  });
});

describe("cashflowOverTime", () => {
  const periods = ["2026-01", "2026-02", "2026-03"];

  it("splits each period into what came in and what went out", () => {
    const points = cashflowOverTime(
      [
        tx({ occurred_on: "2026-01-10", kind: "income", amount_minor: 500_000 }),
        tx({ occurred_on: "2026-01-20", amount_minor: 120_000 }),
        tx({ occurred_on: "2026-01-25", amount_minor: 80_000 }),
        tx({ occurred_on: "2026-03-01", amount_minor: 60_000 }),
      ],
      periods,
      "month",
    );

    expect(points[0]).toEqual({
      period: "2026-01",
      income: 500_000,
      expenses: 200_000,
      net: 300_000,
    });
    // A month with nothing in it is a point at zero, not a gap: the chart draws a continuous
    // series and a missing period would silently close it up.
    expect(points[1]).toEqual({ period: "2026-02", income: 0, expenses: 0, net: 0 });
    expect(points[2]!.net).toBe(-60_000);
  });

  it("returns expenses as a positive magnitude", () => {
    // They are drawn below a baseline. A value already negative would have to be un-negated to
    // draw it, which is one sign flip more than a chart should carry.
    const [point] = cashflowOverTime(
      [tx({ occurred_on: "2026-01-05", amount_minor: 25_000 })],
      ["2026-01"],
      "month",
    );
    expect(point!.expenses).toBe(25_000);
    expect(point!.net).toBe(-25_000);
  });

  it("leaves transfers out entirely", () => {
    // Money moving between the household's own accounts is neither earned nor spent, and counting
    // it as either is the commonest way a cashflow chart overstates both sides at once.
    const points = cashflowOverTime(
      [
        tx({
          occurred_on: "2026-01-15",
          kind: "transfer",
          to_account_id: "privat",
          amount_minor: 300_000,
        }),
      ],
      ["2026-01"],
      "month",
    );
    expect(points[0]).toEqual({ period: "2026-01", income: 0, expenses: 0, net: 0 });
  });

  it("adds several currencies in the base figure each row carries", () => {
    // base_amount_minor, not amount_minor: a euro expense and a hryvnia one cannot be summed in
    // either of their own currencies.
    const points = cashflowOverTime(
      [
        tx({ occurred_on: "2026-02-02", amount_minor: 5_000, base_amount_minor: 220_000 }),
        tx({ occurred_on: "2026-02-03", amount_minor: 10_000, base_amount_minor: 10_000 }),
      ],
      ["2026-02"],
      "month",
    );
    expect(points[0]!.expenses).toBe(230_000);
  });
});

describe("spendByMember", () => {
  it("attributes spending to whoever entered it", () => {
    const members = [member("m1", "Me"), member("m2", "Wife")];
    const rows = [
      tx({ occurred_on: "2026-08-01", updated_by: "m1", amount_minor: 100_000 }),
      tx({ occurred_on: "2026-08-02", updated_by: "m2", amount_minor: 300_000 }),
      tx({ occurred_on: "2026-08-03", updated_by: "m2", kind: "income", amount_minor: 900_000, category_id: "cat_salary" }),
    ];

    const byMember = spendByMember(rows, members, "2026-08-01", "2026-08-31");
    expect(byMember[0]!.member.display_name).toBe("Wife"); // ordered by spend
    expect(byMember[0]!.expenses).toBe(300_000);
    expect(byMember[0]!.income).toBe(900_000);
    expect(byMember[1]!.expenses).toBe(100_000);
  });

  it("omits members with no activity in the range", () => {
    const members = [member("m1", "Me"), member("m2", "Wife")];
    const byMember = spendByMember(
      [tx({ occurred_on: "2026-08-01", updated_by: "m1" })],
      members,
      "2026-08-01",
      "2026-08-31",
    );
    expect(byMember).toHaveLength(1);
  });
});

describe("matrixToTsv", () => {
  it("emits a pasteable table in major units", () => {
    const rows = [tx({ occurred_on: "2026-08-01", amount_minor: 123_456 })];
    const matrix = categoryMatrix(rows, CATEGORIES, "expense", "month", "2026-08-01", "2026-08-31");
    const tsv = matrixToTsv(matrix, "Total", "UAH");

    const lines = tsv.split("\n");
    expect(lines[0]).toBe("\t2026-08\tTotal");
    expect(lines[1]).toBe("Groceries\t1234.56\t1234.56");
    expect(lines[2]).toBe("Total\t1234.56\t1234.56");
  });
});
