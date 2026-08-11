/**
 * Tap-versus-long-press for the add button.
 *
 * Extracted from the component as a pure state machine because the inline version shipped a
 * deadlock: it started the hold timer only when a previous transaction existed, and then opened
 * the entry sheet only if that timer had been set. With an empty ledger the button did nothing
 * — and it was the only way to create the first transaction.
 *
 * The invariant that bug violated, now explicit and tested: **a tap always fires `onTap`,
 * whether or not a long press is available.**
 */

export interface PressGestureOptions {
  /** Fired on a normal tap, i.e. release before the hold threshold. */
  onTap: () => void;
  /** Fired once the hold threshold passes. Omit when there is nothing to repeat. */
  onLongPress?: (() => void) | undefined;
  holdMs?: number;
  /** Injected so tests need no fake timers. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
}

export interface PressGesture {
  down(): void;
  up(): void;
  /** Pointer left the target, or the gesture was cancelled by the browser. No tap. */
  cancel(): void;
  /** True while a hold timer is outstanding. Exposed for tests only. */
  isPending(): boolean;
}

const DEFAULT_HOLD_MS = 550;

export function createPressGesture(options: PressGestureOptions): PressGesture {
  const {
    onTap,
    onLongPress,
    holdMs = DEFAULT_HOLD_MS,
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancelScheduled = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  let handle: unknown = null;
  let active = false;
  let longPressFired = false;

  const clearHold = () => {
    if (handle !== null) {
      cancelScheduled(handle);
      handle = null;
    }
  };

  return {
    down() {
      active = true;
      longPressFired = false;
      clearHold();

      // Only arm the hold when there is something for it to do. Crucially this does not
      // affect whether a tap works.
      if (!onLongPress) return;

      handle = schedule(() => {
        handle = null;
        longPressFired = true;
        onLongPress();
      }, holdMs);
    },

    up() {
      // Ignore a release we never saw the press for — e.g. after cancel().
      if (!active) return;
      active = false;
      clearHold();
      if (!longPressFired) onTap();
    },

    cancel() {
      active = false;
      longPressFired = false;
      clearHold();
    },

    isPending() {
      return handle !== null;
    },
  };
}
