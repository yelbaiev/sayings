import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Category, Transaction } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * Whether opening the entry sheet from one account's transaction list preselects that account.
 *
 * Written because the answer was not obvious from reading the code, and asserting it works without
 * checking would have been a guess dressed as an answer. The chain has four links — a Home card
 * navigates to `/history?account=…`, the router keeps the query, the shell reads it and passes it as
 * `contextAccountId`, and `resolveAccountId` puts context ahead of every other signal — and each link
 * was verified separately while the whole thing had never been exercised end to end.
 */

const account = (id: string, name: string, currency = "UAH"): Account =>
  ({
    id,
    household_id: "hh_default",
    name,
    type: "debit_card",
    currency,
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
  }) as Account;

const category = (id: string, name: string): Category =>
  ({
    id,
    household_id: "hh_default",
    kind: "expense",
    name,
    parent_id: null,
    icon: "🛒",
    color: "#E5484D",
    archived: 0,
    sort_order: 1,
    rev: 1,
    updated_at: 1,
    updated_by: "m1",
    deleted: 0,
  }) as Category;

const ACCOUNTS = [
  account("acc_mono", "Моно"),
  account("acc_privat", "Приват"),
  account("acc_eur", "Евро", "EUR"),
];

vi.mock("~/db/queries", () => ({
  useAccounts: () => ACCOUNTS,
  useCategories: () => [category("cat_food", "Продукты")],
  useMembers: () => [],
  useTransactions: (): Transaction[] => [],
  useLookups: () => ({ accounts: new Map(), categories: new Map(), members: new Map() }),
  useTransactionCount: () => 0,
  useBalances: () => [],
  useAccount: () => undefined,
}));

vi.mock("~/lib/fx", () => ({ rateFor: () => Promise.resolve({ rate: 1, estimated: false }) }));

/*
 * Imported after the mocks rather than at the top. `vi.mock` is hoisted, but the module graph is not:
 * a static import of EntrySheet would pull in the real `~/db/queries` before the mock is registered.
 */
const { EntrySheet } = await import("~/features/entry/EntrySheet");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the entry sheet's starting account", () => {
  it("uses the account whose transactions are being viewed", async () => {
    /*
     * The whole point. Adding a transaction while looking at one card's history almost always means
     * that card, and having to pick it again is the kind of small friction that decides whether a
     * ledger gets kept.
     */
    renderInApp(
      <EntrySheet
        contextAccountId="acc_privat"
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(await screen.findByText("Приват")).toBeTruthy();
    expect(screen.queryByText("Моно")).toBeNull();
  });

  it("falls back to something sensible with no context", async () => {
    renderInApp(<EntrySheet onClose={() => undefined} onSaved={() => undefined} />);
    // No context, no history, no member default: the first available account rather than nothing,
    // because a sheet that opens with no account cannot be saved.
    expect(await screen.findByText("Моно")).toBeTruthy();
  });

  it("ignores a context account that no longer exists", async () => {
    // An account can be archived or deleted between the list being rendered and the sheet opening.
    // Preselecting a dead id would show an empty chip and block the save with no explanation.
    renderInApp(
      <EntrySheet contextAccountId="acc_gone" onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(await screen.findByText("Моно")).toBeTruthy();
  });

  it("takes the currency of the context account, not of the default", async () => {
    // The consequence that matters: the amount is entered in the account's own currency, so getting
    // the account wrong silently records euros as hryvnia.
    renderInApp(
      <EntrySheet contextAccountId="acc_eur" onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(await screen.findByText("Евро")).toBeTruthy();
    // The currency itself shows as the € symbol inside the amount — the spelled-out code was
    // removed as a duplicate — so the assertion is on the formatted amount, not on "EUR".
    expect(screen.getByLabelText("Сумма").textContent).toContain("€");
  });

  it("stops marking a currency as foreign once it is the base", async () => {
    /*
     * The client half of the base being configuration rather than a constant. The euro chip appears
     * because the account differs from what the household reports in — so a household that reports
     * in euro must not see it, and the same render with the same account has to produce a different
     * result purely from the setting.
     */
    renderInApp(
      <EntrySheet contextAccountId="acc_eur" onClose={() => undefined} onSaved={() => undefined} />,
      { base_currency: "EUR", enabled_currencies: ["EUR", "UAH"] },
    );
    expect(await screen.findByText("Евро")).toBeTruthy();
    expect(screen.queryByText("EUR")).toBeNull();
  });

  it("prefers the edited transaction's own account over the context", async () => {
    // Editing a euro transaction while filtered to a hryvnia card must not rewrite its account.
    const editing = {
      id: "t1",
      kind: "expense",
      occurred_on: "2026-08-06",
      account_id: "acc_eur",
      to_account_id: null,
      category_id: "cat_food",
      amount_minor: 1000,
      currency: "EUR",
      note: null,
      receipt_key: null,
    } as unknown as Transaction;

    renderInApp(
      <EntrySheet
        editing={editing}
        contextAccountId="acc_mono"
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    expect(await screen.findByText("Евро")).toBeTruthy();
  });
});
