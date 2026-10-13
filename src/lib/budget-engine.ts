import type { Minor } from "@shared/money";
import type { Budget } from "@shared/schema";

/**
 * Budget lookups, as pure functions.
 *
 * A budget is a monthly limit per category, nothing more: no carry-over and no pace. Spending
 * against it is shown in Reports, which needs exactly two answers — which limit applies to this
 * category in this month, and what it is worth in the base currency.
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
