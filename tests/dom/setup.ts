import "@testing-library/react";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom stops short of the Pointer Events capture API, so components that use it throw rather than
 * behaving differently. Stubbed to no-ops so a component can be rendered at all.
 *
 * Worth being explicit about what this costs: with capture stubbed out, jsdom **cannot** reproduce the
 * bug that made the sheet's close button and the transaction rows unclickable for three releases. A
 * captured pointer retargets `pointerup`, so the browser dispatches `click` to the capturing element
 * rather than the button inside it — and jsdom, having no capture, dispatches it to the button and the
 * test passes either way.
 *
 * So these tests are for wiring, not for gestures. The gesture decisions are pure functions with their
 * own tests (src/lib/press-gesture.ts, src/lib/swipe-gesture.ts) precisely because this layer cannot
 * see them.
 */
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture() {
    /* no-op */
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
}

/** jsdom has no matchMedia; components read it to decide whether a pointer is coarse. */
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(cleanup);

/*
 * The local database, stubbed.
 *
 * AppProvider reads the member row through Dexie so a language change on the other phone appears
 * without a refresh, and jsdom has no IndexedDB. Mocking the module beats adding fake-indexeddb: the
 * components under test here do not exercise storage, and a fake database would invite tests that
 * pretend to cover sync — which is covered properly against real D1 in tests/worker.
 */
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => undefined,
}));

vi.mock("~/db/dexie", () => ({
  db: {},
  getDevicePrefs: () =>
    Promise.resolve({
      id: "prefs",
      theme: "system",
      lastAccountByCategory: {},
      installPromptSeen: true,
      introSeen: true,
    }),
  setDevicePrefs: () => Promise.resolve(),
  resetLocalMirror: () => Promise.resolve(),
}));
