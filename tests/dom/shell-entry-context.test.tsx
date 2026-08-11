import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Category, Transaction } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * The whole context-account chain, end to end: URL → router → Shell FAB → EntrySheet.
 *
 * tests/dom/entry-context.test.tsx proves that an EntrySheet *given* contextAccountId preselects
 * it. This file proves somebody actually gives it one — the link the user has now watched break
 * twice is the wiring, not the resolution.
 */

const account = (id: string, name: string): Account =>
  ({
    id,
    household_id: "hh_default",
    name,
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

vi.mock("~/db/queries", () => ({
  useAccounts: () => [account("acc_mono", "Моно"), account("acc_privat", "Приват")],
  useCategories: () => [category("cat_food", "Продукты")],
  useMembers: () => [],
  useTransactions: (): Transaction[] => [],
  useLookups: () => ({ accounts: new Map(), categories: new Map(), members: new Map() }),
  useTransactionCount: () => 0,
  useBalances: () => [],
  useAccount: () => undefined,
}));

vi.mock("~/lib/fx", () => ({ rateFor: () => Promise.resolve({ rate: 1, estimated: false }) }));
// The pill polls sync state through the worker API; none of that exists in jsdom.
vi.mock("~/ui/SyncPill", () => ({ SyncPill: () => null }));
vi.mock("~/features/entry/useRepeatLast", () => ({
  useLastTransaction: () => null,
  useRepeatLast: () => () => Promise.resolve(null),
}));

const { RouterProvider } = await import("~/app/router");
const { Shell } = await import("~/app/Shell");
const { HistoryPage } = await import("~/features/transactions/HistoryPage");

beforeEach(() => {
  vi.clearAllMocks();
});

function openEntryFromFab() {
  const fab = screen.getByRole("button", { name: "Добавить" });
  // The FAB opens through the press-gesture state machine, not through onClick.
  fireEvent.pointerDown(fab);
  fireEvent.pointerUp(fab);
}

describe("the Shell FAB and the account being viewed", () => {
  it("preselects the filtered account when adding from /history?account=…", async () => {
    window.history.replaceState({}, "", "/history?account=acc_privat");
    renderInApp(
      <RouterProvider>
        <Shell>{null}</Shell>
      </RouterProvider>,
    );
    openEntryFromFab();
    expect(await screen.findByText("Приват")).toBeTruthy();
    expect(screen.queryByText("Моно")).toBeNull();
  });

  it("falls back to the first account on an unfiltered history", async () => {
    window.history.replaceState({}, "", "/history");
    renderInApp(
      <RouterProvider>
        <Shell>{null}</Shell>
      </RouterProvider>,
    );
    openEntryFromFab();
    expect(await screen.findByText("Моно")).toBeTruthy();
  });

  it("keeps the visible filter and the preselection in agreement across a tab tap", async () => {
    /*
     * The regression, second edition. Tapping the History tab while already on a filtered history
     * navigates to a bare /history without unmounting the page. The filter used to live in a
     * useState seeded from the URL once, so it survived that navigation: the list stayed filtered
     * to one card while the shell — which reads the URL — preselected nothing. Deriving the filter
     * from the URL makes the two agree by construction; this pins which way they agree.
     */
    window.history.replaceState({}, "", "/history?account=acc_privat");
    renderInApp(
      <RouterProvider>
        <Shell>
          <HistoryPage />
        </Shell>
      </RouterProvider>,
    );

    const filter = screen.getByLabelText<HTMLSelectElement>("Счёт");
    expect(filter.value).toBe("acc_privat");

    fireEvent.click(screen.getByRole("button", { name: "История" }));
    // The URL lost the query, so the filter must visibly clear rather than linger in state.
    expect(filter.value).toBe("");

    openEntryFromFab();
    // Scoped to the sheet: the page's own filter select also lists the account names.
    const sheet = within(await screen.findByRole("dialog"));
    expect(await sheet.findByText("Моно")).toBeTruthy();
  });
});
