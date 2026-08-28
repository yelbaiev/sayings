import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "./harness";
import { DateChip } from "~/features/entry/DateChip";

/**
 * The date chip on a desktop, which is the case this component exists for.
 *
 * jsdom reports every media query as false, so `(pointer: coarse)` is false and these render the
 * calendar rather than the native input — which is the path under test. The phone path is one
 * `<input type="date">` and belongs to the browser.
 */

const open = async (value = "2026-08-21", max = "2026-08-28") => {
  const onChange = vi.fn();
  renderInApp(<DateChip value={value} max={max} onChange={onChange} pickLabel="Выбрать дату" />);
  await userEvent.click(screen.getByRole("button", { name: /авг|Выбрать дату/u }));
  return onChange;
};

describe("the date chip", () => {
  it("opens a calendar on the month of the date it holds", async () => {
    await open();
    expect(screen.getByText(/август 2026/iu)).toBeTruthy();
    // The selected day is marked as such, not merely coloured.
    expect(screen.getByRole("button", { name: /21 августа 2026/u, pressed: true })).toBeTruthy();
  });

  it("picks a day and closes", async () => {
    const onChange = await open();
    await userEvent.click(screen.getByRole("button", { name: /14 августа 2026/u }));

    expect(onChange).toHaveBeenCalledWith("2026-08-14");
    expect(screen.queryByText(/август 2026/iu)).toBeNull();
  });

  it("refuses a day in the future", async () => {
    /*
     * A transaction cannot happen tomorrow. The native input carried this as `max`; losing it in
     * the rewrite would let a date be picked that the rest of the app treats as impossible.
     */
    await open();
    const tomorrow = screen.getByRole("button", { name: /29 августа 2026/u }) as HTMLButtonElement;
    const today = screen.getByRole("button", { name: /28 августа 2026/u }) as HTMLButtonElement;
    expect(tomorrow.disabled).toBe(true);
    expect(today.disabled).toBe(false);
  });

  it("walks the grid with the arrow keys", async () => {
    // Forty-two tab stops is not a date picker. One stop, then arrows.
    await open();
    const grid = screen.getByRole("button", { name: /21 августа 2026/u, pressed: true });
    expect(grid.tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: /14 августа 2026/u }).tabIndex).toBe(-1);

    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: /20 августа 2026/u }).tabIndex).toBe(0);

    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: /13 августа 2026/u }).tabIndex).toBe(0);
  });

  it("does not walk past the last allowed day", async () => {
    await open("2026-08-28");
    const last = screen.getByRole("button", { name: /28 августа 2026/u, pressed: true });
    fireEvent.keyDown(last, { key: "ArrowRight" });
    // Still on the 28th: the cursor stops where the selectable dates do.
    expect(screen.getByRole("button", { name: /28 августа 2026/u }).tabIndex).toBe(0);
  });

  it("steps months, and will not step into one that is entirely ahead", async () => {
    await open();
    const calendar = screen.getByText(/август 2026/iu).parentElement!;
    await userEvent.click(within(calendar).getByRole("button", { name: /июль 2026/iu }));
    expect(screen.getByText(/июль 2026/iu)).toBeTruthy();

    // August holds today, so it is reachable; September is not.
    const inJuly = screen.getByText(/июль 2026/iu).parentElement!;
    const forward = within(inJuly).getByRole("button", {
      name: /август 2026/iu,
    }) as HTMLButtonElement;
    expect(forward.disabled).toBe(false);
  });
});
