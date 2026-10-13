import { signedMinor, type Minor } from "@shared/money";
import type { Account, Budget, Category, Transaction } from "@shared/schema";
import { budgetStatuses, type BudgetStatus, type ToBase } from "./budget-engine";
import { addMonths, dayOfMonth, monthOf } from "./format";

/**
 * How much of a month's income could go to savings, as a pure function.
 *
 * The one rule that shapes everything here: **staying under a budget is not extra money.** Whatever
 * was not spent under a limit is already inside income − expenses. The under-limit figure is shown
 * as *where part of the leftover came from*, never added on top — adding it would count the same
 * hryvnia twice and suggest moving money the household does not have.
 */

/**
 * The first days of a month look back at the one just closed rather than at a few days of the new
 * one: that is when the month's result is final, and when "you stayed under your limits" is true
 * rather than provisional.
 */
export const LOOK_BACK_DAYS = 7;

export interface SavingsSuggestion {
  month: string;
  /** True for a month still in progress — its figures are "so far". */
  inProgress: boolean;
  income: Minor;
  expenses: Minor;
  /** Income − expenses. Negative when the month spent more than it earned. */
  leftover: Minor;
  /** Net transfers into savings accounts this month, from accounts that are not savings. */
  alreadySaved: Minor;
  /** What is still worth moving: the leftover less what has already gone to savings. Never negative. */
  suggested: Minor;
  /**
   * Sum of what is left under each non-rollover limit that was not exceeded. Rollover limits are left
   * out: their unspent amount already belongs to next month's limit.
   */
  underLimits: Minor;
  /** How many limits contributed to `underLimits`. */
  underCount: number;
  /** Limits exceeded this month, worst first. Rollover limits included — over is over. */
  over: BudgetStatus[];
}

/** Which month the Home card is about on a given day. */
export function suggestionMonth(today: string): { month: string; inProgress: boolean } {
  const current = monthOf(today);
  return dayOfMonth(today) <= LOOK_BACK_DAYS
    ? { month: addMonths(current, -1), inProgress: false }
    : { month: current, inProgress: true };
}

export function savingsSuggestion(
  transactions: Transaction[],
  accounts: Account[],
  budgets: Budget[],
  categories: Category[],
  today: string,
  toBase?: ToBase,
): SavingsSuggestion {
  const { month, inProgress } = suggestionMonth(today);

  // Accounts left out of totals hold imported history (the Saldo summaries). Counting them would
  // put whole past months of synthetic rows into this one — the same reason Home's card skips them.
  const real = new Set(accounts.filter((a) => a.exclude_from_totals === 0).map((a) => a.id));
  const savings = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));

  let income = 0;
  let expenses = 0;
  let alreadySaved = 0;

  for (const tx of transactions) {
    if (monthOf(tx.occurred_on) !== month) continue;

    if (tx.kind === "transfer") {
      const fromSavings = savings.has(tx.account_id);
      const toSavings = !!tx.to_account_id && savings.has(tx.to_account_id);
      // Savings to savings is shuffling, not saving; taking money back out of savings undoes some.
      if (toSavings && !fromSavings) alreadySaved += tx.base_amount_minor;
      else if (fromSavings && !toSavings) alreadySaved -= tx.base_amount_minor;
      continue;
    }

    if (!real.has(tx.account_id)) continue;
    const signed = signedMinor(tx.kind, tx.base_amount_minor);
    if (signed > 0) income += signed;
    else expenses += -signed;
  }

  const statuses = budgetStatuses(budgets, categories, transactions, month, today, toBase);
  let underLimits = 0;
  let underCount = 0;
  for (const status of statuses) {
    if (status.budget.rollover === 1 || status.remaining <= 0) continue;
    underLimits += status.remaining;
    underCount += 1;
  }

  const leftover = income - expenses;

  return {
    month,
    inProgress,
    income,
    expenses,
    leftover,
    alreadySaved,
    suggested: Math.max(0, leftover - Math.max(0, alreadySaved)),
    underLimits,
    underCount,
    over: statuses.filter((s) => s.remaining < 0),
  };
}

/**
 * The account a "move to savings" transfer should land in: a savings account in the base currency
 * if there is one, else any savings account. Null when the household has none.
 */
export function savingsAccountFor(accounts: Account[], baseCurrency: string): Account | null {
  const candidates = accounts.filter((a) => a.type === "savings" && a.archived === 0);
  return candidates.find((a) => a.currency === baseCurrency) ?? candidates[0] ?? null;
}
