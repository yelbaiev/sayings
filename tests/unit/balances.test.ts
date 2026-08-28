import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "@shared/schema";
import { computeBalances } from "~/db/queries";

/**
 * Balances for *one* account.
 *
 * The history page asks for a single card's figure and hands `computeBalances` an array of one, on
 * the claim that every leg naming another account is then skipped. That claim is the whole reason
 * a filtered history can show a balance without summing the household, and it is what these tests
 * pin — transfers especially, where a row names two accounts and only one of them is ours.
 */

const account = (id: string, opening: number): Account =>
  ({
    id,
    household_id: "hh",
    name: id,
    type: "debit_card",
    currency: "UAH",
    opening_balance_minor: opening,
    icon: "💳",
    color: "#3E63DD",
    exclude_from_totals: 0,
    archived: 0,
    sort_order: 1,
    rev: 1,
    updated_at: 1,
    updated_by: "m1",
    deleted: 0,
  }) as Account;

const tx = (fields: Partial<Transaction>): Transaction =>
  ({
    id: "tx",
    household_id: "hh",
    kind: "expense",
    account_id: "a",
    to_account_id: null,
    to_amount_minor: null,
    category_id: null,
    amount_minor: 0,
    currency: "UAH",
    occurred_on: "2026-08-27",
    rev: 1,
    updated_at: 1,
    updated_by: "m1",
    deleted: 0,
    ...fields,
  }) as Transaction;

const balanceOf = (opening: number, rows: Transaction[]) =>
  computeBalances([account("a", opening)], rows)[0]?.native;

describe("one account's balance", () => {
  it("starts at the opening balance", () => {
    expect(balanceOf(10_000, [])).toBe(10_000);
  });

  it("takes expenses out and puts income in", () => {
    expect(balanceOf(10_000, [tx({ kind: "expense", amount_minor: 2_500 })])).toBe(7_500);
    expect(balanceOf(10_000, [tx({ kind: "income", amount_minor: 5_000 })])).toBe(15_000);
  });

  it("follows both legs of a transfer", () => {
    // Out of this account...
    expect(
      balanceOf(10_000, [
        tx({ kind: "transfer", account_id: "a", to_account_id: "b", amount_minor: 3_000 }),
      ]),
    ).toBe(7_000);

    // ...and into it, at the destination leg's own amount, which a cross-currency move sets.
    expect(
      balanceOf(10_000, [
        tx({
          kind: "transfer",
          account_id: "b",
          to_account_id: "a",
          amount_minor: 9_999,
          to_amount_minor: 3_000,
        }),
      ]),
    ).toBe(13_000);
  });

  it("ignores rows that name only other accounts", () => {
    /*
     * The assumption the history page rests on. Handing in one account has to mean "this account's
     * arithmetic", not "the first account's slot filled with everyone's transactions".
     */
    const others = [
      tx({ kind: "expense", account_id: "b", amount_minor: 50_000 }),
      tx({ kind: "transfer", account_id: "b", to_account_id: "c", amount_minor: 50_000 }),
    ];
    expect(balanceOf(10_000, others)).toBe(10_000);
  });

  it("gives the same figure whether or not the other accounts are present", () => {
    const rows = [
      tx({ kind: "expense", account_id: "a", amount_minor: 2_500 }),
      tx({ kind: "transfer", account_id: "b", to_account_id: "a", amount_minor: 1_000 }),
      tx({ kind: "expense", account_id: "b", amount_minor: 700 }),
    ];
    const alone = computeBalances([account("a", 10_000)], rows)[0]?.native;
    const together = computeBalances([account("a", 10_000), account("b", 0)], rows).find(
      (balance) => balance.account.id === "a",
    )?.native;

    expect(alone).toBe(8_500);
    expect(together).toBe(alone);
  });
});
