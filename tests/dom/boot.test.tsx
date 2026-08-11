import { screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "~/lib/api";

/**
 * That the app renders something.
 *
 * There was no test for this, which is a strange gap to have 499 tests around: every other test mounts
 * one screen with its data handed to it, and none of them mounts the thing the browser actually loads.
 * A crash in `App`, `AppProvider` or `Shell` — the three components on the path to every screen — would
 * pass the entire suite and produce a blank page.
 *
 * "Blank" rather than "error", which is what makes it hard to diagnose from the outside: React unmounts
 * the tree when a render throws, `#root` is left empty, and the body's own background is all that
 * remains. On a dark theme that is a black screen, and it looks exactly like the app being down.
 */

const me: Me = {
  id: "m1",
  email: "member@example.com",
  display_name: "Member",
  locale: "ru",
  default_account_id: null,
  role: "owner",
  household_id: "hh_default",
  base_currency: "UAH",
  enabled_currencies: ["UAH", "EUR", "USD"],
};

const getMe = vi.fn(() => Promise.resolve(me));
const getHealth = vi.fn(() => Promise.resolve({ ok: true, configured: true }));

vi.mock("~/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("~/lib/api")>();
  return { ...actual, getMe: () => getMe(), getHealth: () => getHealth() };
});

/*
 * `~/db/queries` is deliberately *not* mocked. Its hooks all read through `useLiveQuery`, which the
 * shared setup already stubs, so they return their own empty fallbacks — and a hand-written mock would
 * have to list every hook the app happens to call, which makes the test fail when a screen starts using
 * a new one. That is a maintenance tax, and worse, it is one paid in false alarms.
 */

// The sync loop opens a real connection and a real interval; neither belongs in a render test.
vi.mock("~/db/sync-client", () => ({
  startSync: () => () => undefined,
  requestSync: () => Promise.resolve(),
  acknowledgeConflicts: () => undefined,
  // The pill renders nothing until a snapshot arrives, which is the right resting state here.
  subscribeToSync: () => () => undefined,
}));

const App = (await import("~/App")).default;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");
});

describe("the app boots", () => {
  it("renders a screen rather than an empty document", async () => {
    const { container } = render(<App />);

    /*
     * Waiting on the *content*, not on a container. The blank state is legitimate for one tick — a
     * single API call behind an already-authenticated session, where a skeleton would flash rather
     * than inform — and `main` matches that placeholder, so asserting on the element would pass while
     * the page stayed empty forever.
     */
    await vi.waitFor(() => {
      expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    });
  });

  it("shows the first-run currency setup when the installation is new", async () => {
    getMe.mockResolvedValueOnce({ ...me, needs_currency_setup: true });
    render(<App />);
    expect(await screen.findByText(/Ваши валюты/)).toBeTruthy();
  });

  it("shows the claim door on a fresh unclaimed deployment", async () => {
    /*
     * The state every new self-hoster lands in: the deploy button finished, nothing else was
     * configured, and the first visit must offer ownership — not a Zero Trust walkthrough and not
     * an error. authState rides on the API's own 401/500 body, so no extra round trip decides this.
     */
    const { ApiError } = await import("~/lib/api");
    getMe.mockRejectedValueOnce(new ApiError("no auth", 401, "unclaimed"));
    render(<App />);
    expect(await screen.findByText(/Claim this installation/)).toBeTruthy();
  });

  it("shows the passkey login on a claimed deployment with no session", async () => {
    const { ApiError } = await import("~/lib/api");
    getMe.mockRejectedValueOnce(new ApiError("no auth", 401, "login"));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("reports a failure instead of leaving a blank page", async () => {
    /*
     * The distinction that matters when someone says "black screen". A reachable app that failed says
     * so and offers a retry; only an unhandled render error leaves nothing at all.
     */
    getMe.mockRejectedValueOnce(new Error("boom"));
    getHealth.mockResolvedValueOnce({ ok: false, configured: true });
    render(<App />);
    expect(await screen.findByText("boom")).toBeTruthy();
  });
});
