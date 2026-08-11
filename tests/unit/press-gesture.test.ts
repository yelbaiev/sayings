import { describe, expect, it, vi } from "vitest";
import { createPressGesture } from "~/lib/press-gesture";

/** Controllable clock, so the tests need no real waiting and no fake-timer globals. */
function harness(opts: { withLongPress: boolean; holdMs?: number } = { withLongPress: true }) {
  const onTap = vi.fn();
  const onLongPress = vi.fn();
  let pending: (() => void) | null = null;

  const gesture = createPressGesture({
    onTap,
    onLongPress: opts.withLongPress ? onLongPress : undefined,
    ...(opts.holdMs !== undefined ? { holdMs: opts.holdMs } : {}),
    schedule: (fn) => {
      pending = fn;
      return 1;
    },
    cancelScheduled: () => {
      pending = null;
    },
  });

  return {
    gesture,
    onTap,
    onLongPress,
    /** Advances past the hold threshold. */
    hold: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    hasPendingHold: () => pending !== null,
  };
}

describe("tap", () => {
  it("fires on press then release", () => {
    const h = harness();
    h.gesture.down();
    h.gesture.up();
    expect(h.onTap).toHaveBeenCalledTimes(1);
    expect(h.onLongPress).not.toHaveBeenCalled();
  });

  it("fires even when no long press is available", () => {
    // THE REGRESSION. The shipped version armed its timer only when a previous transaction
    // existed, then opened the sheet only if that timer had been armed — so on an empty ledger
    // the add button did nothing, and it was the only way to create the first transaction.
    const h = harness({ withLongPress: false });
    h.gesture.down();
    h.gesture.up();
    expect(h.onTap).toHaveBeenCalledTimes(1);
  });

  it("does not arm a hold timer when there is nothing to repeat", () => {
    const h = harness({ withLongPress: false });
    h.gesture.down();
    expect(h.hasPendingHold()).toBe(false);
    expect(h.gesture.isPending()).toBe(false);
  });

  it("fires once per gesture, not once per event", () => {
    const h = harness();
    h.gesture.down();
    h.gesture.up();
    h.gesture.up(); // a stray second release must not double-open
    expect(h.onTap).toHaveBeenCalledTimes(1);
  });

  it("works repeatedly", () => {
    const h = harness();
    for (let i = 0; i < 3; i++) {
      h.gesture.down();
      h.gesture.up();
    }
    expect(h.onTap).toHaveBeenCalledTimes(3);
  });
});

describe("long press", () => {
  it("fires once the hold threshold passes", () => {
    const h = harness();
    h.gesture.down();
    h.hold();
    expect(h.onLongPress).toHaveBeenCalledTimes(1);
  });

  it("suppresses the tap that would otherwise follow release", () => {
    // Otherwise a long press would both repeat the last transaction and open the sheet.
    const h = harness();
    h.gesture.down();
    h.hold();
    h.gesture.up();
    expect(h.onLongPress).toHaveBeenCalledTimes(1);
    expect(h.onTap).not.toHaveBeenCalled();
  });

  it("does not fire when released before the threshold", () => {
    const h = harness();
    h.gesture.down();
    h.gesture.up();
    expect(h.onLongPress).not.toHaveBeenCalled();
    expect(h.hasPendingHold()).toBe(false);
  });

  it("clears its timer on release, so it cannot fire afterwards", () => {
    const h = harness();
    h.gesture.down();
    h.gesture.up();
    h.hold(); // no-op: the timer was cancelled
    expect(h.onLongPress).not.toHaveBeenCalled();
  });
});

describe("cancel", () => {
  it("fires neither callback when the pointer leaves the button", () => {
    const h = harness();
    h.gesture.down();
    h.gesture.cancel();
    expect(h.onTap).not.toHaveBeenCalled();
    expect(h.onLongPress).not.toHaveBeenCalled();
    expect(h.hasPendingHold()).toBe(false);
  });

  it("means a later release does nothing", () => {
    // Dragging off the button and lifting elsewhere must not count as a tap.
    const h = harness();
    h.gesture.down();
    h.gesture.cancel();
    h.gesture.up();
    expect(h.onTap).not.toHaveBeenCalled();
  });

  it("leaves the gesture usable afterwards", () => {
    const h = harness();
    h.gesture.down();
    h.gesture.cancel();
    h.gesture.down();
    h.gesture.up();
    expect(h.onTap).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a suppressed tap after a long press", () => {
    const h = harness();
    h.gesture.down();
    h.hold();
    h.gesture.cancel();
    h.gesture.up();
    expect(h.onTap).not.toHaveBeenCalled();
  });
});

describe("re-press while a hold is outstanding", () => {
  it("restarts the timer rather than stacking two", () => {
    const h = harness();
    h.gesture.down();
    h.gesture.down();
    h.hold();
    expect(h.onLongPress).toHaveBeenCalledTimes(1);
  });
});
