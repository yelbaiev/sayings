import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { renderInApp } from "./harness";
import { AmountField } from "~/features/entry/AmountField";

/**
 * The amount field the forms use — budgets, opening balances, recurring, quick tiles, split lines
 * and a transfer's second leg.
 *
 * All six used to take money through a plain text input while the entry sheet had a calculator.
 * What these tests pin is the contract that let them all change at once: the field speaks minor
 * units, so no call site does its own parsing or its own scaling, and every one of those was a
 * place a `/100` could be wrong for a currency that is not the hundredth kind.
 */

function Harness({ onChange = vi.fn() }: { onChange?: (minor: number | null) => void }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <AmountField
      valueMinor={value}
      currency="UAH"
      onChange={(minor) => {
        setValue(minor);
        onChange(minor);
      }}
      label="Сумма"
    />
  );
}

const press = async (...labels: string[]) => {
  for (const label of labels) {
    await userEvent.click(screen.getByRole("button", { name: label }));
  }
};

describe("AmountField", () => {
  it("opens the pad on a tap and reports minor units", async () => {
    const onChange = vi.fn();
    renderInApp(<Harness onChange={onChange} />);

    const field = screen.getByRole("button", { name: "Сумма" });
    expect(screen.queryByRole("button", { name: "7" })).toBeNull();

    await userEvent.click(field);
    await press("1", "2", "Дробная часть", "5", "0");

    // 12.50 in a currency with hundredths — not 1250, and not 12.5 as a float.
    expect(onChange).toHaveBeenLastCalledWith(1250);
    expect(field.textContent).toMatch(/12,50/u);
  });

  it("does the arithmetic the plain input could not", async () => {
    const onChange = vi.fn();
    renderInApp(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Сумма" }));
    await press("1", "2", "0", "Плюс", "4", "5", "Равно");

    expect(onChange).toHaveBeenLastCalledWith(16_500);
  });

  it("reports nothing typed as null rather than as zero", async () => {
    // A budget of nothing and a budget of zero are different claims; so are an account opened at
    // nothing and one opened at zero. The callers decide which, so the field must not.
    const onChange = vi.fn();
    renderInApp(<Harness onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Сумма" }));
    await press("7", "Назад");

    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("hands the pad over rather than opening two at once", async () => {
    /*
     * A split sheet holds one of these per line. Two open pads is a form that has lost track of
     * which number is being typed.
     */
    renderInApp(
      <>
        <Harness />
        <Harness />
      </>,
    );

    const [first, second] = screen.getAllByRole("button", { name: "Сумма" });
    await userEvent.click(first!);
    expect(screen.getAllByRole("button", { name: "7" })).toHaveLength(1);

    await userEvent.click(second!);
    expect(screen.getAllByRole("button", { name: "7" })).toHaveLength(1);
    expect(second!.getAttribute("aria-expanded")).toBe("true");
    expect(first!.getAttribute("aria-expanded")).toBe("false");
  });
});
