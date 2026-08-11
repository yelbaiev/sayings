import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Account, Category } from "@shared/schema";
import { QuickTileSheet } from "~/features/home/QuickTiles";
import { renderInApp } from "./harness";

/**
 * The scar tissue from one specific report: "Выберите счёт" shown next to an account that plainly
 * was chosen.
 *
 * The cause was not the message. A `<select>` whose `value` matches none of its `<option>`s does not
 * render empty — the browser draws the first option — so the sheet displayed an account while holding
 * no selection, and the validation was right and the screen was lying. It happened because the sheet
 * queried Dexie itself and its `useState` initialiser ran before that resolved, seeing `[]`.
 *
 * Two things keep it fixed, and both are asserted here: the data arrives as props from a component
 * that has been mounted long enough to have it, and every such select carries an explicit empty
 * option so "nothing selected" has something to render as.
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

const open = (accounts: Account[], categories: Category[]) =>
  renderInApp(
    <QuickTileSheet
      count={0}
      accounts={accounts}
      expenseCategories={categories}
      incomeCategories={[]}
      last={undefined}
      onClose={() => undefined}
    />,
  );

describe("QuickTileSheet", () => {
  it("offers an empty option on the account select, so no selection can render as one", () => {
    /*
     * Remove this option and the bug returns silently: the select would show the first account while
     * the component held "", and the only symptom would be a validation message contradicting the
     * screen.
     */
    open([account("a1", "Моно"), account("a2", "Приват")], [category("c1", "Продукты")]);
    const select = screen.getByLabelText("Счёт", { selector: "select" });
    const options = [...select.querySelectorAll("option")];
    expect(options[0]!.value).toBe("");
    expect(options[0]!.textContent).toBe("—");
  });

  it("offers an empty option on the category select too", () => {
    open([account("a1", "Моно")], [category("c1", "Продукты")]);
    const select = screen.getByLabelText("Категория", { selector: "select" });
    expect([...select.querySelectorAll("option")][0]!.value).toBe("");
  });

  it("claims nothing when the account list is empty", () => {
    // The state the sheet used to open in — before Dexie resolved. With props it cannot happen, and
    // if it somehow did, the select holds "" rather than appearing to have picked something.
    open([], [category("c1", "Продукты")]);
    const select = screen.getByLabelText("Счёт", { selector: "select" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.querySelectorAll("option")).toHaveLength(1);
  });

  it("lists every account it is given, so nothing is silently unreachable", () => {
    open([account("a1", "Моно"), account("a2", "Приват"), account("a3", "Евро")], []);
    const select = screen.getByLabelText("Счёт", { selector: "select" });
    // Three accounts plus the empty option.
    expect(select.querySelectorAll("option")).toHaveLength(4);
  });
});
