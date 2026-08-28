import type { Currency } from "@shared/currency";
import type { Minor } from "@shared/money";
import { minorToMajor, signedMinor } from "@shared/money";
import type { Account, Category, Member, Transaction } from "@shared/schema";
import { accountDelta } from "@shared/money";
import { addMonths, monthOf } from "./format";

/**
 * The report engine: pure functions over the local rows.
 *
 * Nothing here touches the network or the database, which is why reports work in airplane
 * mode and why all of this is straightforward to test against fixtures.
 *
 * Two rules run through every report:
 *
 *  1. **Transfers never count as income or expense.** Money moving between the household's
 *     own accounts is not spending. Counting it is the single most common way a budget report
 *     ends up overstating a month, so `signedMinor` returns 0 for transfers and every
 *     aggregate here relies on that.
 *
 *  2. **Historical figures use each transaction's own snapshotted rate** (`base_amount_minor`),
 *     never today's rate. Otherwise last year's totals would change every morning.
 */

export type Period = "month" | "year";

export function periodOf(iso: string, period: Period): string {
  return period === "month" ? monthOf(iso) : iso.slice(0, 4);
}

/** Every period between two dates inclusive, so a matrix has no missing columns. */
export function periodRange(fromIso: string, toIso: string, period: Period): string[] {
  const out: string[] = [];
  if (period === "year") {
    for (let year = Number(fromIso.slice(0, 4)); year <= Number(toIso.slice(0, 4)); year++) {
      out.push(String(year));
    }
    return out;
  }
  let cursor = monthOf(fromIso);
  const end = monthOf(toIso);
  // Guard against an inverted range producing an unbounded loop.
  let guard = 0;
  while (cursor <= end && guard++ < 1200) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/* ------------------------------------------------------------------ category x period */

export interface MatrixCell {
  categoryId: string;
  period: string;
  total: Minor;
}

export interface CategoryMatrix {
  periods: string[];
  /** Only categories with activity, ordered by total descending — like the Saldo export. */
  rows: {
    category: Category;
    byPeriod: Map<string, Minor>;
    total: Minor;
  }[];
  totalsByPeriod: Map<string, Minor>;
  grandTotal: Minor;
}

/**
 * The report already in daily use: categories down, periods across, totals both ways.
 *
 * This is the one whose output is diffed against the real Saldo CSV — if these numbers do not
 * reproduce that file to the hryvnia after import, the importer is wrong.
 */
export function categoryMatrix(
  transactions: Transaction[],
  categories: Category[],
  kind: "expense" | "income",
  period: Period,
  fromIso: string,
  toIso: string,
): CategoryMatrix {
  const periods = periodRange(fromIso, toIso, period);
  const periodSet = new Set(periods);
  const byCategory = new Map<string, Map<string, Minor>>();
  const totalsByPeriod = new Map<string, Minor>();

  for (const tx of transactions) {
    if (tx.kind !== kind) continue; // excludes transfers by construction
    if (!tx.category_id) continue;
    if (tx.occurred_on < fromIso || tx.occurred_on > toIso) continue;

    const bucket = periodOf(tx.occurred_on, period);
    if (!periodSet.has(bucket)) continue;

    // Magnitudes, not signed values: an expense report shows what was spent, and a column of
    // negative numbers is harder to read than a column of positive ones.
    const amount = tx.base_amount_minor;

    const row = byCategory.get(tx.category_id) ?? new Map<string, Minor>();
    row.set(bucket, (row.get(bucket) ?? 0) + amount);
    byCategory.set(tx.category_id, row);

    totalsByPeriod.set(bucket, (totalsByPeriod.get(bucket) ?? 0) + amount);
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const rows = [...byCategory.entries()]
    .map(([categoryId, byPeriod]) => ({
      category:
        categoryById.get(categoryId) ??
        ({
          id: categoryId,
          name: "—",
          kind,
          icon: "❓",
          color: "#6E6E76",
        } as Category),
      byPeriod,
      total: [...byPeriod.values()].reduce((sum, value) => sum + value, 0),
    }))
    .sort((a, b) => b.total - a.total || a.category.name.localeCompare(b.category.name));

  return {
    periods,
    rows,
    totalsByPeriod,
    grandTotal: rows.reduce((sum, row) => sum + row.total, 0),
  };
}

/* ---------------------------------------------------------------------- month overview */

export interface MonthOverview {
  month: string;
  income: Minor;
  expenses: Minor;
  net: Minor;
  byCategory: {
    category: Category;
    total: Minor;
    share: number;
    /** Change against the same category last month, as a ratio. Null when there is no base. */
    changeRatio: number | null;
  }[];
}

export function monthOverview(
  transactions: Transaction[],
  categories: Category[],
  month: string,
): MonthOverview {
  const previous = addMonths(month, -1);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  let income = 0;
  let expenses = 0;
  const current = new Map<string, Minor>();
  const prior = new Map<string, Minor>();

  for (const tx of transactions) {
    const bucket = monthOf(tx.occurred_on);
    if (bucket !== month && bucket !== previous) continue;

    const signed = signedMinor(tx.kind, tx.base_amount_minor);
    if (signed === 0) continue; // transfer

    const target = bucket === month ? current : prior;
    if (tx.category_id) {
      target.set(tx.category_id, (target.get(tx.category_id) ?? 0) + tx.base_amount_minor);
    }

    if (bucket === month) {
      if (signed > 0) income += signed;
      else expenses += -signed;
    }
  }

  const byCategory = [...current.entries()]
    .map(([categoryId, total]) => {
      const base = prior.get(categoryId);
      return {
        category:
          categoryById.get(categoryId) ??
          ({ id: categoryId, name: "—", icon: "❓", color: "#6E6E76" } as Category),
        total,
        share: expenses > 0 ? total / expenses : 0,
        changeRatio: base && base > 0 ? (total - base) / base : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  return { month, income, expenses, net: income - expenses, byCategory };
}

/* ------------------------------------------------------------------------- net worth */

export interface NetWorthPoint {
  period: string;
  /** Per-currency native totals, so a UAH swing is not confused with a EUR one. */
  byCurrency: Map<string, Minor>;
  /** Every currency added together, in the household's base currency. */
  total: Minor;
  /** Currencies held but not converted, because no rate was available. Empty in the normal case. */
  missing: string[];
}

/**
 * Account balances at the end of each period, converted into one currency.
 *
 * Cumulative: each point carries every movement up to that date, plus opening balances. That
 * makes a single pass over date-sorted transactions sufficient.
 *
 * **The total is every currency, converted — not the base-currency accounts alone.** It used to be
 * `byCurrency.get(base)`, which silently dropped every euro and dollar account from the
 * household's net worth: a household keeping half its savings in euro saw half its money.
 *
 * A *balance* cannot use the per-transaction snapshot rate the rest of this file relies on. It is a
 * stock, not a flow — the sum of an opening balance and every movement since, and an opening
 * balance was never a transaction and carries no rate. So the caller passes a rate map, and the
 * app passes today's rates, the same ones the home screen totals with. One rate across every point
 * also means the line's shape is balance movement rather than currency movement.
 *
 * A currency with no rate is named in `missing` rather than being quietly counted as base — the
 * failure that would otherwise read as "our savings fell by a third overnight".
 */
export function netWorthOverTime(
  transactions: Transaction[],
  accounts: Account[],
  periods: string[],
  period: Period,
  base: Currency,
  rates: Map<string, number> = new Map(),
): NetWorthPoint[] {
  const included = accounts.filter((a) => a.exclude_from_totals === 0);
  const running = new Map<string, Minor>();
  for (const account of included) running.set(account.id, account.opening_balance_minor);

  const sorted = [...transactions].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
  const currencyOf = new Map(included.map((a) => [a.id, a.currency]));

  const points: NetWorthPoint[] = [];
  let index = 0;

  for (const bucket of periods) {
    while (index < sorted.length && periodOf(sorted[index]!.occurred_on, period) <= bucket) {
      const tx = sorted[index]!;
      for (const id of [tx.account_id, tx.to_account_id]) {
        if (!id || !running.has(id)) continue;
        running.set(
          id,
          (running.get(id) ?? 0) +
            accountDelta(
              {
                kind: tx.kind,
                accountId: tx.account_id,
                amountMinor: tx.amount_minor,
                toAccountId: tx.to_account_id ?? null,
                toAmountMinor: tx.to_amount_minor ?? null,
              },
              id,
            ),
        );
      }
      index++;
    }

    const byCurrency = new Map<string, Minor>();
    for (const [accountId, amount] of running) {
      const currency = currencyOf.get(accountId) ?? base;
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
    }

    let total = 0;
    const missing: string[] = [];
    for (const [currency, amount] of byCurrency) {
      if (currency === base) {
        total += amount;
        continue;
      }
      const rate = rates.get(currency);
      if (!rate) {
        // Not silently at 1:1. An unconverted euro balance added as hryvnia is a wrong number
        // that looks like a right one.
        if (amount !== 0) missing.push(currency);
        continue;
      }
      const converted = amount * rate;
      total += Math.sign(converted) * Math.round(Math.abs(converted));
    }

    points.push({ period: bucket, byCurrency, total, missing });
  }

  return points;
}

/* ---------------------------------------------------------------------------- trend */

export interface TrendPoint {
  period: string;
  total: Minor;
}

export function categoryTrend(
  transactions: Transaction[],
  categoryId: string,
  periods: string[],
  period: Period,
): TrendPoint[] {
  const totals = new Map<string, Minor>();
  for (const tx of transactions) {
    if (tx.category_id !== categoryId) continue;
    const bucket = periodOf(tx.occurred_on, period);
    totals.set(bucket, (totals.get(bucket) ?? 0) + tx.base_amount_minor);
  }
  return periods.map((bucket) => ({ period: bucket, total: totals.get(bucket) ?? 0 }));
}

/**
 * Income and expense per period, for the cashflow chart.
 *
 * The same arithmetic `monthOverview` does, over a series of periods rather than one: signed by
 * kind so transfers fall out at zero, and in the household's base currency, which is the only unit
 * several accounts in several currencies can be added in.
 *
 * Expenses come back positive. They are drawn below a baseline, and a value that is already
 * negative would have to be un-negated to draw it — one sign flip too many for a chart.
 */
export interface CashflowPoint {
  period: string;
  income: Minor;
  expenses: Minor;
  net: Minor;
}

export function cashflowOverTime(
  transactions: Transaction[],
  periods: string[],
  period: Period,
): CashflowPoint[] {
  const income = new Map<string, Minor>();
  const expenses = new Map<string, Minor>();

  for (const tx of transactions) {
    const signed = signedMinor(tx.kind, tx.base_amount_minor);
    if (signed === 0) continue; // transfer: household money moving, not earned or spent
    const bucket = periodOf(tx.occurred_on, period);
    const target = signed > 0 ? income : expenses;
    target.set(bucket, (target.get(bucket) ?? 0) + Math.abs(signed));
  }

  return periods.map((bucket) => {
    const inflow = income.get(bucket) ?? 0;
    const outflow = expenses.get(bucket) ?? 0;
    return { period: bucket, income: inflow, expenses: outflow, net: inflow - outflow };
  });
}

/* -------------------------------------------------------------------------- cashflow */

export interface CashflowRow {
  account: Account;
  inflow: Minor;
  outflow: Minor;
  net: Minor;
}

export function cashflowByAccount(
  transactions: Transaction[],
  accounts: Account[],
  fromIso: string,
  toIso: string,
): CashflowRow[] {
  const inflow = new Map<string, Minor>();
  const outflow = new Map<string, Minor>();

  for (const tx of transactions) {
    if (tx.occurred_on < fromIso || tx.occurred_on > toIso) continue;

    for (const id of [tx.account_id, tx.to_account_id]) {
      if (!id) continue;
      const delta = accountDelta(
        {
          kind: tx.kind,
          accountId: tx.account_id,
          amountMinor: tx.amount_minor,
          toAccountId: tx.to_account_id ?? null,
          toAmountMinor: tx.to_amount_minor ?? null,
        },
        id,
      );
      if (delta > 0) inflow.set(id, (inflow.get(id) ?? 0) + delta);
      else if (delta < 0) outflow.set(id, (outflow.get(id) ?? 0) - delta);
    }
  }

  return accounts
    .map((account) => {
      const inflowAmount = inflow.get(account.id) ?? 0;
      const outflowAmount = outflow.get(account.id) ?? 0;
      return {
        account,
        inflow: inflowAmount,
        outflow: outflowAmount,
        net: inflowAmount - outflowAmount,
      };
    })
    .filter((row) => row.inflow !== 0 || row.outflow !== 0);
}

/* ------------------------------------------------------------------------- by member */

export interface MemberSpendRow {
  member: Member;
  expenses: Minor;
  income: Minor;
  count: number;
}

export function spendByMember(
  transactions: Transaction[],
  members: Member[],
  fromIso: string,
  toIso: string,
): MemberSpendRow[] {
  const rows = new Map<string, { expenses: Minor; income: Minor; count: number }>();

  for (const tx of transactions) {
    if (tx.occurred_on < fromIso || tx.occurred_on > toIso) continue;
    const signed = signedMinor(tx.kind, tx.base_amount_minor);
    if (signed === 0) continue;

    // The per-member report answers "who spends", and editing is not spending.
    const id = tx.created_by ?? tx.updated_by ?? "";
    const row = rows.get(id) ?? { expenses: 0, income: 0, count: 0 };
    if (signed < 0) row.expenses += -signed;
    else row.income += signed;
    row.count++;
    rows.set(id, row);
  }

  return members
    .map((member) => ({
      member,
      ...(rows.get(member.id) ?? { expenses: 0, income: 0, count: 0 }),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.expenses - a.expenses);
}

/* ---------------------------------------------------------------------------- export */

/**
 * The matrix as TSV, for the desktop copy-to-clipboard button. TSV pastes into a spreadsheet as real
 * columns, where CSV often lands in one cell.
 *
 * Scaled through `minorToMajor` rather than divided by 100. Every figure here is in the base
 * currency, and a household reporting in yen would otherwise have exported a hundredth of every
 * amount — into a spreadsheet, where nothing would question it.
 */
export function matrixToTsv(
  matrix: CategoryMatrix,
  totalLabel: string,
  base: Currency,
): string {
  const header = ["", ...matrix.periods, totalLabel].join("\t");
  const lines = [header];

  for (const row of matrix.rows) {
    lines.push(
      [
        row.category.name,
        ...matrix.periods.map((period) => String(minorToMajor(row.byPeriod.get(period) ?? 0, base))),
        String(minorToMajor(row.total, base)),
      ].join("\t"),
    );
  }

  lines.push(
    [
      totalLabel,
      ...matrix.periods.map((period) =>
        String(minorToMajor(matrix.totalsByPeriod.get(period) ?? 0, base)),
      ),
      String(minorToMajor(matrix.grandTotal, base)),
    ].join("\t"),
  );

  return lines.join("\n");
}
