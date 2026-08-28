/**
 * The press flash: what a control does to say a press landed.
 *
 * The problem it solves is `:active`. It is styled on nearly everything here and it lasts exactly
 * as long as the finger is down — a few milliseconds on a quick tap, too short to register. So most
 * presses in this app showed nothing, and a screen that does not answer a touch reads as a screen
 * that missed it. The keypad got an animated flash first and it is the reason the pad feels right;
 * this is that mechanism, made general.
 *
 * It is also the *only* feedback available. iOS gives a web page no route to a haptic — no
 * Vibration API in WebKit, Core Haptics is native-only — and the hidden-switch trick that plays the
 * system tap on some builds did nothing on the phone this app is used from. It was tried and
 * removed; see CHANGELOG 1.0.2 through 1.0.6.
 *
 * **One delegated listener, not a prop on every component.** Fifteen feature files hand-roll their
 * own `<button>` for tiles, rows and tabs. Wiring handlers into `Button`, `Chip` and friends would
 * miss all of them, and would go on missing every button written after today. A single listener at
 * the document catches whatever is on screen, including things that do not exist yet.
 */

const FLASH_CLASS = "press-flash";

/** Marks a subtree whose presses are animated by something else. Read by `pressableFrom`. */
const OPT_OUT = "[data-press-flash='off']";

/** What counts as pressable. Anything else is text, and text does not flash. */
const PRESSABLE = "button, [role='button'], a[href]";

/**
 * Replays the flash on one element.
 *
 * The class comes off and goes back on with a layout read between. Without the read the browser
 * coalesces the two mutations into no change at all, and a second press of the same control —
 * every double-tapped key, every repeated backspace — would show nothing.
 */
export function flash(element: HTMLElement, className = FLASH_CLASS): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

/**
 * The control a press at `target` belongs to, or null when it belongs to none.
 *
 * Split out and exported for its own tests: this is where every judgement lives about what should
 * not light up, and each of those is a bug someone would otherwise find on a phone.
 */
export function pressableFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;

  const pressable = target.closest<HTMLElement>(PRESSABLE);
  if (!pressable) return null;

  // A disabled control did not take the press, so it must not claim it did.
  if (pressable.hasAttribute("disabled")) return null;
  if (pressable.getAttribute("aria-disabled") === "true") return null;

  // The keypad, the FAB and the hold-to-delete strip animate their own presses. Two animations on
  // one element fight over `transform`, and the loser is whichever the browser applies second.
  if (pressable.closest(OPT_OUT)) return null;

  return pressable;
}

/**
 * Starts flashing presses across the document. Returns a teardown, for tests.
 *
 * Both listeners capture, so a component that stops propagation on its own handler — the swipe row
 * does — still gets the feedback. Both are passive: this never calls `preventDefault`, and saying
 * so lets the browser start scrolling without waiting to find out.
 */
export function installPressFlash(target: Document = document): () => void {
  const onPointerDown = (event: Event) => {
    const pressable = pressableFrom(event.target);
    if (pressable) flash(pressable);
  };

  // Left where the animation put it, the class would stop a later replay from restarting cleanly.
  const onAnimationEnd = (event: Event) => {
    if (event.target instanceof HTMLElement) event.target.classList.remove(FLASH_CLASS);
  };

  const options = { capture: true, passive: true } as const;
  target.addEventListener("pointerdown", onPointerDown, options);
  target.addEventListener("animationend", onAnimationEnd, options);

  return () => {
    target.removeEventListener("pointerdown", onPointerDown, options);
    target.removeEventListener("animationend", onAnimationEnd, options);
  };
}
