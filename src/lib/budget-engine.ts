import type { Minor } from "@shared/money";
import type { Budget, Category, Transaction } from "@shared/schema";
import { addMonths, dayOfMonth, monthOf } from "./format";

/**
 * Budget calculations, as pure functions.
 *
 * The only genuinely tricky part is rollover: unspent budget carries forward, which means a
 * month's effective limit depends on every earlier month. That is computed by walking forward
 * from the budget's start rather than storing a running figure, so editing a past month
 * cannot corrupt the ones after it.
 */

/**
 * Converts a limit to the base currency at today's rate, or null when no rate is held.
 *
 * A limit can be set in a currency other than the base — €300 for travel in a hryvnia household —
 * and is stored as typed. It is converted when read, at today's rate, so it keeps meaning €300 while
 * the hryvnia moves; spending stays at each transaction's own snapshotted rate, as everywhere else.
 * Omitted, every budget is taken to be in the base already, which is what older rows are.
 */
export type ToBase = (minor: Minor, currency: string) => Minor | null;

/** A budget's monthly limit in the base currency, or null when it cannot be converted. */
export function limitInBase(budget: Budget, toBase?: ToBase): Minor | null {
  return toBase ? toBase(budget.amount_minor, budget.currency) : budget.amount_minor;
}

export interface BudgetStatus {
  budget: Budget;
  category: Category;
  month: string;
  /** The month's own limit in the base currency, before any rollover. */
  baseLimit: Minor;
  /** Limit including carried-forward surplus. */
  effectiveLimit: Minor;
  spent: Minor;
  remaining: Minor;
  /** Spent divided by the effective limit. Above 1 means over budget. */
  ratio: number;
  /** Spend projected to month end from the run rate so far. Null for a past month. */
  projected: Minor | null;
}

/** Days in a month, from a 'YYYY-MM' string. */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The budget applying to a category in a month.
 *
 * A month-specific budget wins over the recurring one, so a one-off December can be set
 * without disturbing the standing limit.
 */
export function budgetFor(
  budgets: Budget[],
  categoryId: string,
  month: string,
): Budget | undefined {
  const forCategory = budgets.filter((b) => b.category_id === categoryId && b.deleted === 0);
  return (
    forCategory.find((b) => b.period_month === month) ??
    forCategory.find((b) => !b.period_month)
  );
}

/** Spend for one category in one month, in base currency. */
export function spentInMonth(
  transactions: Transaction[],
  categoryId: string,
  month: string,
): Minor {
  let total = 0;
  for (const tx of transactions) {
    // Transfers carry no category, so they cannot land here — but the guard documents that
    // moving money between accounts is not spending.
    if (tx.kind === "transfer") continue;
    if (tx.category_id !== categoryId) continue;
    if (monthOf(tx.occurred_on) !== month) continue;
    total += tx.base_amount_minor;
  }
  return total;
}

/**
 * Carried-forward surplus for a rollover budget.
 *
 * Walks forward from the earliest month the budget could apply to, accumulating what was left
 * over. Overspend carries as a deficit too — otherwise rollover would only ever be generous
 * and the limit would drift upward forever.
 *
 * Bounded to 36 months, so a budget left in place for years cannot make this walk unbounded.
 */
export function rolloverCredit(
  budget: Budget,
  transactions: Transaction[],
  month: string,
  maxMonths = 36,
  /** The monthly limit in base currency; defaults to the stored amount. */
  limit: Minor = budget.amount_minor,
): Minor {
  if (!budget.rollover) return 0;

  // A month-specific budget has no history to carry.
  const earliest = budget.period_month ?? earliestMonth(transactions, budget.category_id);
  if (!earliest || earliest >= month) return 0;
  /*
   * The most recent `maxMonths`, not the first. The walk used to start at the earliest month and
   * stop after the cap, so with a longer history (the Saldo import goes back years) it counted the
   * oldest three years and none of the months just before the one being read.
   */
  const windowStart = addMonths(month, -maxMonths);
  const start = earliest > windowStart ? earliest : windowStart;

  let credit = 0;
  let cursor = start;
  let steps = 0;

  while (cursor < month && steps++ < maxMonths) {
    const spent = spentInMonth(transactions, budget.category_id, cursor);
    // Underspend adds, overspend subtracts. Carrying only the surplus would let the limit
    // drift upward forever and stop meaning anything.
    credit += limit - spent;
    cursor = addMonths(cursor, 1);
  }

  return credit;
}

function earliestMonth(transactions: Transaction[], categoryId: string): string | null {
  let earliest: string | null = null;
  for (const tx of transactions) {
    if (tx.category_id !== categoryId) continue;
    const month = monthOf(tx.occurred_on);
    if (!earliest || month < earliest) earliest = month;
  }
  return earliest;
}

export function budgetStatus(
  budget: Budget,
  category: Category,
  transactions: Transaction[],
  month: string,
  today: string,
  /** The monthly limit in base currency — see `limitInBase`. Defaults to the stored amount. */
  limit: Minor = budget.amount_minor,
): BudgetStatus {
  const spent = spentInMonth(transactions, budget.category_id, month);
  const carried = rolloverCredit(budget, transactions, month, 36, limit);
  const effectiveLimit = limit + carried;

  // Only project for the month in progress: a finished month's actual is the answer, and a
  // future month has no run rate to extrapolate from.
  let projected: Minor | null = null;
  if (monthOf(today) === month) {
    const elapsed = dayOfMonth(today);
    const total = daysInMonth(month);
    projected = elapsed > 0 ? Math.round((spent / elapsed) * total) : 0;
  }

  return {
    budget,
    category,
    month,
    baseLimit: limit,
    effectiveLimit,
    spent,
    remaining: effectiveLimit - spent,
    ratio: effectiveLimit > 0 ? spent / effectiveLimit : 0,
    projected,
  };
}

/** Every budget applying in a month, worst-off first. */
export function budgetStatuses(
  budgets: Budget[],
  categories: Category[],
  transactions: Transaction[],
  month: string,
  today: string,
  toBase?: ToBase,
): BudgetStatus[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: BudgetStatus[] = [];

  for (const category of categories) {
    if (seen.has(category.id)) continue;
    const budget = budgetFor(budgets, category.id, month);
    if (!budget) continue;
    seen.add(category.id);
    const limit = limitInBase(budget, toBase);
    // No rate for the limit's currency: leaving it out beats comparing hryvnia spending to a figure
    // in euros, which would show a €300 limit as ₴300 and every bar as blown.
    if (limit === null) continue;
    out.push(
      budgetStatus(
        budget,
        categoryById.get(category.id) ?? category,
        transactions,
        month,
        today,
        limit,
      ),
    );
  }

  return out.sort((a, b) => b.ratio - a.ratio);
}
