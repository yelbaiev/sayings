import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Currency } from "@shared/currency";
import { BaseCurrencyField, EnabledCurrenciesField } from "~/features/settings/CurrencyPicker";
import { renderInApp } from "./harness";

/**
 * The two rules the currency chooser has to enforce, both of which produce a broken household if it
 * does not: the reporting currency cannot be turned off, and neither can one an account still holds.
 *
 * Worth a test rather than a glance because both are expressed as `aria-disabled` rather than
 * `disabled` — a real `disabled` renders greyed, which reads as "off" and says the opposite of what is
 * true. That choice makes the *appearance* right and leaves the *behaviour* to a click handler, which
 * is exactly the arrangement that silently stops working.
 */

describe("choosing which currencies a household uses", () => {
  it("shows the base as on and refuses to turn it off", async () => {
    const onChange = vi.fn();
    renderInApp(
      <EnabledCurrenciesField
        base="UAH"
        value={["UAH", "EUR"]}
        locked={new Set()}
        onChange={onChange}
      />,
    );

    const base = screen.getByRole("button", { name: /UAH/ });
    expect(base.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(base);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses to turn off a currency an account still holds", async () => {
    // Removing it would leave that account's balance permanently unconvertible — no rate would be
    // fetched for it again, and every total including it would quietly stop adding up.
    const onChange = vi.fn();
    renderInApp(
      <EnabledCurrenciesField
        base="UAH"
        value={["UAH", "EUR"]}
        locked={new Set(["EUR"])}
        onChange={onChange}
      />,
    );

    const eur = screen.getByRole("button", { name: "EUR" });
    expect(eur.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(eur);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds and removes a free one, keeping the list sorted", async () => {
    const onChange = vi.fn();
    const { rerender } = renderInApp(
      <EnabledCurrenciesField
        base="UAH"
        value={["UAH", "USD"]}
        locked={new Set()}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "CHF" }));
    // Sorted, so the stored order cannot depend on the order they were tapped in.
    expect(onChange).toHaveBeenLastCalledWith(["CHF", "UAH", "USD"]);

    void rerender;
    await userEvent.click(screen.getByRole("button", { name: "USD" }));
    expect(onChange).toHaveBeenLastCalledWith(["UAH"]);
  });

  it("offers every supported currency as a base, named in the reader's language", () => {
    /*
     * Names come from `Intl.DisplayNames`, not from a table here — forty-three names in three
     * languages is 129 strings to maintain, and the platform already has them declined correctly.
     * The harness renders in Russian, which is the household's own language.
     */
    renderInApp(
      <BaseCurrencyField value={"UAH" as Currency} hint="" onChange={() => undefined} />,
    );
    const select = screen.getByRole("combobox");
    expect(select.querySelectorAll("option").length).toBeGreaterThan(40);
    expect(screen.getByRole("option", { name: /UAH · .+/ })).toBeTruthy();
  });
});
