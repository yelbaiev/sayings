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

export interface BudgetStatus {
  budget: Budget;
  category: Category;
  month: string;
  /** The month's own limit, before any rollover. */
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
): Minor {
  if (!budget.rollover) return 0;

  // A month-specific budget has no history to carry.
  const start = budget.period_month ?? earliestMonth(transactions, budget.category_id);
  if (!start || start >= month) return 0;

  let credit = 0;
  let cursor = start;
  let steps = 0;

  while (cursor < month && steps++ < maxMonths) {
    const spent = spentInMonth(transactions, budget.category_id, cursor);
    // Underspend adds, overspend subtracts. Carrying only the surplus would let the limit
    // drift upward forever and stop meaning anything.
    credit += budget.amount_minor - spent;
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
): BudgetStatus {
  const spent = spentInMonth(transactions, budget.category_id, month);
  const carried = rolloverCredit(budget, transactions, month);
  const effectiveLimit = budget.amount_minor + carried;

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
    baseLimit: budget.amount_minor,
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
): BudgetStatus[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: BudgetStatus[] = [];

  for (const category of categories) {
    if (seen.has(category.id)) continue;
    const budget = budgetFor(budgets, category.id, month);
    if (!budget) continue;
    seen.add(category.id);
    out.push(
      budgetStatus(budget, categoryById.get(category.id) ?? category, transactions, month, today),
    );
  }

  return out.sort((a, b) => b.ratio - a.ratio);
}
