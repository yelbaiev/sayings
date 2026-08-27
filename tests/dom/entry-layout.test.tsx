import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account, Category } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * That the entry form is complete on screen, and stays that way.
 *
 * Written from a bug report. People entered an amount, tapped a category and saved without ever
 * seeing the date or the note: the keypad takes a third of the screen, the category grid was the
 * tallest thing on the form and sat in the middle, and everything below it fell out of view with
 * nothing to say it existed. A ledger fills with today's date and no comments and nothing looks
 * wrong.
 *
 * The fix is structural rather than cosmetic, so the tests are about structure. Pickers open in a
 * sheet *over* the form, which means the form's height cannot depend on what has been tapped — and
 * "the keypad hides nothing" stops being something to re-check per screen size. The assertions below
 * are the two halves of that: every field is present at every moment, and the form does not reflow.
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

/** More than the seven the old inline grid could show, which is the point of the sheet. */
const CATEGORIES = [
  "Продукты",
  "Кафе",
  "Транспорт",
  "Дом",
  "Здоровье",
  "Одежда",
  "Развлечения",
  "Подарки",
  "Связь",
].map((name, index) => category(`cat_${index}`, name));

vi.mock("~/db/queries", () => ({
  useAccounts: () => [account("acc_mono", "Моно"), account("acc_privat", "Приват")],
  useCategories: () => CATEGORIES,
  useMembers: () => [],
  useTransactions: () => [],
  useLookups: () => ({ accounts: new Map(), categories: new Map(), members: new Map() }),
  useTransactionCount: () => 0,
  useBalances: () => [],
  useAccount: () => undefined,
}));

vi.mock("~/lib/fx", () => ({ rateFor: () => Promise.resolve({ rate: 1, estimated: false }) }));

const { EntrySheet } = await import("~/features/entry/EntrySheet");

const open = () =>
  renderInApp(<EntrySheet onClose={() => undefined} onSaved={() => undefined} />);

/** What the form must always be showing, by the name a person would look for. */
const FIELDS = ["Сегодня", "Счёт", "Категория"];

describe("the entry form", () => {
  it("shows every field before anything is entered", async () => {
    open();
    for (const label of FIELDS) {
      expect(await screen.findByText(label), label).toBeTruthy();
    }
    expect(screen.getByLabelText("Заметка")).toBeTruthy();
  });

  it("still shows every field with the keypad open", async () => {
    /*
     * The bug, stated as an assertion. Tapping the amount used to bury the date and the note under a
     * keypad with no way out, so they might as well not have existed.
     */
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));
    expect(document.querySelector(".keypad")).toBeTruthy();

    for (const label of FIELDS) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
    expect(screen.getByLabelText("Заметка")).toBeTruthy();
  });

  it("does not reflow when the keypad opens", async () => {
    /*
     * The property the whole redesign rests on, and the one a screenshot cannot check. If opening the
     * pad changes what the form contains, then whether a field is visible depends on the device, and
     * no amount of testing on one phone would settle it.
     */
    open();
    await screen.findByText("Категория");
    const before = document.querySelectorAll('[data-slot="entry-row"]').length;

    await userEvent.click(screen.getByLabelText("Сумма"));
    expect(document.querySelectorAll('[data-slot="entry-row"]')).toHaveLength(before);
  });

  it("chooses a category in a sheet over the form, not by growing it", async () => {
    open();
    await userEvent.click(await screen.findByText("Выберите категорию"));

    // Every category, not the seven that happened to fit inline.
    const dialogs = screen.getAllByRole("dialog");
    const picker = dialogs[dialogs.length - 1]!;
    expect(within(picker).getAllByRole("button", { pressed: false }).length).toBeGreaterThan(7);

    await userEvent.click(within(picker).getByText("Связь"));
    expect(screen.queryByText("Выберите категорию")).toBeNull();
    expect(screen.getByText("Связь")).toBeTruthy();
    // And the form is the same size it was.
    expect(document.querySelectorAll('[data-slot="entry-row"]')).toHaveLength(2);
  });

  it("filters the category sheet rather than making people scroll", async () => {
    open();
    await userEvent.click(await screen.findByText("Выберите категорию"));

    const dialogs = screen.getAllByRole("dialog");
    const picker = dialogs[dialogs.length - 1]!;
    await userEvent.type(within(picker).getByRole("searchbox"), "каф");

    expect(within(picker).getByText("Кафе")).toBeTruthy();
    expect(within(picker).queryByText("Продукты")).toBeNull();
  });

  it("has exactly one save control, whether or not the keypad is open", async () => {
    // There used to be two — a key on the pad and a button in the footer — so the control that
    // commits an entry moved depending on whether the pad happened to be up.
    open();
    await screen.findByText("Категория");
    expect(screen.getAllByRole("button", { name: "Сохранить" })).toHaveLength(1);

    await userEvent.click(screen.getByLabelText("Сумма"));
    expect(screen.getAllByRole("button", { name: "Сохранить" })).toHaveLength(1);
  });

  it("names a field even when it has no answer yet", async () => {
    // A blank row still occupies its line, so the form does not change shape as it is filled in.
    open();
    expect(await screen.findByText("Выберите категорию")).toBeTruthy();
  });
});

describe("the action bar when editing", () => {
  it("keeps row actions off the bar, so Save cannot be overlapped", async () => {
    /*
     * Reported from a screenshot: editing a transaction put photo, split, make-recurring and Save
     * on one line of non-shrinking buttons, and Save printed over its neighbour. The bar is for
     * the entry being typed; actions on the *saved* row — make recurring, delete — live together
     * at the end of the form.
     */
    const editing = {
      id: "t1",
      kind: "expense",
      occurred_on: "2026-08-07",
      account_id: "acc_mono",
      to_account_id: null,
      category_id: "cat_0",
      amount_minor: 4602,
      currency: "UAH",
      base_amount_minor: 4602,
      fx_rate: 1,
      fx_estimated: 0,
      note: null,
      receipt_key: null,
    } as never;

    renderInApp(
      <EntrySheet editing={editing} onClose={() => undefined} onSaved={() => undefined} />,
    );

    const save = await screen.findByRole("button", { name: "Сохранить" });
    const bar = save.parentElement!;
    const recurring = screen.getByRole("button", { name: "Сделать регулярной" });
    const del = screen.getByRole("button", { name: "Удалить" });

    expect(bar.contains(recurring)).toBe(false);
    expect(bar.contains(del)).toBe(false);
    // And the two row actions share a container, deliberately at opposite ends.
    expect(recurring.parentElement).toBe(del.parentElement);
  });
});

describe("the pending decimal separator", () => {
  it("echoes the comma the moment it is typed", async () => {
    /*
     * "45," parses to the same minor units as "45", so the formatted figure swallowed the comma
     * and the key looked dead until a fraction digit arrived — reported as the comma "not drawing".
     * The separator must appear immediately, after the digits and before the currency symbol.
     */
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));
    await userEvent.click(screen.getByRole("button", { name: "4" }));
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    await userEvent.click(screen.getByRole("button", { name: "Дробная часть" }));

    const amount = screen.getByLabelText("Сумма");
    // The comma sits inside the figure, straight after the digits — not appended past the symbol.
    expect(amount.textContent).toMatch(/45,\s*₴/u);

    // And typing the fraction digit replaces the pending state with the real figure.
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    expect(amount.textContent).toMatch(/45,5/u);
  });
});

describe("the amount display", () => {
  /** Taps the pad, by the labels the keys carry. */
  const press = async (...labels: string[]) => {
    for (const label of labels) {
      await userEvent.click(screen.getByRole("button", { name: label }));
    }
  };

  const shown = () => screen.getByLabelText("Сумма").textContent ?? "";

  it("shows the working while it is being typed, and the answer only after =", async () => {
    /*
     * The old display showed the running total in the biggest type on screen: "120 + 45" drew as
     * 165, a number nobody had typed, and the terms that made it were gone. Now the line echoes
     * the keys, and only = collapses it.
     */
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));

    await press("1", "2", "0");
    expect(shown()).toMatch(/^120\s*₴$/u);

    await press("Плюс");
    expect(shown()).toBe("120 +");

    await press("4", "5");
    expect(shown()).toBe("120 + 45");

    // Still the working, not the answer — the third term joins the line rather than replacing it.
    await press("Плюс", "9", "0");
    expect(shown()).toBe("120 + 45 + 90");

    await press("Равно");
    expect(shown()).toMatch(/^255\s*₴$/u);
  });

  it("moves on every keypress after the separator", async () => {
    // The report: "I don't see any changes before I put 40 if I need xx,40".
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));

    await press("4", "5", "Дробная часть");
    expect(shown()).toMatch(/^45,\s*₴$/u);
    await press("4");
    expect(shown()).toMatch(/^45,4\s*₴$/u);
    await press("0");
    expect(shown()).toMatch(/^45,40\s*₴$/u);
  });

  it("starts a whole new number after =, not just its last digit", async () => {
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));

    await press("1", "2", "0", "Плюс", "3", "0", "Равно");
    await press("5", "3");
    expect(shown()).toMatch(/^53\s*₴$/u);
  });
});

describe("the empty amount field", () => {
  const shown = () => screen.getByLabelText("Сумма").textContent ?? "";

  it("shows a zero until it is tapped, then waits empty", async () => {
    /*
     * A `0` in an active field is a value the field does not have: the first digit looks like it
     * replaced something. Closed, the zero stays — a blank field with no pad under it reads as
     * broken rather than as ready.
     */
    open();
    expect(shown()).toMatch(/^0\s*₴$/u);

    await userEvent.click(await screen.findByLabelText("Сумма"));
    expect(shown()).toBe("");
  });

  it("fills from the first digit and empties again on backspace", async () => {
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));

    await userEvent.click(screen.getByRole("button", { name: "7" }));
    expect(shown()).toMatch(/^7\s*₴$/u);

    await userEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(shown()).toBe("");
  });
});

describe("keypad feedback", () => {
  const shown = () => screen.getByLabelText("Сумма").textContent ?? "";

  it("registers the press on the way down, not on the lift", async () => {
    /*
     * Waiting for the lift costs the length of the press, and a press that slides a few pixels off
     * its key produces no click at all — which is how a fast run of digits quietly loses one.
     */
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));

    fireEvent.pointerDown(screen.getByRole("button", { name: "7" }));
    expect(shown()).toMatch(/^7/u);
  });

  it("counts a press once, not once down and once up", async () => {
    // The pointer path and the click path both fire the key; only one of them may win per press.
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));

    await userEvent.click(screen.getByRole("button", { name: "7" }));
    expect(shown()).toMatch(/^7\s*₴$/u);
  });

  it("marks the key it fired, so the press is visible however briefly it was held", async () => {
    open();
    await userEvent.click(await screen.findByLabelText("Сумма"));

    const seven = screen.getByRole("button", { name: "7" });
    fireEvent.pointerDown(seven);
    expect(seven.className).toContain("keypad__key--flash");
  });
});
