/**
 * Vibration feedback, on phones that offer it to web apps — in practice Android.
 *
 * iPhone has never implemented the Vibration API, and the switch-element workaround people use
 * there was narrowed by iOS 26.5 to direct taps only; skipped for now (decided 2026-10-04). On an
 * iPhone, and on computers, every call here is a silent no-op.
 *
 * Three strengths, so meaning stays consistent across the app:
 *   tap      — something opened or was picked (the + menu)
 *   confirm  — something was recorded (an entry saved, a tile or repeat posted)
 *   warning  — something was removed (hold-to-delete, swipe-to-delete)
 */

export type Haptic = "tap" | "confirm" | "warning";

const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 10,
  confirm: 18,
  // Two short pulses: distinguishable from a save without looking, and still brief.
  warning: [25, 60, 25],
};

export function haptic(kind: Haptic): void {
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    // Blocked (no user gesture yet) or unavailable: feedback is a nicety, never an error.
  }
}
