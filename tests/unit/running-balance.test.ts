import { describe, expect, it } from "vitest";
import type { Transaction } from "@shared/schema";
import { runningBalances } from "~/lib/running-balance";

/**
 * The balance after each transaction, which is a different question from the balance now and has
 * one trap the current figure does not: order.
 */

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
    occurred_on: "2026-08-01",
    rev: 1,
    updated_at: 1,
    updated_by: "m1",
    deleted: 0,
    ...fields,
  }) as Transaction;

describe("runningBalances", () => {
  it("accumulates in date order, whatever order the rows arrive in", () => {
    // History hands rows newest-first; a series built in that order counts backwards.
    const rows = [
      tx({ id: "t3", occurred_on: "2026-08-03", amount_minor: 300 }),
      tx({ id: "t1", occurred_on: "2026-08-01", amount_minor: 100 }),
      tx({ id: "t2", occurred_on: "2026-08-02", amount_minor: 200 }),
    ];

    const after = runningBalances("a", 10_000, rows);
    expect(after.get("t1")).toBe(9_900);
    expect(after.get("t2")).toBe(9_700);
    expect(after.get("t3")).toBe(9_400);
  });

  it("breaks ties on the same day by id, so the column does not shuffle", () => {
    const rows = [
      tx({ id: "b", occurred_on: "2026-08-01", amount_minor: 200 }),
      tx({ id: "a", occurred_on: "2026-08-01", amount_minor: 100 }),
    ];
    const after = runningBalances("a", 1_000, rows);
    expect(after.get("a")).toBe(900);
    expect(after.get("b")).toBe(700);
  });

  it("follows both legs of a transfer", () => {
    const rows = [
      tx({ id: "out", occurred_on: "2026-08-01", kind: "transfer", to_account_id: "b", amount_minor: 500 }),
      tx({
        id: "in",
        occurred_on: "2026-08-02",
        kind: "transfer",
        account_id: "b",
        to_account_id: "a",
        amount_minor: 999,
        to_amount_minor: 300,
      }),
    ];
    const after = runningBalances("a", 1_000, rows);
    expect(after.get("out")).toBe(500);
    // Arrives at the destination leg's own amount, which a cross-currency move sets explicitly.
    expect(after.get("in")).toBe(800);
  });

  it("has nothing to say about rows on other accounts", () => {
    const rows = [tx({ id: "other", account_id: "b", amount_minor: 900 })];
    expect(runningBalances("a", 1_000, rows).size).toBe(0);
  });

  it("counts income upward", () => {
    const rows = [tx({ id: "pay", kind: "income", amount_minor: 5_000 })];
    expect(runningBalances("a", 1_000, rows).get("pay")).toBe(6_000);
  });
});
