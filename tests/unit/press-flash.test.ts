// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { flash, installPressFlash, pressableFrom } from "~/lib/press-flash";

/**
 * Which presses light up, and which deliberately do not.
 *
 * Every rule here is a bug that would otherwise be found on a phone: a disabled button claiming it
 * took a press, or two animations fighting over one `transform` on the keypad.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

const render = (html: string) => {
  document.body.innerHTML = html;
  return document.body;
};

describe("pressableFrom", () => {
  it("finds the control a press inside it belongs to", () => {
    render(`<button id="b"><span id="label">Save</span></button>`);
    // The press lands on the label; the button is what flashes.
    expect(pressableFrom(document.getElementById("label"))?.id).toBe("b");
  });

  it("takes anything that behaves like a button", () => {
    render(`<div role="button" id="d"></div><a href="/x" id="a"></a>`);
    expect(pressableFrom(document.getElementById("d"))?.id).toBe("d");
    expect(pressableFrom(document.getElementById("a"))?.id).toBe("a");
  });

  it("ignores plain text", () => {
    render(`<p id="p">an amount</p>`);
    expect(pressableFrom(document.getElementById("p"))).toBeNull();
    expect(pressableFrom(null)).toBeNull();
  });

  it("refuses a disabled control, which did not take the press", () => {
    render(`<button id="b" disabled></button><button id="c" aria-disabled="true"></button>`);
    expect(pressableFrom(document.getElementById("b"))).toBeNull();
    expect(pressableFrom(document.getElementById("c"))).toBeNull();
  });

  it("stays out of a subtree that animates its own presses", () => {
    // The keypad, the FAB and the hold-to-delete strip. Two animations, one transform.
    render(`<div data-press-flash="off"><button id="key"></button></div>`);
    expect(pressableFrom(document.getElementById("key"))).toBeNull();
  });
});

describe("flash", () => {
  it("restarts on a second press of the same control", () => {
    /*
     * Without the layout read inside `flash`, removing and re-adding the class in one go is no
     * change at all to the browser, and the repeat press — every "00", every held backspace —
     * shows nothing.
     */
    render(`<button id="b"></button>`);
    const button = document.getElementById("b")!;

    flash(button);
    expect(button.className).toContain("press-flash");
    button.classList.remove("press-flash");
    flash(button);
    expect(button.className).toContain("press-flash");
  });

  it("takes the class the caller asks for, so the keypad can be louder", () => {
    render(`<button id="b"></button>`);
    const button = document.getElementById("b")!;
    flash(button, "keypad__key--flash");
    expect(button.className).toBe("keypad__key--flash");
  });
});

describe("installPressFlash", () => {
  it("marks a pressed control and clears it when the animation ends", () => {
    const teardown = installPressFlash();
    render(`<button id="b"></button>`);
    const button = document.getElementById("b")!;

    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(button.className).toContain("press-flash");

    button.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(button.className).not.toContain("press-flash");

    teardown();
  });

  it("hears presses that a component stops from bubbling", () => {
    // The swipe row stops propagation on its own handlers; the listener captures for that reason.
    const teardown = installPressFlash();
    render(`<div id="row"><button id="b"></button></div>`);
    document
      .getElementById("row")!
      .addEventListener("pointerdown", (event) => event.stopPropagation());

    document.getElementById("b")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.getElementById("b")!.className).toContain("press-flash");

    teardown();
  });

  it("stops when torn down", () => {
    const teardown = installPressFlash();
    teardown();
    render(`<button id="b"></button>`);
    document.getElementById("b")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.getElementById("b")!.className).toBe("");
  });
});
