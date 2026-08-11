import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "~/ui";
import { renderInApp } from "./harness";

/**
 * The sheet, which is how every form in this app appears — vaul Drawer on a phone, Radix Dialog on
 * a desktop, one wrapper and one API over both (ADR 0006).
 *
 * The harness's matchMedia stub answers false to every query, so these tests exercise the drawer
 * branch — which is the branch phones use, and phones are where this app lives. What the primitives
 * now own (focus trap, Escape, the iOS-honoured scroll lock, drag physics) is deliberately not
 * re-tested here; what *is* tested is our wiring of them, because a sheet with no working exit is a
 * trap, and this app shipped one for three releases.
 */

const open = (onClose = vi.fn()) => {
  renderInApp(
    <Sheet title="Добавить" onClose={onClose}>
      <p>body</p>
    </Sheet>,
  );
  return onClose;
};

describe("Sheet", () => {
  it("is a modal dialog named by its title", () => {
    open();
    // The name arrives via the visually-hidden DrawerTitle — exactly what a screen reader uses.
    const dialog = screen.getByRole("dialog", { name: "Добавить" });
    expect(dialog).toBeTruthy();
  });

  it("renders in a portal, so page overflow cannot clip it", () => {
    // The old sheet rendered inline; a transformed or overflow-clipped ancestor could swallow it.
    const { container } = renderInApp(
      <Sheet title="Добавить" onClose={() => undefined}>
        <p>body</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("closes on the close button", () => {
    const onClose = open();
    // Found by its accessible name, in Russian, exactly as a screen reader would.
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on other keys", () => {
    // A keypad digit, a Tab, a stray letter — none of these are an exit.
    const onClose = open();
    const dialog = screen.getByRole("dialog");
    for (const key of ["Enter", "Tab", "5", "t"]) fireEvent.keyDown(dialog, { key });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders its footer, which is where the primary action lives", () => {
    renderInApp(
      <Sheet
        title="Добавить"
        onClose={() => undefined}
        footer={<button type="button">Сохранить</button>}
      >
        <p>body</p>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeTruthy();
  });

  it("marks the footer as not-a-drag-surface", () => {
    /*
     * The footer holds the custom keypad. A drag that starts on a keypad key must type, never
     * dismiss — the same rule the hand-rolled sheet enforced by refusing pointer capture on
     * controls, now expressed as vaul's own opt-out attribute.
     */
    renderInApp(
      <Sheet
        title="Добавить"
        onClose={() => undefined}
        footer={<button type="button">Сохранить</button>}
      >
        <p>body</p>
      </Sheet>,
    );
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save.closest("[data-vaul-no-drag]")).not.toBeNull();
  });

  it("keeps the dismiss after the title, on the trailing edge", () => {
    // The receipt viewer once grew its own dialog with the dismiss on the left; the wrapper is
    // what makes that impossible now, so the wrapper is where the property is checked.
    open();
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Закрыть" });
    const header = close.parentElement!;
    expect(dialog.contains(header)).toBe(true);
    expect(header.lastElementChild).toBe(close);
  });
});
