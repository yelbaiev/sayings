import { act } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Recurring, Transaction } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * Two copies that used to carry the wrong things along, and a button that posted twice.
 */

const last = {
  id: "tx_last",
  household_id: "hh_default",
  kind: "expense",
  account_id: "acc_eur",
  to_account_id: null,
  category_id: "cat_coffee",
  amount_minor: 400,
  currency: "EUR",
  occurred_on: "2026-03-02",
  base_amount_minor: 17_600,
  fx_rate: 44,
  fx_source: "manual",
  fx_estimated: 0,
  split_parent_id: "split_1",
  created_by: "m2",
  rev: 1,
  updated_at: 1,
  updated_by: "m2",
  deleted: 0,
} as Transaction;

const put = vi.fn(async (..._args: unknown[]) => undefined);
let release: () => void = () => undefined;

vi.mock("~/db/mutations", () => ({
  newId: () => "new-id",
  put: (...args: unknown[]) => put(...args),
  remove: vi.fn(),
}));

vi.mock("~/db/queries", () => ({
  useLatestTransaction: () => last,
}));

vi.mock("~/lib/fx", () => ({
  pricingFor: async () => ({ base_amount_minor: 19_200, fx_rate: 48, fx_estimated: 0, fx_source: "auto" }),
  // Held open until the test releases it, so a second tap lands while the first post is running.
  rateFor: () => new Promise((resolve) => (release = () => resolve({ rate: 1, estimated: false }))),
}));

vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => [] }));

const { useRepeatLast } = await import("~/features/entry/useRepeatLast");
const { useRecurringActions } = await import("~/features/recurring/useRecurring");

function Run({ use }: { use: () => void }) {
  use();
  return null;
}

describe("repeat-last", () => {
  it("is your entry at today's rate, outside the original's split", async () => {
    put.mockClear();
    let repeat: (() => Promise<void>) | undefined;
    renderInApp(<Run use={() => (repeat = useRepeatLast())} />);
    await act(() => repeat!());

    const row = put.mock.calls[0]![1] as Transaction;
    expect(row.created_by).toBe("m1");
    expect(row.fx_rate).toBe(48);
    expect(row.base_amount_minor).toBe(19_200);
    expect(row.fx_source).toBe("auto");
    expect(row.split_parent_id).toBeNull();
  });
});

describe("posting a recurring payment", () => {
  it("writes once however many times it is tapped", async () => {
    put.mockClear();
    const item = {
      id: "r1",
      label: "Rent",
      template: JSON.stringify({
        kind: "expense",
        amount_minor: 100_000,
        currency: "UAH",
        category_id: "c1",
        account_id: "a1",
      }),
      cadence: "monthly",
      day_of: 1,
      next_on: "2026-10-01",
      active: 1,
    } as unknown as Recurring;

    let actions: ReturnType<typeof useRecurringActions> | undefined;
    function Capture() {
      const value = useRecurringActions();
      useEffect(() => {
        actions = value;
      });
      return null;
    }
    renderInApp(<Capture />);

    const first = actions!.post(item);
    const second = await actions!.post(item); // the double tap
    expect(second).toBeNull();
    release();
    await act(async () => {
      await first;
    });

    const transactions = put.mock.calls.filter(([table]) => table === "transactions");
    expect(transactions).toHaveLength(1);
  });
});
