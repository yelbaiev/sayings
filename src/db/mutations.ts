import { HOUSEHOLD_ID, type SyncedRow, type SyncedTable } from "@shared/schema";
import { db } from "./dexie";
import { requestSync } from "./sync-client";

/**
 * The only way the app writes data.
 *
 * Every mutation does two things in one IndexedDB transaction: update the local table so the
 * UI reflects it immediately, and append the full row to the outbox. Nothing waits on the
 * network. If the write cannot be sent now it goes out on the next successful sync, which is
 * what makes entry work in a supermarket basement.
 */

export interface Author {
  id: string;
}

/** Fields the caller never sets — they are stamped here so no call site can forget. */
type Writable<T> = Omit<T, "household_id" | "rev" | "updated_at" | "updated_by" | "deleted"> & {
  deleted?: 0 | 1;
};

function stamp<T extends SyncedRow>(row: Writable<T>, author: Author): Record<string, unknown> {
  return {
    ...row,
    household_id: HOUSEHOLD_ID,
    // `rev` is the server's to assign. 0 means "not yet acknowledged".
    rev: 0,
    updated_at: Date.now(),
    updated_by: author.id,
    deleted: row.deleted ?? 0,
  };
}

/**
 * Writes a row locally and queues it for the server.
 *
 * The outbox entry is keyed by (table, rowId) — editing the same row twice before a sync
 * replaces the pending entry rather than queueing two. Since entries carry whole row state,
 * the later one fully supersedes the earlier, and collapsing them keeps a burst of rapid edits
 * from turning into a burst of pushes.
 */
export async function put<T extends SyncedRow>(
  table: SyncedTable,
  row: Writable<T>,
  author: Author,
): Promise<void> {
  const stamped = stamp(row, author);
  const rowId = stamped.id as string;

  await db.transaction("rw", [db[table], db.outbox], async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one generic table write
    await (db[table] as any).put(stamped);
    const pending = await db.outbox.where({ table, rowId }).first();
    if (pending?.seq !== undefined) await db.outbox.delete(pending.seq);
    await db.outbox.add({ table, rowId, row: stamped, queuedAt: Date.now() });
  });

  void requestSync();
}

/** Writes several rows atomically — used by splits, bulk recategorise, and the importer. */
export async function putMany(
  entries: { table: SyncedTable; row: Record<string, unknown> }[],
  author: Author,
): Promise<void> {
  const stamped = entries.map(({ table, row }) => ({
    table,
    row: stamp(row as Writable<SyncedRow>, author),
  }));

  const tables = [...new Set(stamped.map((e) => e.table))].map((t) => db[t]);

  await db.transaction("rw", [...tables, db.outbox], async () => {
    for (const { table, row } of stamped) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one generic table write
      await (db[table] as any).put(row);
      const rowId = row.id as string;
      const pending = await db.outbox.where({ table, rowId }).first();
      if (pending?.seq !== undefined) await db.outbox.delete(pending.seq);
      await db.outbox.add({ table, rowId, row, queuedAt: Date.now() });
    }
  });

  void requestSync();
}

/**
 * Soft-deletes a row.
 *
 * Never a hard delete: the other device needs to learn that the row is gone, and a row that
 * simply vanished locally would be re-created by the next pull.
 */
export async function remove(
  table: SyncedTable,
  id: string,
  author: Author,
): Promise<Record<string, unknown> | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one generic table read
  const existing = (await (db[table] as any).get(id)) as Record<string, unknown> | undefined;
  if (!existing) return undefined;

  await put(table, { ...existing, deleted: 1 } as never, author);
  return existing;
}

/** Restores a soft-deleted row. Backs the undo toast. */
export async function restore(
  table: SyncedTable,
  row: Record<string, unknown>,
  author: Author,
): Promise<void> {
  await put(table, { ...row, deleted: 0 } as never, author);
}

export function newId(): string {
  // Client-generated so a row can be created with no network at all.
  return crypto.randomUUID();
}
