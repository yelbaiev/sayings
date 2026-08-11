/**
 * Drops the cached copy of the app and loads it again from the network.
 *
 * The service worker precaches the whole app so it runs offline, which means a deploy reaches a phone
 * only when the worker decides to update. `registerType: "autoUpdate"` usually handles that within a
 * load or two, but "usually" is not much help when you are standing there looking at a version you
 * know is old.
 *
 * **This touches code, never data.** IndexedDB holds the local mirror *and the outbox*, so a
 * transaction saved on a train and not yet synced lives there. Clearing it would be a different
 * operation with a different risk, and there is already a button for that — "resync" — which is safe
 * only because the server is authoritative. Nothing here goes near it.
 *
 * ## Why this is two passes
 *
 * The obvious version — delete the caches, unregister the worker, reload — produced a black screen
 * that could only be escaped by force-quitting the app. `unregister()` does not stop a worker
 * controlling the page it is already controlling; the registration is only torn down once every
 * client has gone. So the reload's own navigation was still handled by that worker, which reached
 * into Cache Storage for `index.html` and found it deleted a moment earlier. Workbox's navigation
 * route has nothing to fall back to, the navigation resolves to nothing, and the app is simply gone —
 * with no error, because nothing failed.
 *
 * The invariant this file now keeps: **caches are never deleted while a worker controls the page.**
 *
 *  1. Unregister the workers, mark the session, reload. The precache is intact, so whatever handles
 *     that navigation can serve it. The app comes back, always.
 *  2. On the next boot, if the mark is set and nothing is controlling the page any more, the caches
 *     are orphaned — delete them and reload once more, this time from the network.
 *
 * The second pass is skipped if a worker is still in charge. That leaves a stale cache rather than a
 * dead app, which is the right way round: the version banner will still be there to try again, and
 * Workbox drops outdated precaches on its own next activation anyway.
 */

const MARKER = "sayfinance:hard-reload";

export interface HardReloadResult {
  /** Cache Storage buckets removed. Workbox keeps one per precache revision. */
  caches: number;
  /** Service workers unregistered. Normally one. */
  workers: number;
}

/** Whether a service worker is currently serving this page's requests. */
function controlled(): boolean {
  return typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
}

/**
 * Unregisters the service workers. Exported separately from the reload so it can be tested — a
 * function whose last act is navigating the page is not observable.
 */
export async function unregisterWorkers(): Promise<number> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return 0;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const results = await Promise.all(registrations.map((registration) => registration.unregister()));
  return results.filter(Boolean).length;
}

/**
 * Deletes every Cache Storage bucket — but only when nothing is serving from them.
 *
 * The guard is the whole point rather than a precaution. Deleting a precache out from under the
 * worker that is about to serve the next navigation from it is what left the app on a black screen.
 */
export async function clearAppCache(): Promise<number> {
  // Absent in a non-secure context and in some in-app browsers. Not an error, just nothing to do.
  if (typeof caches === "undefined") return 0;
  if (controlled()) return 0;

  const keys = await caches.keys();
  const results = await Promise.all(keys.map((key) => caches.delete(key)));
  return results.filter(Boolean).length;
}

/**
 * Second pass, run at boot.
 *
 * Returns what it cleared, or null when there was nothing to do — which is every ordinary load.
 */
export async function finishHardReload(): Promise<number | null> {
  if (typeof sessionStorage === "undefined") return null;
  if (sessionStorage.getItem(MARKER) === null) return null;

  // Cleared first: a failure past this point must not leave the app reloading itself forever.
  sessionStorage.removeItem(MARKER);

  if (controlled()) {
    // Still controlled, so the caches are still in use. A stale cache beats a dead app.
    console.warn("hard reload: a service worker is still in control, leaving caches alone");
    return null;
  }

  const cleared = await clearAppCache();
  // `location` rather than `window.location`: this runs at boot in whatever environment the app finds
  // itself in, and a missing global here would abort the pass rather than skip the reload.
  if (cleared > 0 && typeof location !== "undefined") location.reload();
  return cleared;
}

/**
 * First pass: unregister, mark, reload.
 *
 * `location.reload()` rather than a cache-busting query parameter: the asset filenames are content
 * hashed and the document is served with a revalidating cache header, so once the worker is gone the
 * network is consulted. A `?_=timestamp` would work too and would stay in the address bar afterwards,
 * which is a poor trade for a button someone presses when something already looks wrong.
 *
 * The worker re-registers itself on the next load, so offline support comes back immediately rather
 * than being traded away.
 */
export async function hardReload(): Promise<HardReloadResult> {
  let workers = 0;
  try {
    workers = await unregisterWorkers();
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(MARKER, "1");
  } catch (error) {
    // Reload anyway. A failed unregister is still worth a reload, and refusing to reload because the
    // cleanup failed would leave the user with neither.
    console.error("hard reload: unregister failed:", (error as Error).message);
  }
  if (typeof location !== "undefined") location.reload();
  return { caches: 0, workers };
}
