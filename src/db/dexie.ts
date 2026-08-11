import type {
  Account,
  Budget,
  Category,
  Member,
  QuickTile,
  Recurring,
  SyncedTable,
  Transaction,
} from "@shared/schema";
import Dexie, { type EntityTable } from "dexie";

/**
 * The local mirror.
 *
 * The whole dataset lives here — roughly 35k transactions over five years, about 7 MB — so
 * every read in the app, including every report, runs against IndexedDB and never the network.
 * That is what makes the app fully usable offline and removes loading states entirely.
 *
 * The server remains authoritative. If iOS evicts this database (which it does for sites not
 * installed to the home screen), the cost is a re-sync, not data loss.
 */

/** A pending local write, drained by the sync client. */
export interface OutboxEntry {
  /** Auto-incremented, so the outbox drains in the order the user made the changes. */
  seq?: number;
  table: SyncedTable;
  rowId: string;
  /** Full row state, not a delta — which is what makes a replayed push idempotent. */
  row: Record<string, unknown>;
  queuedAt: number;
}

/** Single-row table holding this device's sync state. */
export interface SyncState {
  id: "state";
  /** Highest server rev this device has seen. */
  cursor: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

/** Mirrored FX rates. Public reference data, pulled by its own endpoint rather than through
 *  the household rev stream — see worker/fx.ts. */
export interface FxRate {
  /** Composite key 'YYYY-MM-DD:QUOTE', since Dexie has no native compound primary key. */
  key: string;
  on_date: string;
  quote: string;
  rate: number;
  /**
   * The currency the rate is expressed in.
   *
   * Stored per row so the mirror can notice it is out of date after a base change. Without it the
   * client would keep old-base rates for every historical date forever: the pull starts from the
   * newest row it holds, so nothing older is ever fetched again.
   */
  base?: string;
}

export function fxKey(onDate: string, quote: string): string {
  return `${onDate}:${quote}`;
}

/** Local-only preferences that deliberately do not sync — they are per-device, not per-user. */
export interface DevicePrefs {
  id: "prefs";
  theme: "system" | "light" | "dark";
  /** Last account used per category, which the entry screen uses to preselect. */
  lastAccountByCategory: Record<string, string>;
  /** Set once the install prompt has been dismissed, so it is not nagged. */
  installPromptSeen: boolean;
  /**
   * Set once the intro has been shown. Per-device, like the install prompt: it records that this
   * phone's owner has seen it, and the two household members do not share a phone.
   *
   * No Dexie version bump: this adds a field to an existing object store rather than a store or an
   * index, and `getDevicePrefs` supplies the default. Existing devices therefore read it as
   * undefined once and see the intro — which is the intended behaviour, not a migration problem.
   */
  introSeen: boolean;
}

export class SayFinanceDb extends Dexie {
  members!: EntityTable<Member, "id">;
  accounts!: EntityTable<Account, "id">;
  categories!: EntityTable<Category, "id">;
  transactions!: EntityTable<Transaction, "id">;
  budgets!: EntityTable<Budget, "id">;
  recurring!: EntityTable<Recurring, "id">;
  quick_tiles!: EntityTable<QuickTile, "id">;

  fxRates!: EntityTable<FxRate, "key">;
  outbox!: EntityTable<OutboxEntry, "seq">;
  syncState!: EntityTable<SyncState, "id">;
  devicePrefs!: EntityTable<DevicePrefs, "id">;

  constructor(name = "sayfinance") {
    super(name);

    // Indexes mirror the query patterns the UI actually has: history is ordered by date,
    // reports group by category and month, balances group by account.
    this.version(1).stores({
      members: "id, email, deleted",
      accounts: "id, sort_order, archived, deleted",
      categories: "id, kind, sort_order, archived, deleted",
      transactions:
        "id, occurred_on, account_id, to_account_id, category_id, updated_by, " +
        "split_parent_id, import_hash, deleted, [deleted+occurred_on], [category_id+occurred_on]",
      budgets: "id, category_id, period_month, deleted",
      recurring: "id, next_on, active, deleted",
      quick_tiles: "id, member_id, sort_order, deleted",

      fxRates: "key, on_date, quote, [quote+on_date]",
      outbox: "++seq, table, rowId",
      syncState: "id",
      devicePrefs: "id",
    });
  }
}

export const db = new SayFinanceDb();

/** Tables that participate in sync, in the order a batch must be applied. */
export const LOCAL_SYNCED_TABLES: readonly SyncedTable[] = [
  "members",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "recurring",
  "quick_tiles",
];

export async function getSyncState(): Promise<SyncState> {
  return (
    (await db.syncState.get("state")) ?? {
      id: "state",
      cursor: 0,
      lastSyncedAt: null,
      lastError: null,
    }
  );
}

export async function getDevicePrefs(): Promise<DevicePrefs> {
  return (
    (await db.devicePrefs.get("prefs")) ?? {
      id: "prefs",
      theme: "system",
      lastAccountByCategory: {},
      installPromptSeen: false,
      introSeen: false,
    }
  );
}

export async function setDevicePrefs(patch: Partial<Omit<DevicePrefs, "id">>): Promise<void> {
  const current = await getDevicePrefs();
  await db.devicePrefs.put({ ...current, ...patch, id: "prefs" });
}

/**
 * Drops the local mirror and resets the cursor, so the next sync rebuilds from the server.
 * Offered in Settings as a repair action. Pending outbox entries are preserved — discarding
 * them would silently lose writes the server has not seen yet.
 */
export async function resetLocalMirror(): Promise<void> {
  await db.transaction("rw", [...LOCAL_SYNCED_TABLES.map((t) => db[t]), db.syncState], async () => {
    for (const table of LOCAL_SYNCED_TABLES) await db[table].clear();
    await db.syncState.put({ id: "state", cursor: 0, lastSyncedAt: null, lastError: null });
  });
}
