import { useEffect, useRef, useState } from "react";

export interface ScrollChromeInput {
  /** Whether the chrome is currently collapsed. */
  hidden: boolean;
  /** Raw `window.scrollY`. On iOS this goes outside [0, maxY] during rubber-band overscroll. */
  y: number;
  /** Scroll position at the last accepted decision. */
  lastY: number;
  /** Largest in-range scroll position: `scrollHeight - innerHeight`. May be 0 or negative. */
  maxY: number;
  threshold: number;
  revealAbove: number;
  bottomDeadZone: number;
  /**
   * Below this much scrollable distance the chrome never collapses.
   *
   * Collapsing removes roughly 320px of document height. On a page that only scrolls a little —
   * a filtered list with five rows — that can make the document shorter than the viewport, at which
   * point the browser has no choice but to force the scroll position back to 0. The list jumps to
   * the top, which makes it un-scrollable, which reveals the chrome, which makes it scrollable
   * again: the reason a short list could not be held near its end.
   *
   * There is also nothing to win. Reclaiming 320px on a page with 200px of travel is not worth a
   * reflow.
   */
  minScrollable: number;
}

/**
 * Whether the chrome should be collapsed, given a scroll position.
 *
 * Pure, because the interesting cases are all at the edges of the scroll range and none of them
 * are reachable from a unit test through the DOM.
 *
 * The two guards exist for one bug: dragging past the end of the history list snapped the view
 * back towards the top. `.collapsible` animates `max-height`, so revealing the filters grows the
 * document — and when the viewport is pinned at the bottom, the browser has to clamp the scroll
 * position, which moves the rows under the reader's thumb. Two separate paths were triggering
 * that reveal at exactly the worst moment:
 *
 *  - **Overscroll.** iOS reports `y` beyond both ends of the range, and the spring back reads as
 *    a large upward scroll. Positions outside the range decide nothing.
 *  - **Feedback.** Collapsing the filters shrinks the document, so `maxY` drops below the current
 *    `y`; the browser clamps, that fires a scroll event, and the apparent upward movement
 *    reveals the chrome again — which grows the document, and round it goes. Ignoring out-of-range
 *    positions breaks that loop too, and the dead zone keeps the chrome from toggling at all in
 *    the last few pixels, where any reflow is felt immediately.
 */
export function nextChromeState(
  input: ScrollChromeInput,
): { hidden: boolean; lastY: number } {
  const { hidden, y, lastY, maxY, threshold, revealAbove, bottomDeadZone, minScrollable } =
    input;

  if (y < 0 || y > maxY) return { hidden, lastY };

  // Too little to scroll for hiding anything to help. Reveal, so a page that has just become short
  // does not keep its chrome collapsed.
  if (maxY < minScrollable) return { hidden: false, lastY: y };

  // Near the top the chrome is always visible: collapsing something you have not scrolled past
  // reads as a glitch.
  if (y < revealAbove) return { hidden: false, lastY: y };

  if (maxY - y <= bottomDeadZone) return { hidden, lastY };

  const delta = y - lastY;
  // A movement threshold, so jitter or a small bounce does not toggle anything.
  if (Math.abs(delta) < threshold) return { hidden, lastY };

  return { hidden: delta > 0, lastY: y };
}

/**
 * Whether secondary chrome — filters, search, section actions — should be out of the way.
 *
 * Hides while scrolling down and returns on an upward scroll, the pattern browser toolbars use.
 * The decision itself is `nextChromeState`; this only feeds it the scroll position.
 */
export function useHideOnScrollDown(
  options: {
    threshold?: number;
    revealAbove?: number;
    bottomDeadZone?: number;
    minScrollable?: number;
  } = {},
) {
  const { threshold = 12, revealAbove = 80, bottomDeadZone = 48, minScrollable = 420 } = options;
  const [hidden, setHidden] = useState(false);
  // Mirrors `hidden` for the scroll handler to read. The decision needs the current value, and
  // threading it through a setState updater would put the lastY assignment inside a reducer,
  // where StrictMode's double invocation would apply it twice.
  const hiddenRef = useRef(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;

    const onScroll = () => {
      // Coalesced into a frame: scroll fires far more often than the UI can usefully change.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Read fresh every frame: collapsing the chrome changes the document height, so a
        // cached maxY would be wrong precisely when it matters.
        const maxY = document.documentElement.scrollHeight - window.innerHeight;

        const next = nextChromeState({
          hidden: hiddenRef.current,
          y: window.scrollY,
          lastY,
          maxY,
          threshold,
          revealAbove,
          bottomDeadZone,
          minScrollable,
        });

        lastY = next.lastY;
        if (next.hidden !== hiddenRef.current) {
          hiddenRef.current = next.hidden;
          setHidden(next.hidden);
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [threshold, revealAbove, bottomDeadZone, minScrollable]);

  return hidden;
}
