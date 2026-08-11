import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAppCache, finishHardReload, unregisterWorkers } from "~/lib/hard-reload";

/**
 * The reload itself is not observable — its last act replaces the page — so the parts that decide
 * *what* gets cleared are split out and tested here.
 *
 * The rule these exist to keep: **caches are never deleted while a service worker controls the page.**
 * Breaking it produced the worst failure this app has had. `unregister()` does not stop a worker
 * serving the page it already controls, so the reload's own navigation went through that worker, which
 * looked in Cache Storage for `index.html` and found it deleted moments earlier. Workbox's navigation
 * route had nothing to fall back to, the navigation resolved to nothing, and the app was gone —
 * recoverable only by force-quitting. Nothing threw, and nothing was logged.
 */

const originalCaches = globalThis.caches;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCaches === undefined) delete (globalThis as { caches?: unknown }).caches;
});

function stubCaches(keys: string[], deleted: string[] = []) {
  const remaining = new Set(keys);
  vi.stubGlobal("caches", {
    keys: () => Promise.resolve([...remaining]),
    delete: (key: string) => {
      deleted.push(key);
      return Promise.resolve(remaining.delete(key));
    },
  });
}

/** `controller` is what says a worker is serving this page's requests right now. */
function stubServiceWorker({
  registrations = 0,
  controlling = false,
  unregistered = [] as number[],
} = {}) {
  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller: controlling ? {} : null,
      getRegistrations: () =>
        Promise.resolve(
          Array.from({ length: registrations }, (_, index) => ({
            unregister: () => {
              unregistered.push(index);
              return Promise.resolve(true);
            },
          })),
        ),
    },
  });
}

describe("clearAppCache", () => {
  it("refuses to delete anything while a worker controls the page", async () => {
    /*
     * The assertion the black screen was worth. Deleting a precache out from under the worker that is
     * about to serve the next navigation from it does not fail — it simply leaves nothing to serve.
     */
    const deleted: string[] = [];
    stubCaches(["workbox-precache-v2", "assets"], deleted);
    stubServiceWorker({ controlling: true });

    expect(await clearAppCache()).toBe(0);
    expect(deleted).toEqual([]);
  });

  it("deletes every bucket once nothing is serving from them", async () => {
    const deleted: string[] = [];
    stubCaches(["workbox-precache-v2", "assets"], deleted);
    stubServiceWorker({ controlling: false });

    expect(await clearAppCache()).toBe(2);
    expect(deleted).toHaveLength(2);
  });

  it("does nothing where Cache Storage is unavailable", async () => {
    // A non-secure context, or an in-app browser. Not an error, just nothing to do.
    delete (globalThis as { caches?: unknown }).caches;
    stubServiceWorker({ controlling: false });
    await expect(clearAppCache()).resolves.toBe(0);
  });
});

describe("unregisterWorkers", () => {
  it("unregisters each registration", async () => {
    const unregistered: number[] = [];
    stubServiceWorker({ registrations: 2, unregistered });
    expect(await unregisterWorkers()).toBe(2);
    expect(unregistered).toEqual([0, 1]);
  });

  it("does nothing where service workers are unsupported", async () => {
    vi.stubGlobal("navigator", {});
    await expect(unregisterWorkers()).resolves.toBe(0);
  });
});

describe("finishHardReload", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("does nothing on an ordinary load", async () => {
    // Which is every load but one, so this is the path that must stay cheap and silent.
    const deleted: string[] = [];
    stubCaches(["workbox-precache-v2"], deleted);
    stubServiceWorker({ controlling: false });

    expect(await finishHardReload()).toBeNull();
    expect(deleted).toEqual([]);
  });

  it("clears the orphaned caches after a hard reload", async () => {
    const deleted: string[] = [];
    stubCaches(["workbox-precache-v2", "assets"], deleted);
    stubServiceWorker({ controlling: false });
    sessionStorage.setItem("sayfinance:hard-reload", "1");
    vi.stubGlobal("location", { reload: vi.fn() });

    expect(await finishHardReload()).toBe(2);
    expect(deleted).toHaveLength(2);
  });

  it("leaves the caches alone if a worker is still in charge", async () => {
    // A stale cache beats a dead app: the version banner will still be there to try again.
    const deleted: string[] = [];
    stubCaches(["workbox-precache-v2"], deleted);
    stubServiceWorker({ controlling: true });
    sessionStorage.setItem("sayfinance:hard-reload", "1");

    expect(await finishHardReload()).toBeNull();
    expect(deleted).toEqual([]);
  });

  it("clears the mark even when it does nothing, so it cannot loop", async () => {
    /*
     * A marker that survives its own pass is an app that reloads itself forever — the same shape of
     * failure as the black screen, and just as hard to escape on a phone.
     */
    stubCaches([]);
    stubServiceWorker({ controlling: true });
    sessionStorage.setItem("sayfinance:hard-reload", "1");

    await finishHardReload();
    expect(sessionStorage.getItem("sayfinance:hard-reload")).toBeNull();
  });
});
