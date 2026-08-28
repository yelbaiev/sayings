import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "./harness";

/**
 * The second currency beside a total.
 *
 * What matters here is not the arithmetic — that is four lines in useRates — but the three cases
 * where it must draw *nothing*. A figure converted at 1:1 because no rate was held would be a
 * wrong number wearing the right symbol, and the one place that has ever gone wrong in this app is
 * a currency quietly treated as another.
 */

let rates = new Map<string, number>([["EUR", 45]]);
vi.mock("~/db/useRates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/db/useRates")>()),
  useLatestRates: () => rates,
}));

let secondary: string | null = "EUR";
vi.mock("~/db/dexie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/db/dexie")>();
  return {
    ...actual,
    db: {},
    getDevicePrefs: () =>
      Promise.resolve({
        id: "prefs",
        theme: "system",
        lastAccountByCategory: {},
        installPromptSeen: true,
        introSeen: true,
        secondaryCurrency: secondary,
      }),
    setDevicePrefs: () => Promise.resolve(),
    resetLocalMirror: () => Promise.resolve(),
  };
});

const { SecondaryAmount } = await import("~/ui");

describe("SecondaryAmount", () => {
  it("repeats a base-currency total in the chosen currency", async () => {
    secondary = "EUR";
    rates = new Map([["EUR", 45]]);
    // ₴463 967,00 at 45 ₴/€ is about €10 310.
    renderInApp(<SecondaryAmount minor={46_396_700} />);
    expect((await screen.findByText(/≈/u)).textContent).toMatch(/10\s*310/u);
  });

  it("draws nothing when no second currency is chosen", async () => {
    secondary = null;
    const { container } = renderInApp(<SecondaryAmount minor={46_396_700} />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
  });

  it("draws nothing when no rate is held for it", async () => {
    /*
     * The failure this prevents: falling back to 1:1 and printing "≈ 463 967 €" beside "463 967 ₴",
     * which looks like a conversion and is not one.
     */
    secondary = "EUR";
    rates = new Map();
    const { container } = renderInApp(<SecondaryAmount minor={46_396_700} />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
  });
});
