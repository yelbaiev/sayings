import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "./harness";

/**
 * Privacy mode's one moving part: the eye in the header stamps `data-privacy` on <html>, and
 * everything else is a CSS attribute selector blurring whatever is marked `sensitive`. If the
 * stamp works, the mode works; there is deliberately nothing else to test.
 */

vi.mock("~/db/queries", () => ({
  useAccounts: () => [],
  useCategories: () => [],
  useMembers: () => [],
  useTransactions: () => [],
  useLookups: () => ({ accounts: new Map(), categories: new Map(), members: new Map() }),
  useTransactionCount: () => 0,
  useBalances: () => [],
  useAccount: () => undefined,
}));
vi.mock("~/lib/fx", () => ({ rateFor: () => Promise.resolve({ rate: 1, estimated: false }) }));
vi.mock("~/ui/SyncPill", () => ({ SyncPill: () => null }));
vi.mock("~/features/entry/useRepeatLast", () => ({
  useLastTransaction: () => null,
  useRepeatLast: () => () => Promise.resolve(),
}));

const { RouterProvider } = await import("~/app/router");
const { Shell } = await import("~/app/Shell");

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-privacy");
});

describe("privacy mode", () => {
  it("toggles the attribute the blur rules key off, and says which way it will flip", () => {
    window.history.replaceState({}, "", "/");
    renderInApp(
      <RouterProvider>
        <Shell>{null}</Shell>
      </RouterProvider>,
    );

    const toggle = screen.getByRole("button", { name: "Скрыть суммы" });
    fireEvent.click(toggle);
    expect(document.documentElement.hasAttribute("data-privacy")).toBe(true);

    // The same control, now offering the way back.
    fireEvent.click(screen.getByRole("button", { name: "Показать суммы" }));
    expect(document.documentElement.hasAttribute("data-privacy")).toBe(false);
  });
});
