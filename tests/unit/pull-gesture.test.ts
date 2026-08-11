import { describe, expect, it } from "vitest";
import {
  PULL_CONFIG,
  PULL_IDLE,
  pullMove,
  pullRelease,
  type PullState,
} from "~/lib/pull-gesture";

/**
 * The pull-to-refresh decision layer, tested where the swipe machine is tested and for the same
 * reason: every clause here is a bug class the row swipe actually shipped — the diagonal start
 * that engages the wrong gesture, the release that reads a stale phase, the movement with no cap.
 */

const PENDING: PullState = { phase: "pending", offset: 0 };

describe("engaging", () => {
  it("does nothing within the slop, whatever the direction", () => {
    expect(pullMove(PENDING, 4, 8, PULL_CONFIG).phase).toBe("pending");
    expect(pullMove(PENDING, -6, -6, PULL_CONFIG).phase).toBe("pending");
  });

  it("engages on a clearly downward movement", () => {
    const state = pullMove(PENDING, 5, 60, PULL_CONFIG);
    expect(state.phase).toBe("engaged");
    expect(state.offset).toBe(30); // 60px of finger at 0.5 drag
  });

  it("abandons an upward movement — that is a scroll", () => {
    expect(pullMove(PENDING, 0, -40, PULL_CONFIG).phase).toBe("abandoned");
  });

  it("abandons a diagonal that a row swipe might also want", () => {
    /*
     * The row abandons when |dy| > |dx| * 1.6; the pull engages only when dy > |dx| * 1.6. A
     * movement at 45° must fall in the dead zone between them — claimed by neither — or one touch
     * would open a row and drag the page at once.
     */
    expect(pullMove(PENDING, 40, 40, PULL_CONFIG).phase).toBe("abandoned");
  });

  it("never comes back from abandoned, however vertical it turns", () => {
    const abandoned = pullMove(PENDING, 40, 40, PULL_CONFIG);
    expect(pullMove(abandoned, 40, 300, PULL_CONFIG).phase).toBe("abandoned");
  });

  it("ignores movement entirely when idle", () => {
    expect(pullMove(PULL_IDLE, 0, 200, PULL_CONFIG)).toBe(PULL_IDLE);
  });
});

describe("while engaged", () => {
  const engaged = pullMove(PENDING, 0, 60, PULL_CONFIG);

  it("caps the travel, so a full-screen drag does not park the page mid-air", () => {
    expect(pullMove(engaged, 0, 2000, PULL_CONFIG).offset).toBe(PULL_CONFIG.max);
  });

  it("clamps to zero when the finger returns above its start, rather than scrolling", () => {
    expect(pullMove(engaged, 0, -30, PULL_CONFIG).offset).toBe(0);
  });

  it("stays engaged even under the threshold — the pull owns the touch until it ends", () => {
    expect(pullMove(engaged, 0, 10, PULL_CONFIG).phase).toBe("engaged");
  });
});

describe("release", () => {
  it("commits past the threshold and not before", () => {
    const far = pullMove(PENDING, 0, PULL_CONFIG.threshold * 2, PULL_CONFIG);
    expect(pullRelease(far, PULL_CONFIG).commit).toBe(true);

    const near = pullMove(PENDING, 0, 40, PULL_CONFIG);
    expect(pullRelease(near, PULL_CONFIG).commit).toBe(false);
  });

  it("never commits from any phase but engaged", () => {
    expect(pullRelease(PULL_IDLE, PULL_CONFIG).commit).toBe(false);
    expect(pullRelease(PENDING, PULL_CONFIG).commit).toBe(false);
    expect(pullRelease({ phase: "abandoned", offset: 0 }, PULL_CONFIG).commit).toBe(false);
  });
});
