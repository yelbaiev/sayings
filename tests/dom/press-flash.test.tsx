import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderInApp } from "./harness";
import { installPressFlash } from "~/lib/press-flash";
import { Button } from "~/ui/Button";
import { EMPTY_EXPRESSION } from "~/lib/calc";
import { Keypad } from "~/features/entry/Keypad";

/**
 * The delegated flash against real components, rather than against hand-written markup.
 *
 * The unit tests cover which elements qualify; what these cover is the wiring — that a `Button`
 * rendered by this app matches the listener's selector, and that the keypad, which animates its own
 * presses, is left alone by it.
 */

let teardown = () => undefined as void;

beforeEach(() => {
  teardown = installPressFlash();
});

afterEach(() => {
  teardown();
});

describe("the app-wide press flash", () => {
  it("marks a button the moment it is pressed", () => {
    renderInApp(<Button>Сохранить</Button>);
    const button = screen.getByRole("button", { name: "Сохранить" });

    expect(button.className).not.toContain("press-flash");
    fireEvent.pointerDown(button);
    expect(button.className).toContain("press-flash");
  });

  it("leaves the keypad to its own, louder flash", () => {
    /*
     * Both animations set `transform`, so the second one applied wins and the pad's press would
     * become whichever the browser happened to order last. The pad opts out; this is the assertion
     * that says so.
     */
    renderInApp(
      <Keypad expression={EMPTY_EXPRESSION} currency="UAH" onChange={() => undefined} />,
    );
    const seven = screen.getByRole("button", { name: "7" });

    fireEvent.pointerDown(seven);
    expect(seven.className).toContain("keypad__key--flash");
    expect(seven.className).not.toContain("press-flash ");
    expect(seven.className.split(/\s+/)).not.toContain("press-flash");
  });
});
