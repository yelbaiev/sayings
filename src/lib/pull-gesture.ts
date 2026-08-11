/**
 * The decision layer of pull-to-refresh, shaped exactly like swipe-gesture.ts and for the same
 * reason: whether a touch is "a pull" is three lines of arithmetic that a DOM test cannot reach
 * once it is spread across event handlers.
 *
 * What the component owns is everything with a browser in it: reading `scrollY`, refusing to run
 * under an open sheet, and calling `preventDefault()` once the pull owns the axis so the native
 * rubber-band does not fight it.
 */

export interface PullConfig {
  /** Movement below this is not yet a gesture of any kind. */
  engageSlop: number;
  /** Rendered offset past which releasing triggers a refresh. */
  threshold: number;
  /** The indicator never travels further than this. */
  max: number;
  /** Rendered px per finger px — the resistance that says "this is a gesture, not a scroll". */
  drag: number;
}

export const PULL_CONFIG: PullConfig = { engageSlop: 12, threshold: 60, max: 110, drag: 0.5 };

export type PullPhase =
  /** Not touched, or started somewhere a pull cannot begin. */
  | "idle"
  /** Touched at the top of the page, but the movement so far says nothing. */
  | "pending"
  /** Committed to a downward pull. */
  | "engaged"
  /** Decided to be a scroll or a horizontal swipe. Never becomes a pull. */
  | "abandoned";

export interface PullState {
  phase: PullPhase;
  /** Rendered offset in px, resistance already applied. */
  offset: number;
}

export const PULL_IDLE: PullState = { phase: "idle", offset: 0 };

/**
 * How much more vertical than horizontal the movement must be to count as a pull.
 *
 * The same 1.6 as the row swipe, and deliberately its mirror: the row abandons when
 * `|dy| > |dx| * 1.6`, this engages only when `dy > |dx| * 1.6`. Between the two lies a diagonal
 * dead zone where neither gesture claims the touch — the alternative is a movement that opens a
 * row *and* drags the page down.
 */
const VERTICAL_RATIO = 1.6;

export function pullMove(state: PullState, dx: number, dy: number, config: PullConfig): PullState {
  if (state.phase === "idle" || state.phase === "abandoned") return state;

  if (state.phase === "pending") {
    if (Math.hypot(dx, dy) < config.engageSlop) return state;
    if (dy <= 0 || dy < Math.abs(dx) * VERTICAL_RATIO) return { phase: "abandoned", offset: 0 };
  }

  // Engaged. A finger that returns above its start point clamps to zero rather than scrolling —
  // the pull owns the touch until it ends.
  return { phase: "engaged", offset: Math.max(0, Math.min(config.max, dy * config.drag)) };
}

export interface PullRelease {
  /** Whether the pull went far enough to mean "refresh". */
  commit: boolean;
}

export function pullRelease(state: PullState, config: PullConfig): PullRelease {
  return { commit: state.phase === "engaged" && state.offset >= config.threshold };
}
