// @vitest-environment jsdom
// The fallback path is DOM-shaped: it appends a hidden element and clicks it. jsdom also happens
// to be a faithful stand-in for Safari here — neither implements `navigator.vibrate`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetHaptics, tapFeedback } from "~/lib/haptics";

/**
 * Both routes to a haptic tick, because the two platforms this app runs on disagree about whether
 * a web page may ask for one at all. The fallback is the whole reason the module exists: the phone
 * it matters on is the one where `navigator.vibrate` does not exist.
 */

const stubVibrate = (implementation: ((pattern: number) => boolean) | undefined) => {
  Object.defineProperty(navigator, "vibrate", {
    value: implementation,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  resetHaptics();
  stubVibrate(undefined);
  vi.restoreAllMocks();
});

const hiddenSwitch = () => document.querySelector("input[switch]");

describe("tapFeedback", () => {
  it("vibrates where the platform implements it", () => {
    const vibrate = vi.fn(() => true);
    stubVibrate(vibrate);

    tapFeedback();

    expect(vibrate).toHaveBeenCalledWith(8);
    // One tick is enough: nothing was appended to the document to get it.
    expect(hiddenSwitch()).toBeNull();
  });

  it("falls back to a hidden switch where it does not — which is every iPhone", () => {
    // jsdom has no `navigator.vibrate`, exactly like Safari.
    expect(navigator.vibrate).toBeUndefined();

    tapFeedback();

    const input = hiddenSwitch();
    expect(input).toBeTruthy();
    // Hidden from sight and from a screen reader, but rendered: an element the browser is not
    // drawing does not play the system haptic.
    expect(input?.getAttribute("aria-hidden")).toBe("true");
    expect((input as HTMLInputElement).style.display).not.toBe("none");
  });

  it("moves the switch on every press, since the movement is what plays the haptic", () => {
    /*
     * The trap this pins: setting `checked` *and* clicking toggles twice and lands back where it
     * started, so the switch never visibly moves and iOS plays nothing. Only the click may touch
     * the state.
     */
    tapFeedback();
    const input = hiddenSwitch() as HTMLInputElement;

    const before = input.checked;
    tapFeedback();
    expect(input.checked).toBe(!before);
    tapFeedback();
    expect(input.checked).toBe(before);
  });

  it("builds the switch once, not once per keypress", () => {
    tapFeedback();
    tapFeedback();
    tapFeedback();
    expect(document.querySelectorAll("input[switch]")).toHaveLength(1);
  });

  it("falls through to the switch when the browser refuses the vibration", () => {
    // Chrome returns false rather than throwing when there has been no user gesture yet.
    stubVibrate(() => false);
    tapFeedback();
    expect(hiddenSwitch()).toBeTruthy();
  });
});
