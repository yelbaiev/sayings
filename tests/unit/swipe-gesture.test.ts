import { describe, expect, it } from "vitest";
import {
  SWIPE_IDLE,
  swipeMove,
  swipeRelease,
  type SwipeConfig,
  type SwipeState,
} from "~/lib/swipe-gesture";

/**
 * The reported symptom was that swipe-to-delete "works jerkily and unreliably". Each case below is
 * one of the reasons why.
 */

const config: SwipeConfig = {
  width: 400,
  reveal: 88,
  commitFraction: 0.45,
  engageSlop: 10,
  hasLeft: true,
  hasRight: true,
};

const pressed: SwipeState = { phase: "pending", offset: 0 };
/** Applies a sequence of pointer positions relative to the press. */
const drag = (state: SwipeState, points: [number, number][], cfg = config) =>
  points.reduce((current, [dx, dy]) => swipeMove(current, dx, dy, cfg), state);

describe("swipeMove — engaging", () => {
  it("ignores movement below the slop", () => {
    expect(swipeMove(pressed, 6, 2, config)).toEqual({ phase: "pending", offset: 0 });
  });

  it("engages once the movement is clearly horizontal", () => {
    expect(swipeMove(pressed, -40, 4, config)).toEqual({ phase: "engaged", offset: -40 });
  });

  it("abandons a clearly vertical movement", () => {
    expect(swipeMove(pressed, 3, 40, config)).toEqual({ phase: "abandoned", offset: 0 });
  });

  it("survives a diagonal start", () => {
    // This is the big one. `|dy| > |dx|` abandoned about half of all real swipes on their first
    // event, because fingers travel in arcs and a mouse never moves along an axis. The row then
    // refused to swipe at all until you let go and tried again — the "unreliable" complaint.
    expect(drag(pressed, [[12, 11]]).phase).toBe("engaged");
    expect(drag(pressed, [[-14, 12]]).phase).toBe("engaged");
  });

  it("never re-engages once abandoned, so a scroll cannot turn into a swipe", () => {
    const abandoned = drag(pressed, [[2, 40]]);
    expect(abandoned.phase).toBe("abandoned");
    expect(drag(abandoned, [[-120, 0]])).toEqual({ phase: "abandoned", offset: 0 });
  });
});

describe("swipeMove — tracking", () => {
  it("follows the finger once engaged", () => {
    expect(drag(pressed, [[-40, 0], [-90, 3], [-140, 6]]).offset).toBe(-140);
  });

  it("resists past three quarters of the row", () => {
    expect(drag(pressed, [[-2000, 0]]).offset).toBe(-300);
    expect(drag(pressed, [[2000, 0]]).offset).toBe(300);
  });

  it("goes home when swiped towards a side that has no action", () => {
    // Previously this returned early and left the row displaced from the *other* direction, so a
    // right-swipe on a delete-only row froze it wherever it had been.
    const deleteOnly = { ...config, hasRight: false };
    const state = drag(pressed, [[-120, 0], [60, 0]], deleteOnly);
    expect(state).toEqual({ phase: "engaged", offset: 0 });
  });

  it("still tracks the direction that does have an action", () => {
    const deleteOnly = { ...config, hasRight: false };
    expect(drag(pressed, [[-120, 0]], deleteOnly).offset).toBe(-120);
  });
});

describe("swipeRelease", () => {
  const engaged = (offset: number): SwipeState => ({ phase: "engaged", offset });

  it("does nothing at all if the swipe never engaged", () => {
    expect(swipeRelease(pressed, config)).toEqual({ offset: 0, commit: null });
    expect(swipeRelease(SWIPE_IDLE, config)).toEqual({ offset: 0, commit: null });
    expect(swipeRelease({ phase: "abandoned", offset: 0 }, config)).toEqual({
      offset: 0,
      commit: null,
    });
  });

  it("snaps home after a short swipe", () => {
    expect(swipeRelease(engaged(-30), config)).toEqual({ offset: 0, commit: null });
  });

  it("holds the row open once past half the reveal", () => {
    expect(swipeRelease(engaged(-50), config)).toEqual({ offset: -88, commit: null });
    expect(swipeRelease(engaged(60), config)).toEqual({ offset: 88, commit: null });
  });

  it("commits past the commit fraction", () => {
    // 45% of 400 is 180.
    expect(swipeRelease(engaged(-181), config)).toEqual({ offset: 0, commit: "left" });
    expect(swipeRelease(engaged(200), config)).toEqual({ offset: 0, commit: "right" });
  });

  it("does not commit just under the threshold", () => {
    expect(swipeRelease(engaged(-179), config).commit).toBeNull();
  });

  it("never commits an action that does not exist", () => {
    // A delete-only row must not fire delete because the offset happened to be positive.
    const deleteOnly = { ...config, hasRight: false };
    expect(swipeRelease(engaged(200), deleteOnly)).toEqual({ offset: 0, commit: null });
  });

  it("treats a zero offset as no swipe even when engaged", () => {
    expect(swipeRelease(engaged(0), config)).toEqual({ offset: 0, commit: null });
  });

  it("scales with the row, so a narrow row is not impossible to commit", () => {
    const narrow = { ...config, width: 200 };
    // 45% of 200 is 90 — a swipe that would only have opened a 400px row commits a 200px one.
    expect(swipeRelease(engaged(-95), narrow).commit).toBe("left");
  });
});
