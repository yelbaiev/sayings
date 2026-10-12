import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReauthFailedError,
  ReauthRequiredError,
  apiFetch,
  startReauth,
} from "~/lib/api";

/**
 * An expired Cloudflare Access session, seen from the client.
 *
 * The reauth trip must leave through /api/: the service worker answers every other navigation from
 * its precache, so reloading the page itself never reached Access — the installed app reloaded into
 * the same cached shell, spent its one attempt, and sat on an empty screen.
 */

const assign = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/history?add=expense#x");
  vi.stubGlobal("location", {
    ...window.location,
    assign,
    pathname: "/history",
    search: "?add=expense",
    hash: "#x",
  });
  // What redirect:"manual" yields for Access's 302: an opaque response with status 0.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        type: "opaqueredirect",
        status: 0,
        headers: new Headers(),
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("reauth", () => {
  it("goes to Access through /api/, carrying the screen to come back to", async () => {
    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
    expect(assign).toHaveBeenCalledWith(
      "/api/reauth?to=%2Fhistory%3Fadd%3Dexpense%23x",
    );
  });

  it("does not loop: a second expiry in the same tab is reported, not navigated", async () => {
    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ReauthFailedError);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("lets the person try again after that", async () => {
    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ReauthFailedError);
    startReauth();
    expect(assign).toHaveBeenCalledTimes(2);
    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
  });
});
