/**
 * A single short tap of physical feedback, for keys that are hit without being looked at.
 *
 * Two mechanisms, because the platforms disagree about whether a web page may do this at all.
 *
 * **Android and desktop Chrome** implement the Vibration API. `navigator.vibrate(15)` is one tick,
 * short enough to read as a key click rather than a notification buzz, long enough that phones
 * which round very short pulses down do not swallow it.
 *
 * **iOS has no official route.** Safari does not implement the Vibration API — that covers every
 * browser on the phone, since they are all WebKit, and an installed home-screen app too — and Core
 * Haptics is native-only, not exposed to the web. What is left is a side effect: since 17.4 Safari
 * renders `<input type="checkbox" switch>` as a system switch, and flipping one plays the system's
 * own Taptic tap. Clicking a hidden switch is therefore how an iPhone gets feedback here.
 *
 * Treat it as progressive enhancement, and know what it is not:
 *
 * - One generic tap. No light/medium/heavy, no success/error — those are native-only.
 * - Undocumented. Apple has patched comparable tricks before and may patch this one.
 * - Gesture-bound: later iOS builds want a user gesture behind it, which is why every call site is
 *   inside a pointer handler rather than a timer or an effect.
 *
 * Real, reliable haptics would mean wrapping the app in a native shell. That is a much larger
 * decision than a keypad tick, so this stays a nice-to-have that fails silently, and the colour
 * flash on the key is the feedback that is actually promised. See `src/features/entry/Keypad.tsx`.
 */

/**
 * The hidden switch and the label that fires it, made once and reused.
 *
 * The click goes to the *label*, not to the input. Both end up toggling the control, but the label
 * is the path a person's tap would take, and the reports of this trick working describe that path;
 * a synthetic click straight at the input is the variant most likely to be treated as programmatic
 * and ignored. Cheap insurance either way.
 */
let trigger: { host: HTMLElement; label: HTMLLabelElement; input: HTMLInputElement } | null = null;

const SWITCH_ID = "sayfinance-haptic-switch";

function triggerElements(): typeof trigger {
  if (trigger?.host.isConnected) return trigger;
  if (typeof document === "undefined") return null;

  const input = document.createElement("input");
  input.type = "checkbox";
  // Neither attribute is in the DOM types: `switch` is Safari 17.4's, and React never sees this
  // element — it is created here precisely so no component has to carry a decorative input.
  input.setAttribute("switch", "");
  input.id = SWITCH_ID;
  input.tabIndex = -1;

  const label = document.createElement("label");
  label.htmlFor = SWITCH_ID;

  const host = document.createElement("div");
  // Hidden from sight and from assistive technology, but *rendered*: `display: none` takes the
  // switch out of the layout, and a control the browser is not drawing does not play the tap.
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  host.append(input, label);
  document.body.appendChild(host);

  trigger = { host, label, input };
  return trigger;
}

/**
 * Fires the tap. Safe to call on every keypress: it never throws, and it does nothing at all where
 * neither mechanism exists. Call it from a pointer handler — both routes want a user gesture.
 */
export function tapFeedback(): void {
  // Optional call rather than a bare one: Safari has no `vibrate` at all, and some builds have
  // thrown on it rather than returning undefined.
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    // Chrome returns false rather than throwing when it declines — no gesture yet, for instance.
    if (navigator.vibrate(15)) return;
  }

  const elements = triggerElements();
  if (!elements) return;
  /*
   * `click()` and nothing else. Setting `checked` first would be undone by the click's own
   * activation behaviour — two toggles, no net change, and a switch that never moves plays
   * nothing. Where the state lands is meaningless; the movement is the point.
   */
  elements.label.click();
}

/** Drops the hidden element. For tests, and for the day this trick has to come out. */
export function resetHaptics(): void {
  trigger?.host.remove();
  trigger = null;
}
