/**
 * A single short tap of physical feedback, for keys that are hit without being looked at.
 *
 * Two mechanisms, because the platforms disagree about whether a web page may do this at all.
 *
 * **Android and desktop Chrome** implement the Vibration API. `navigator.vibrate(8)` is one tick,
 * short enough to read as a key click rather than a notification buzz.
 *
 * **iOS Safari does not implement it**, and never has — `navigator.vibrate` is undefined, so the
 * call above is a no-op on the phone this app is mostly used from. The only route Safari leaves is
 * a side effect: since 17.4 it renders `<input type="checkbox" switch>` as a system switch, and
 * flipping one plays the system's own toggle haptic. Clicking a hidden switch is therefore how an
 * iPhone gets feedback here. It is a trick, it is undocumented, and Apple may withdraw it — so it
 * is written to fail silently and to be deletable in one piece if it ever stops working.
 */

/** The hidden switch, made once and reused. Building one per keypress would churn the DOM. */
let iosSwitch: HTMLInputElement | null = null;

function iosSwitchElement(): HTMLInputElement | null {
  if (iosSwitch?.isConnected) return iosSwitch;
  if (typeof document === "undefined") return null;

  const input = document.createElement("input");
  input.type = "checkbox";
  // Not a React-managed attribute and not in the HTML types Safari 17.4 added it in.
  input.setAttribute("switch", "");
  // Hidden from sight and from assistive technology, but *rendered*: `display: none` would take it
  // out of the layout, and an element the browser is not drawing does not play the haptic.
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";

  document.body.appendChild(input);
  iosSwitch = input;
  return input;
}

/**
 * Fires the tap. Safe to call on every keypress: it never throws, and it does nothing at all where
 * neither mechanism exists.
 */
export function tapFeedback(): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    // Chrome returns false rather than throwing when the gesture requirement is not met.
    if (navigator.vibrate(8)) return;
  }

  const input = iosSwitchElement();
  if (!input) return;
  /*
   * `click()` and nothing else. Flipping `checked` first would be undone by the click's own
   * activation behaviour — two toggles, no net change, and a switch that never moves plays
   * nothing. The state it lands in is meaningless; the movement is the point.
   */
  input.click();
}

/** Drops the hidden element. For tests, and for the day this trick has to come out. */
export function resetHaptics(): void {
  iosSwitch?.remove();
  iosSwitch = null;
}
