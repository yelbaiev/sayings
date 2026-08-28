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
   * Oldest first, and ties broken by id.
   *
   * Several transactions a day is normal — a coffee and a metro fare share a date — so the sort
   * needs a tiebreaker or the running figures shuffle between renders while the total stays right.
   * The id is stable, arbitrary and always present, which is all a tiebreaker has to be.
   */
  const ordered = [...mine].sort(
    (a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id),
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
