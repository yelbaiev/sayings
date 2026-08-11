import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Category, Transaction } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * The category picker's order is fixed, and stays fixed.
 *
 * The old quick tiles were ranked by decay-weighted usage, which was right when only six fit on
 * screen. The picker sheet shows every category, and there the ranking was a bug: a burst of
 * spending in one category moved every tile below it, and the muscle memory built over weeks of
 * "groceries is top-left" pointed at the wrong tile. What this file pins is the non-obvious half —
 * not just that the order matches sort_order, but that heavy recent usage cannot change it.
 */

const account: Account = {
  id: "acc_mono",
  household_id: "hh_default",
  name: "Моно",
  type: "debit_card",
  currency: "UAH",
  opening_balance_minor: 0,
  icon: "💳",
  color: "#3E63DD",
  exclude_from_totals: 0,
  archived: 0,
  sort_order: 1,
  rev: 1,
  updated_at: 1,
  updated_by: "m1",
  deleted: 0,
} as Account;

const category = (id: string, name: string, sortOrder: number): Category =>
  ({
    id,
    household_id: "hh_default",
    kind: "expense",
    name,
    parent_id: null,
    icon: "🏷️",
    color: "#6E6E76",
    archived: 0,
    sort_order: sortOrder,
    rev: 1,
    updated_at: 1,
    updated_by: "m1",
    deleted: 0,
  }) as Category;

// As useCategories returns them: sorted by sort_order.
const CATEGORIES = [
  category("cat_groceries", "Продукты", 1),
  category("cat_travel", "Путешествия", 2),
  category("cat_home", "Дом", 3),
  category("cat_pets", "Питомцы", 4),
];

// Thirty recent uses of the *last* category — the exact history that used to promote it to first.
const TRANSACTIONS: Transaction[] = Array.from(
  { length: 30 },
  (_, i) =>
    ({
      id: `t${i}`,
      household_id: "hh_default",
      kind: "expense",
      occurred_on: "2026-08-07",
      account_id: "acc_mono",
      to_account_id: null,
      category_id: "cat_pets",
      amount_minor: 10_000,
      currency: "UAH",
      base_amount_minor: 10_000,
      fx_rate: 1,
      fx_estimated: 0,
      note: null,
      receipt_key: null,
      rev: 1,
      updated_at: Date.now(),
      updated_by: "m1",
      deleted: 0,
    }) as unknown as Transaction,
);

vi.mock("~/db/queries", () => ({
  useAccounts: () => [account],
  useCategories: () => CATEGORIES,
  useMembers: () => [],
  useTransactions: () => TRANSACTIONS,
  useLookups: () => ({ accounts: new Map(), categories: new Map(), members: new Map() }),
  useTransactionCount: () => 0,
  useBalances: () => [],
  useAccount: () => undefined,
}));

vi.mock("~/lib/fx", () => ({ rateFor: () => Promise.resolve({ rate: 1, estimated: false }) }));

const { EntrySheet } = await import("~/features/entry/EntrySheet");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the category picker's order", () => {
  it("shows categories in seeded order no matter how usage is distributed", async () => {
    renderInApp(<EntrySheet onClose={() => undefined} onSaved={() => undefined} />);

    fireEvent.click(await screen.findByText("Выберите категорию"));

    // The search field marks the picker sheet; walk up to its dialog to scope the tile query.
    const search = await screen.findByLabelText("Поиск категорий");
    const picker = within(search.closest('[role="dialog"]') as HTMLElement);

    const names = picker
      .getAllByRole("button")
      .map((tile) => tile.textContent ?? "")
      .filter((text) => CATEGORIES.some((c) => text.includes(c.name)));
    expect(names).toEqual(["🏷️Продукты", "🏷️Путешествия", "🏷️Дом", "🏷️Питомцы"]);
  });
});
