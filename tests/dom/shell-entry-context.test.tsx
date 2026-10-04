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
  // Mirrors the real hook's contract: a figure while a card is chosen, null otherwise.
  useAccountLedger: (id?: string) =>
    id
      ? {
          account: account(id, id === "acc_privat" ? "Приват" : "Моно"),
          native: 1_234_500,
          rows: [],
        }
      : null,
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

  it("shows the chosen card's balance beside its name, and drops it when the filter clears", () => {
    /*
     * Filtering history to one card is how "what is on this card" gets asked. Without the figure
     * here the answer lives on another screen, and the list below only says where it went.
     */
    window.history.replaceState({}, "", "/history?account=acc_privat");
    renderInApp(
      <RouterProvider>
        <Shell>
          <HistoryPage />
        </Shell>
      </RouterProvider>,
    );

    const balance = document.querySelector("[data-slot=account-balance]");
    expect(balance).toBeTruthy();
    expect(balance!.textContent).toContain("Приват");
    expect(balance!.textContent).toMatch(/12\s*345,00/u);

    // Unfiltered, there is no one card to report on.
    fireEvent.click(screen.getByRole("button", { name: "История" }));
    expect(document.querySelector("[data-slot=account-balance]")).toBeNull();
  });
});

describe("home-screen shortcut links", () => {
  it("reads only the three kinds from ?add=", async () => {
    const { readDeepLinkKind } = await import("~/app/Shell");
    expect(readDeepLinkKind("?add=expense")).toBe("expense");
    expect(readDeepLinkKind("?add=income")).toBe("income");
    expect(readDeepLinkKind("?add=transfer")).toBe("transfer");
    expect(readDeepLinkKind("?add=anything")).toBeUndefined();
    expect(readDeepLinkKind("")).toBeUndefined();
  });

  it("opens the entry sheet on launch at /?add=income, then drops the parameter", async () => {
    window.history.replaceState({}, "", "/?add=income");
    renderInApp(
      <RouterProvider>
        <Shell>{null}</Shell>
      </RouterProvider>,
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();
    // Removed with replace, so Back or a reload does not reopen the sheet.
    expect(window.location.search).toBe("");
  });

  it("does nothing on a plain launch", () => {
    window.history.replaceState({}, "", "/");
    renderInApp(
      <RouterProvider>
        <Shell>{null}</Shell>
      </RouterProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the + button's quick actions", () => {
  function renderShell() {
    window.history.replaceState({}, "", "/");
    renderInApp(
      <RouterProvider>
        <Shell>{null}</Shell>
      </RouterProvider>,
    );
    return screen.getByRole("button", { name: "Добавить" });
  }

  function hold(button: HTMLElement) {
    vi.useFakeTimers();
    fireEvent.pointerDown(button);
    vi.advanceTimersByTime(600);
    fireEvent.pointerUp(button);
    vi.useRealTimers();
  }

  it("opens on a hold, and a pick opens the entry sheet on that kind", async () => {
    const plus = renderShell();
    hold(plus);

    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
    // Nothing to repeat in this ledger (useLastTransaction is mocked to null), so three kinds only.
    expect(items).toEqual(["−Расход", "+Доход", "Перевод"]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: /Доход/u }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("opens on right-click too, for a mouse", async () => {
    const plus = renderShell();
    fireEvent.contextMenu(plus);
    expect(await screen.findByRole("menu")).toBeTruthy();
  });

  it("leaves a tap as it was: a new entry, no menu", async () => {
    const plus = renderShell();
    fireEvent.pointerDown(plus);
    fireEvent.pointerUp(plus);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
