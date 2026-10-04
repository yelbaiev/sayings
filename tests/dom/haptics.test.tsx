import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic } from "~/lib/haptics";

/** Android-only vibration: three fixed strengths, and silence everywhere it is not offered. */

afterEach(() => {
  delete (navigator as { vibrate?: unknown }).vibrate;
});

describe("haptic", () => {
  it("uses one pattern per meaning", () => {
    const vibrate = vi.fn(() => true);
    Object.assign(navigator, { vibrate });
    haptic("tap");
    haptic("confirm");
    haptic("warning");
    expect(vibrate.mock.calls).toEqual([[10], [18], [[25, 60, 25]]]);
  });

  it("is silent where there is no Vibration API — every iPhone", () => {
    expect("vibrate" in navigator).toBe(false);
    expect(() => haptic("confirm")).not.toThrow();
  });

  it("never lets a refusal reach the screen", () => {
    Object.assign(navigator, {
      vibrate: () => {
        throw new Error("blocked before a user gesture");
      },
    });
    expect(() => haptic("tap")).not.toThrow();
  });
});
