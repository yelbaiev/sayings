import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Recurring } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * Ending a subscription from the list.
 *
 * Deleting a schedule was only possible from inside the editor, behind a hold gesture at the
 * bottom of a form you had no other reason to open — reported as "there is no way to delete a
 * recurring payment, only to pause it", which is exactly how it read. The list row now carries the
 * same swipe-to-delete the transaction list has, and the undo toast replaces the hold as the net.
 *
 * What matters here is the wiring, not the gesture: the action is on the row, it soft-deletes the
 * right schedule, and undo puts back the row that was removed rather than rebuilding one.
 */

vi.mock("~/db/queries", () => ({
  useAccounts: () => [],
  useCategories: () => [],
}));

const remove = vi.fn(async (_table: string, _id: string) => previousRow);
const restore = vi.fn(async (_table: string, _row: Record<string, unknown>) => undefined);

vi.mock("~/db/mutations", () => ({
  newId: () => "new-id",
  put: vi.fn(async () => undefined),
  remove: (table: string, id: string) => remove(table, id),
  restore: (table: string, row: Record<string, unknown>) => restore(table, row),
}));

vi.mock("~/db/useRates", () => ({
  useLatestRates: () => new Map([["UAH", 1]]),
  toBaseAtLatest: (minor: number) => minor,
}));

const item = {
  id: "r1",
  household_id: "hh_default",
  label: "Apple Cloud",
  template: JSON.stringify({
    kind: "expense",
    amount_minor: 44800,
    currency: "UAH",
    category_id: "c1",
    account_id: "a1",
  }),
  cadence: "monthly",
  day_of: 30,
  next_on: "2099-01-30",
  active: 1,
  rev: 1,
  updated_at: 1,
  updated_by: "m1",
  deleted: 0,
} as unknown as Recurring;

/** What `remove` hands back — the row as it was, which is all undo needs. */
const previousRow = { ...item } as unknown as Record<string, unknown>;

vi.mock("~/features/recurring/useRecurring", () => ({
  useRecurringList: () => [item],
  useRecurringActions: () => ({
    post: vi.fn(),
    skip: vi.fn(),
    undoPost: vi.fn(),
    nextOccurrence: () => "2099-02-28",
  }),
}));

const { RecurringPage } = await import("~/features/recurring/RecurringPage");

describe("deleting a recurring schedule from the list", () => {
  it("soft-deletes the row the action belongs to, and offers undo", async () => {
    renderInApp(<RecurringPage />);

    // The swipe action is a real button behind the row, not a coloured backdrop, so it is
    // clickable here without simulating the drag — the gesture itself is covered by
    // tests/unit/swipe-gesture.test.ts.
    const del = screen.getByText("Удалить");
    fireEvent.click(del);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toBe("recurring");
    expect(remove.mock.calls[0]?.[1]).toBe("r1");

    const undo = await screen.findByText("Отменить");
    fireEvent.click(undo);

    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]?.[1]).toMatchObject({ id: "r1", label: "Apple Cloud" });
  });
});
