import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * Repeat-last, as something that can be seen.
 *
 * The gesture — a long press on the add button — has worked for a long time and could not be
 * found: the string written for its label was referenced nowhere in the app, which is as good a
 * measure of a hidden feature as any. This is the visible way in, and these tests are about it
 * being visible rather than about the copy it makes, which has its own home in useRepeatLast.
 */

const last = {
  id: "tx_last",
  household_id: "hh_default",
  kind: "expense",
  account_id: "acc_mono",
  to_account_id: null,
  category_id: "cat_coffee",
  amount_minor: 4_500,
  currency: "UAH",
  occurred_on: "2026-08-20",
  rev: 1,
  updated_at: 1,
  updated_by: "m1",
  deleted: 0,
} as Transaction;

let latest: Transaction | undefined = last;
const repeat = vi.fn(() => Promise.resolve());

vi.mock("~/db/queries", () => ({
  useQuickTiles: () => [],
  useAccounts: () => [],
  useCategories: () => [],
  useLatestTransaction: () => latest,
}));

vi.mock("~/features/entry/useRepeatLast", () => ({
  useRepeatLast: () => repeat,
  useLastTransaction: () => latest,
}));

const { QuickTiles } = await import("~/features/home/QuickTiles");

describe("the repeat-last tile", () => {
  it("offers the last transaction by name and amount", async () => {
    latest = last;
    renderInApp(<QuickTiles />);

    const tile = await screen.findByRole("button", { name: /Повторить последнюю/u });
    // The amount is on the tile: "the same again" is only one tap if it is the *right* same again.
    expect(tile.textContent).toMatch(/45/u);

    await userEvent.click(tile);
    expect(repeat).toHaveBeenCalledTimes(1);
  });

  it("is absent on an empty ledger, where there is nothing to repeat", () => {
    latest = undefined;
    renderInApp(<QuickTiles />);
    expect(screen.queryByRole("button", { name: /Повторить последнюю/u })).toBeNull();
  });
});
