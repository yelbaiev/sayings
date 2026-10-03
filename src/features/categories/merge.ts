import { parseTemplate, serialiseTemplate } from "@shared/quick-tile";
import type { Budget, Recurring, Transaction } from "@shared/schema";

/**
 * What merging one category into another writes. Pure, so the decisions can be tested without a
 * database; CategorySheet applies the result.
 *
 * Transactions move across. So do recurring payments and budgets — they used to stay behind, so
 * next month the schedule posted into the archived category again, and its budget sat orphaned
 * while the merged spending ran with no limit. A budget moves only where the target has none for
 * the same period; where it has one, the target's stands and the merged category's is removed,
 * rather than guessing which of two limits was meant.
 */
export interface MergeWrites {
  transactions: Transaction[];
  recurring: Recurring[];
  budgets: Budget[];
  removeBudgetIds: string[];
}

export function mergeWrites(
  fromId: string,
  toId: string,
  transactions: Transaction[],
  schedules: Recurring[],
  budgets: Budget[],
): MergeWrites {
  const live = budgets.filter((b) => b.deleted === 0);
  const writes: MergeWrites = { transactions: [], recurring: [], budgets: [], removeBudgetIds: [] };

  for (const tx of transactions) {
    if (tx.category_id === fromId) writes.transactions.push({ ...tx, category_id: toId });
  }

  for (const item of schedules) {
    if (item.deleted === 1) continue;
    const template = parseTemplate(item.template);
    if (template?.category_id !== fromId) continue;
    writes.recurring.push({
      ...item,
      template: serialiseTemplate({ ...template, category_id: toId }),
    });
  }

  for (const budget of live.filter((b) => b.category_id === fromId)) {
    const clash = live.some(
      (b) => b.category_id === toId && (b.period_month ?? null) === (budget.period_month ?? null),
    );
    if (clash) writes.removeBudgetIds.push(budget.id);
    else writes.budgets.push({ ...budget, category_id: toId });
  }

  return writes;
}
