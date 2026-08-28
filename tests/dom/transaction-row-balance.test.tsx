import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Account, Category, Transaction } from "@shared/schema";
import { renderInApp } from "./harness";
import { TransactionRow } from "~/features/transactions/TransactionRow";

/**
 * The balance-after figure on a row.
 *
 * The arithmetic behind it is pinned in tests/unit/running-balance.ts; this is about the row
 * carrying it only when it is given one. History passes it for a single filtered account and
 * withholds it otherwise, because a column that cannot be checked by subtraction reads as broken
 * even when every figure in it is true.
 */

const account = {
  id: "acc",
  name: "Моно",
  currency: "UAH",
  icon: "💳",
  color: "#3E63DD",
} as Account;

const category = { id: "cat", name: "Кафе", icon: "☕", color: "#E5484D" } as Category;

const lookups = {
  accounts: new Map([["acc", account]]),
  categories: new Map([["cat", category]]),
  members: new Map(),
};

const tx = {
  id: "t1",
  kind: "expense",
  account_id: "acc",
  to_account_id: null,
  category_id: "cat",
  amount_minor: 4_500,
  currency: "UAH",
  occurred_on: "2026-08-20",
  deleted: 0,
  updated_by: "m1",
} as Transaction;

describe("the balance after a row", () => {
  it("is shown when the row is given one", () => {
    renderInApp(<TransactionRow transaction={tx} lookups={lookups} runningMinor={123_400} />);
    // Both figures on the row: what it cost, and what was left.
    expect(screen.getByText(/45/u)).toBeTruthy();
    expect(screen.getByText(/1\s*234/u)).toBeTruthy();
  });

  it("is absent otherwise, which is every list except a filtered history", () => {
    renderInApp(<TransactionRow transaction={tx} lookups={lookups} />);
    expect(screen.queryByText(/1\s*234/u)).toBeNull();
  });

  it("is hidden by privacy mode along with every other amount", () => {
    // A running balance is the most sensitive number on the screen: it is the card's contents.
    const { container } = renderInApp(
      <TransactionRow transaction={tx} lookups={lookups} runningMinor={123_400} />,
    );
    const figures = container.querySelectorAll(".sensitive");
    expect([...figures].some((node) => /1\s*234/u.test(node.textContent ?? ""))).toBe(true);
  });
});
