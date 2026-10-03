import { accountDelta, type Minor } from "@shared/money";
import type { Transaction } from "@shared/schema";

/**
 * What an account held immediately after each of its transactions.
 *
 * Kept out of `computeBalances`, which answers a different question — what the account holds *now*
 * — and is read by three screens that have no use for a series.
 *
 * **Accumulated over every row the account has, in date order, not over the rows on screen.** That
 * distinction is the whole correctness of this: a search term or a category filter changes which
 * rows are visible, and if the series were computed from those, every figure in the column would
 * silently change with the filter. They would still look like balances.
 */

/** Rows in the order the history shows them, newest first, with the account's balance after each. */
export function runningBalances(
  accountId: string,
  openingMinor: Minor,
  transactions: Transaction[],
): Map<string, Minor> {
  const mine = transactions.filter(
    (tx) => tx.account_id === accountId || tx.to_account_id === accountId,
  );

  /*
   * Oldest first: by date, then by updated_at, then by id.
   *
   * Several transactions a day is normal — a coffee and a metro fare share a date — and within a day
   * the tiebreak has to be the one the list uses (useTransactions: updated_at, newest on top), read
   * backwards. It used to be the id alone, which is random: about half the same-day pairs then ran
   * in the opposite order to the rows on screen, and the column stopped subtracting down. The id
   * stays as the last resort so the order never shuffles between renders.
   */
  const ordered = [...mine].sort(
    (a, b) =>
      a.occurred_on.localeCompare(b.occurred_on) ||
      a.updated_at - b.updated_at ||
      a.id.localeCompare(b.id),
  );

  const after = new Map<string, Minor>();
  let balance = openingMinor;

  for (const tx of ordered) {
    balance += accountDelta(
      {
        kind: tx.kind,
        accountId: tx.account_id,
        amountMinor: tx.amount_minor,
        toAccountId: tx.to_account_id ?? null,
        toAmountMinor: tx.to_amount_minor ?? null,
      },
      accountId,
    );
    after.set(tx.id, balance);
  }

  return after;
}
