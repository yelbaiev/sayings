import type { SyncRequest, SyncResponse, SyncedTable } from "@shared/schema";
import { ReauthRequiredError, apiFetch } from "~/lib/api";
import { clearRateCache } from "~/lib/fx";
import { LOCAL_SYNCED_TABLES, db, fxKey, getSyncState } from "./dexie";

/**
 * Background sync loop.
 *
 * Push and pull happen in a single request. The client sends whatever is in the outbox plus
 * its cursor; the server applies the writes and returns everything above that cursor,
 * including the client's own rows with their server-assigned revs.
 *
 * Nothing in the UI ever awaits this. A failed sync is not an error the user has to deal
 * with — it retries, and the sync pill says what is going on.
 */

export type SyncStatus = "idle" | "syncing" | "offline" | "reauth";

export interface SyncSnapshot {
  status: SyncStatus;
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Rows the server overwrote because a newer edit won. Surfaced, never hidden. */
  healedConflicts: number;
}

type Listener = (snapshot: SyncSnapshot) => void;

const listeners = new Set<Listener>();
let snapshot: SyncSnapshot = {
  status: "idle",
  pending: 0,
  lastSyncedAt: null,
  lastError: null,
  healedConflicts: 0,
};

let inFlight: Promise<void> | null = null;
let queuedAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1000;

const MAX_BACKOFF_MS = 60_000;
const PUSH_BATCH = 500;

export function subscribeToSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

function emit(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener(snapshot);
}

/**
 * Requests a sync, coalescing concurrent callers.
 *
 * Every mutation calls this. Without coalescing, adding five transactions in a row would fire
 * five overlapping requests; instead the first runs and the rest collapse into one follow-up.
 */
export function requestSync(): Promise<void> {
  if (inFlight) {
    queuedAgain = true;
    return inFlight;
  }

  inFlight = runSync()
    .catch(() => {
      /* runSync records its own failures in the snapshot */
    })
    .finally(() => {
      inFlight = null;
      if (queuedAgain) {
        queuedAgain = false;
        void requestSync();
      }
    });

  return inFlight;
}

async function runSync(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    emit({ status: "offline", pending: await db.outbox.count() });
    return;
  }

  emit({ status: "syncing" });

  try {
    // Loop while the server reports more, so a first sync of five years of history completes
    // in bounded chunks rather than one enormous response.
    for (;;) {
      const state = await getSyncState();
      const outbox = await db.outbox.orderBy("seq").limit(PUSH_BATCH).toArray();

      const request: SyncRequest = {
        since: state.cursor,
        changes: outbox.map((entry) => ({ table: entry.table, row: entry.row })),
      };

      const response = await apiFetch<SyncResponse>("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      await applyServerChanges(response, outbox.map((e) => e.seq!).filter((s) => s !== undefined));

      const pending = await db.outbox.count();
      emit({
        status: "idle",
        pending,
        lastSyncedAt: Date.now(),
        lastError: null,
        healedConflicts: snapshot.healedConflicts + response.conflicts.length,
      });

      backoffMs = 1000;
      if (!response.more && pending === 0) break;
      if (!response.more && outbox.length === 0) break;
    }

    await pullFxRates();
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      // A full page navigation is already under way; stop rather than retrying into a wall.
      emit({ status: "reauth", lastError: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Sync failed";
    emit({
      status: navigator.onLine ? "idle" : "offline",
      pending: await db.outbox.count(),
      lastError: message,
    });
    scheduleRetry();
    throw error;
  }
}

/**
 * Applies a server response: incoming rows overwrite local ones, conflicts overwrite local
 * ones too (the server's version won), and the pushed outbox entries are cleared.
 *
 * All in one IndexedDB transaction, so a crash mid-apply cannot leave the cursor ahead of the
 * data it claims to cover — which would silently skip rows forever.
 */
async function applyServerChanges(response: SyncResponse, pushedSeqs: number[]): Promise<void> {
  const tables = LOCAL_SYNCED_TABLES.map((t) => db[t]);

  await db.transaction("rw", [...tables, db.outbox, db.syncState], async () => {
    const grouped = new Map<SyncedTable, Record<string, unknown>[]>();
    for (const { table, row } of [...response.changes, ...response.conflicts]) {
      const list = grouped.get(table) ?? [];
      list.push(row);
      grouped.set(table, list);
    }

    for (const [table, rows] of grouped) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one generic bulk write
      await (db[table] as any).bulkPut(rows);
    }

    // Clear only what was actually sent. Entries queued while the request was in flight stay
    // put, so a write made mid-sync is not silently dropped.
    if (pushedSeqs.length) await db.outbox.bulkDelete(pushedSeqs);

    await db.syncState.put({
      id: "state",
      cursor: response.rev,
      lastSyncedAt: Date.now(),
      lastError: null,
    });
  });
}

/**
 * Mirrors FX rates.
 *
 * A separate pull from the household revision stream because rates are public reference data
 * with no owner and no conflicts — dating them is a simpler and cheaper cursor than a rev.
 * Fetches from the newest rate already held, so the usual case transfers a day or two.
 */
async function pullFxRates(): Promise<void> {
  const newest = await db.fxRates.orderBy("on_date").last();
  const since = newest?.on_date ?? "1970-01-01";

  const { rates } = await apiFetch<{
    rates: { on_date: string; quote: string; rate: number; base?: string }[];
  }>(`/api/fx?since=${since}`);

  if (rates.length === 0) return;

  /*
   * A base change invalidates the whole mirror, not just the days since.
   *
   * The pull is deliberately forward-only — from the newest rate held — which is what makes the usual
   * case a day or two of transfer. That same property means a base change would leave every
   * historical rate expressed in the old currency, unreachable and wrong, with reports quietly
   * mixing two bases. Noticing the mismatch and starting over is cheap: a few thousand small rows.
   */
  const incomingBase = rates[0]?.base;
  if (incomingBase && newest?.base && newest.base !== incomingBase) {
    await db.fxRates.clear();
    clearRateCache();
    // Re-entered rather than continued, so the refetch starts from the beginning of history.
    return pullFxRates();
  }

  await db.fxRates.bulkPut(
    rates.map((rate) => ({
      key: fxKey(rate.on_date, rate.quote),
      on_date: rate.on_date,
      quote: rate.quote,
      rate: rate.rate,
      ...(rate.base ? { base: rate.base } : {}),
    })),
  );

  // The lookup cache is now stale.
  clearRateCache();
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void requestSync();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
}

let started = false;

/**
 * Starts the loop: sync on load, when the network returns, when the tab becomes visible, and
 * on a slow poll so the other device's changes turn up without a refresh.
 */
export function startSync(pollMs = 20_000): () => void {
  if (started) return () => {};
  started = true;

  const onOnline = () => {
    backoffMs = 1000;
    void requestSync();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void requestSync();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", () => emit({ status: "offline" }));
  document.addEventListener("visibilitychange", onVisible);
  const interval = setInterval(() => void requestSync(), pollMs);

  void requestSync();

  return () => {
    started = false;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(interval);
  };
}

export function acknowledgeConflicts(): void {
  emit({ healedConflicts: 0 });
}
