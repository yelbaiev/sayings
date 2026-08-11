import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account, Category } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * The foreign-currency amount block: what it costs the household, above what the card was charged.
 *
 * The arrangement is the point. The converted figure is the number anyone actually reasons about, so
 * it is read first and needs no label; the rate that produced it is one tap away rather than a
 * permanent field, because a rate is worth *seeing* every time and worth correcting perhaps twice a
 * year. A field would have spent a row of the form on the rarer of those two.
 */

const account = (id: string, name: string, currency: string): Account =>
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

const ACCOUNTS = [account("acc_eur", "ProCredit", "EUR"), account("acc_uah", "Моно", "UAH")];

vi.mock("~/db/queries", () => ({
  useAccounts: () => ACCOUNTS,
  useCategories: () => [
    {
      id: "cat_food",
      household_id: "hh_default",
      kind: "expense",
      name: "Продукты",
      parent_id: null,
      icon: "🛒",
      color: "#E5484D",
      archived: 0,
      sort_order: 1,
      rev: 1,
      updated_at: 1,
      updated_by: "m1",
      deleted: 0,
    } as Category,
  ],
  useMembers: () => [],
  useTransactions: () => [],
  useLookups: () => ({ accounts: new Map(), categories: new Map(), members: new Map() }),
  useTransactionCount: () => 0,
  useBalances: () => [],
  useAccount: () => undefined,
}));

/**
 * The NBU rate for 2026-08-04, behind a mutable holder.
 *
 * A holder rather than `vi.resetModules()` and a re-import: re-importing gives the test a *different*
 * module instance, including a different React context object, so the component would throw
 * "useApp used outside AppProvider" while the provider sat right above it.
 */
const lookup = { rate: 51.6423, estimated: false };
vi.mock("~/lib/fx", () => ({
  rateFor: () => Promise.resolve({ ...lookup }),
}));

const { EntrySheet } = await import("~/features/entry/EntrySheet");

function open() {
  return renderInApp(
    <EntrySheet contextAccountId="acc_eur" onClose={() => undefined} onSaved={() => undefined} />,
  );
}

describe("the amount block in a foreign currency", () => {
  it("never spells out the currency code — the symbol in the amount carries it", async () => {
    /*
     * The badge beside the field was removed at the user's request: € inside the amount already
     * says it, and the same fact twice on one line reads as two facts. The code may still appear
     * where it distinguishes (the account picker sheet), but not on the amount line.
     */
    open();
    expect(await screen.findByText("ProCredit")).toBeTruthy();
    expect(screen.queryByText("EUR")).toBeNull();
  });

  it("keeps the rate out of the way until it is asked for", async () => {
    open();
    await screen.findAllByText("ProCredit");
    // The converted figure is present from the start; the editor is not.
    expect(document.querySelector('[data-slot="converted-amount"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="rate-field"]')).toBeNull();
  });

  it("opens the rate in a sheet when the converted figure is tapped", async () => {
    /*
     * The figure is the affordance. Someone who disagrees with the converted amount is looking
     * straight at it, so that is where the correction belongs — not behind a control elsewhere on
     * the form that they would have to go looking for.
     *
     * A sheet rather than an expansion under the amount: everything that grew the form in place is
     * what put the last fields under the keypad in the first place.
     */
    open();
    const converted = await vi.waitFor(() => {
      const node = document.querySelector<HTMLButtonElement>('[data-slot="converted-amount"]');
      expect(node).toBeTruthy();
      return node!;
    });

    const before = document.querySelectorAll('[role="dialog"]').length;
    await userEvent.click(converted);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(before + 1);
    expect(document.querySelector('[data-slot="rate-field"]')).toBeTruthy();
  });

  it("shows the rate unasked when none was published for the date", async () => {
    /*
     * A guess the person cannot see is a guess they cannot fix — but only once there is an amount to
     * guess about. Opening a sheet over an empty form would be an interruption before the person has
     * done anything, which is worse than the problem it warns of.
     */
    lookup.rate = 1;
    lookup.estimated = true;
    try {
      open();
      expect(document.querySelector('[data-slot="rate-field"]')).toBeNull();

      await userEvent.click(await screen.findByLabelText("Сумма"));
      await userEvent.click(screen.getByRole("button", { name: "5" }));

      await vi.waitFor(() => {
        expect(document.querySelector('[data-slot="rate-field"]')).toBeTruthy();
      });
    } finally {
      lookup.rate = 51.6423;
      lookup.estimated = false;
    }
  });
});
