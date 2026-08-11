/**
 * The decision layer of a swipeable list row.
 *
 * Pulled out of the component because the gesture was unreliable in ways that are invisible when
 * the logic is spread across three event handlers: a diagonal first movement abandoned the swipe
 * permanently, a swipe in a direction with no action left the row displaced from the *other*
 * direction, and release read an offset that could be one frame stale. None of those are reachable
 * from a DOM test; all of them are three lines of arithmetic here.
 *
 * What the component still owns is the part that actually caused most of the trouble — capturing
 * the pointer so the gesture survives leaving the row, and telling the browser not to claim the
 * horizontal axis for itself.
 */

export interface SwipeConfig {
  /** Row width in px, for the fractions below. */
  width: number;
  /** How far the row opens to expose one button. */
  reveal: number;
  /** Past this fraction of the width, releasing commits outright. */
  commitFraction: number;
  /** Movement below this is not yet a swipe. */
  engageSlop: number;
  hasLeft: boolean;
  hasRight: boolean;
}

export type SwipePhase =
  /** Not touched. */
  | "idle"
  /** Pressed, but the movement so far says nothing. */
  | "pending"
  /** Committed to a horizontal swipe. */
  | "engaged"
  /** Decided to be a vertical scroll. Never becomes a swipe. */
  | "abandoned";

export interface SwipeState {
  phase: SwipePhase;
  offset: number;
}

export const SWIPE_IDLE: SwipeState = { phase: "idle", offset: 0 };

/**
 * How much more vertical than horizontal a movement must be before it counts as scrolling.
 *
 * Not 1. Fingers travel in arcs and a mouse never moves on an axis, so `|dy| > |dx|` abandoned
 * roughly half of all genuine swipes on their first event — which is what made the gesture feel
 * like it worked only sometimes.
 */
const VERTICAL_RATIO = 1.6;

/** Resistance limit: the row never travels more than this fraction of its own width. */
const MAX_FRACTION = 0.75;

export function swipeMove(
  state: SwipeState,
  dx: number,
  dy: number,
  config: SwipeConfig,
): SwipeState {
  if (state.phase === "abandoned" || state.phase === "idle") return state;

  if (state.phase === "pending") {
    // Wait for enough movement to have an opinion. Measured on the diagonal, so a slow diagonal
    // start does not engage on one axis before the other has caught up.
    if (Math.hypot(dx, dy) < config.engageSlop) return state;
    if (Math.abs(dy) > Math.abs(dx) * VERTICAL_RATIO) {
      return { phase: "abandoned", offset: 0 };
    }
  }

  // Swiping towards a side with no action does nothing at all — and, importantly, returns the row
  // home rather than leaving it wherever the other direction had put it.
  const towards = dx < 0 ? config.hasLeft : config.hasRight;
  if (!towards) return { phase: "engaged", offset: 0 };

  const limit = config.width * MAX_FRACTION;
  return { phase: "engaged", offset: Math.max(-limit, Math.min(limit, dx)) };
}

export interface SwipeRelease {
  /** Where the row should rest. */
  offset: number;
  /** Which action to run, if the swipe went far enough to commit. */
  commit: "left" | "right" | null;
}

export function swipeRelease(state: SwipeState, config: SwipeConfig): SwipeRelease {
  if (state.phase !== "engaged") return { offset: 0, commit: null };

  const magnitude = Math.abs(state.offset);
  const side = state.offset < 0 ? "left" : "right";
  const exists = side === "left" ? config.hasLeft : config.hasRight;
  if (!exists || magnitude === 0) return { offset: 0, commit: null };

  if (magnitude >= config.width * config.commitFraction) {
    return { offset: 0, commit: side };
  }

  // Half the reveal distance is enough to mean "open it", which is gentler than requiring the full
  // travel. Below that the row goes home.
  if (magnitude >= config.reveal / 2) {
    return { offset: side === "left" ? -config.reveal : config.reveal, commit: null };
  }

  return { offset: 0, commit: null };
}
