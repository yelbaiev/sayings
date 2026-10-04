import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@shared/schema";
import { renderInApp } from "./harness";

/**
 * The repeat item in the + menu. It used to be a hold that fired straight away, unnamed; in the
 * menu it says what it will repeat, so the extra tap buys knowing what is about to be recorded.
 */

vi.mock("~/db/queries", () => ({
  useCategories: () => [{ id: "cat_cafe", name: "Кафе", icon: "☕" }],
}));

const { AddMenu } = await import("~/app/AddMenu");

const last = {
  id: "t1",
  kind: "expense",
  category_id: "cat_cafe",
  amount_minor: 4_500,
  currency: "UAH",
} as Transaction;

describe("Repeat last in the + menu", () => {
  it("leads the menu, names the category and amount, and repeats on a tap", () => {
    const onRepeat = vi.fn();
    const onOpenChange = vi.fn();
    renderInApp(
      <AddMenu open onOpenChange={onOpenChange} lastTransaction={last} onPick={vi.fn()} onRepeat={onRepeat}>
        <button type="button">+</button>
      </AddMenu>,
    );

    const [first] = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(first!.textContent).toMatch(/Повторить последнюю · Кафе/u);
    expect(first!.textContent).toMatch(/45/u);

    fireEvent.click(first!);
    expect(onRepeat).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
