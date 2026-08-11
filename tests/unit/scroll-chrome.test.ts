import { describe, expect, it } from "vitest";
import { nextChromeState } from "~/lib/useScrollDirection";

/**
 * The bug these cover: dragging past the end of the history list snapped the view back towards
 * the top. Every case below is at an edge of the scroll range, which is exactly where a DOM-level
 * test cannot reach — iOS rubber-band positions are not reproducible in jsdom.
 */

const base = {
  hidden: false,
  y: 500,
  lastY: 500,
  maxY: 2000,
  threshold: 12,
  revealAbove: 80,
  bottomDeadZone: 48,
  minScrollable: 420,
};

describe("nextChromeState — normal scrolling", () => {
  it("hides once the user scrolls down past the threshold", () => {
    expect(nextChromeState({ ...base, y: 520 })).toEqual({ hidden: true, lastY: 520 });
  });

  it("reveals again on an upward scroll", () => {
    expect(nextChromeState({ ...base, hidden: true, y: 480 })).toEqual({
      hidden: false,
      lastY: 480,
    });
  });

  it("ignores movement below the threshold, and does not move the reference point", () => {
    expect(nextChromeState({ ...base, y: 508 })).toEqual({ hidden: false, lastY: 500 });
  });

  it("is always visible near the top", () => {
    expect(nextChromeState({ ...base, hidden: true, y: 40, lastY: 400 })).toEqual({
      hidden: false,
      lastY: 40,
    });
  });
});

describe("nextChromeState — overscroll", () => {
  it("decides nothing while dragged past the bottom", () => {
    // iOS reports y beyond maxY during rubber-band.
    expect(nextChromeState({ ...base, hidden: true, y: 2080, lastY: 2000 })).toEqual({
      hidden: true,
      lastY: 2000,
    });
  });

  it("decides nothing on the spring back, which is what caused the jerk", () => {
    // Releasing at 2080 walks y back down to 2000. Read naively that is an 80px upward scroll,
    // which revealed the filters, grew the document, and moved the rows under the thumb.
    const springBack = [2080, 2060, 2030, 2010, 2000];
    let state = { hidden: true, lastY: 2000 };
    for (const y of springBack) {
      state = nextChromeState({ ...base, ...state, y });
    }
    expect(state.hidden).toBe(true);
  });

  it("decides nothing while dragged past the top", () => {
    expect(nextChromeState({ ...base, hidden: true, y: -60, lastY: 0 })).toEqual({
      hidden: true,
      lastY: 0,
    });
  });

  it("breaks the collapse feedback loop", () => {
    // Collapsing the filters shrinks the document, so maxY drops below the current y. The browser
    // clamps, which fires a scroll event that looks like upward movement. If that revealed the
    // chrome, the document would grow and the whole thing would oscillate.
    expect(nextChromeState({ ...base, hidden: true, y: 1900, lastY: 1900, maxY: 1770 })).toEqual({
      hidden: true,
      lastY: 1900,
    });
  });
});

describe("nextChromeState — bottom dead zone", () => {
  it("does not toggle within the dead zone", () => {
    expect(nextChromeState({ ...base, hidden: true, y: 1970, lastY: 1900 })).toEqual({
      hidden: true,
      lastY: 1900,
    });
  });

  it("still toggles just outside the dead zone", () => {
    expect(nextChromeState({ ...base, hidden: true, y: 1930, lastY: 1990 })).toEqual({
      hidden: false,
      lastY: 1930,
    });
  });

  it("leaves the chrome alone at the exact bottom", () => {
    expect(nextChromeState({ ...base, hidden: true, y: 2000, lastY: 1900 }).hidden).toBe(true);
  });
});

describe("nextChromeState — short pages", () => {
  it("keeps the chrome visible when the content does not fill the viewport", () => {
    // maxY <= 0. Nothing should ever collapse on a list of three rows.
    expect(nextChromeState({ ...base, y: 0, lastY: 0, maxY: 0 })).toEqual({
      hidden: false,
      lastY: 0,
    });
  });

  it("does not collapse on a bounce when there is nothing to scroll", () => {
    expect(nextChromeState({ ...base, y: 30, lastY: 0, maxY: -200 })).toEqual({
      hidden: false,
      lastY: 0,
    });
  });
});

describe("nextChromeState — pages that barely scroll", () => {
  it("keeps the chrome visible when there is little to scroll", () => {
    // Collapsing frees ~320px. On a page with 300px of travel that makes the document shorter than
    // the viewport, the browser forces the scroll to 0, the list jumps to the top — and then the
    // page is short, so the chrome reveals, so it scrolls again. This is why a five-row filtered
    // list could not be held near its end.
    expect(nextChromeState({ ...base, y: 200, lastY: 100, maxY: 300 })).toEqual({
      hidden: false,
      lastY: 200,
    });
  });

  it("reveals chrome that is already hidden when the page becomes short", () => {
    // Applying a filter can shrink the list under a collapsed chrome. Leaving it collapsed would
    // hide the filters that are the only way back.
    expect(nextChromeState({ ...base, hidden: true, y: 50, lastY: 400, maxY: 120 })).toEqual({
      hidden: false,
      lastY: 50,
    });
  });

  it("still collapses on a page with room to spare", () => {
    expect(nextChromeState({ ...base, y: 500, lastY: 400, maxY: 2000 })).toEqual({
      hidden: true,
      lastY: 500,
    });
  });

  it("uses the threshold, not an arbitrary guess about content", () => {
    // Just under and just over, to pin the boundary.
    expect(nextChromeState({ ...base, y: 300, lastY: 200, maxY: 419 }).hidden).toBe(false);
    expect(nextChromeState({ ...base, y: 300, lastY: 200, maxY: 421 }).hidden).toBe(true);
  });
});
