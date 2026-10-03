import {
  HOUSEHOLD_ID,
  SYNCED_TABLES,
  syncRequestSchema,
  tableSchemas,
  type SyncResponse,
  type SyncedTable,
} from "@shared/schema";
import {
  bumpRevStatement,
  changesSince,
  changesThrough,
  existingUpdatedAt,
  householdCurrencies,
  readRow,
  upsertStatement,
  type MemberRecord,
} from "./db";

/**
 * Bidirectional sync in one round trip.
 *
 *   push: whole-row upserts, resolved last-write-wins on `updated_at`
 *   pull: every row with rev > the client's cursor
 *
 * Whole-row upserts (rather than field deltas) make a replayed batch a no-op, which is what
 * lets the client retry freely after a dropped mobile connection without a dedupe table.
 */

/** Per-table pull cap. Keeps a first sync of five years of history to a bounded response;
 *  the client loops while `more` is true. */
const PULL_LIMIT = 2000;

export async function handleSync(
  db: D1Database,
  member: MemberRecord,
  body: unknown,
  /** Overridable so a test can exercise truncation with a handful of rows. */
  pullLimit = PULL_LIMIT,
): Promise<SyncResponse> {
  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new SyncError(`Malformed sync request: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  const { since, changes } = parsed.data;

  const conflicts: SyncResponse["conflicts"] = [];
  /** Read once, and only if a pushed transaction needs it. */
  let base: string | undefined;

  for (const change of changes) {
    const schema = tableSchemas[change.table];

    // The client may not write to another household, nor forge authorship. Both are set
    // server-side from the verified identity rather than trusted from the payload.
    const candidate: Record<string, unknown> = {
      ...change.row,
      household_id: HOUSEHOLD_ID,
      updated_by: member.id,
    };

    /*
     * A transaction priced by a client older than 1.4.0 arrives without `fx_base`. Left out, the
     * insert fell back to the column default 'UAH' whatever the household's base, and a later base
     * change skipped the row as already converted. The client priced it against the base it knew,
     * which is the current one, so that is what it is stamped with.
     */
    if (change.table === "transactions" && candidate.fx_base == null) {
      base ??= (await householdCurrencies(db)).base;
      candidate.fx_base = base;
    }

    const validated = schema.safeParse(candidate);
    if (!validated.success) {
      throw new SyncError(
        `Invalid ${change.table} row: ${validated.error.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      );
    }
    const row = validated.data as Record<string, unknown> & { id: string; updated_at: number };

    // Last-write-wins. A row older than what is stored loses, and the stored version is
    // returned so the client can heal its local copy instead of retrying forever.
    const stored = await existingUpdatedAt(db, change.table, row.id);
    if (stored !== null && stored > row.updated_at) {
      const winner = await readRow(db, change.table, row.id);
      if (winner) conflicts.push({ table: change.table, row: winner });
      continue;
    }

    // A fresh rev per accepted row keeps the stream strictly ordered, so another device's
    // cursor lands between rows rather than in the middle of a batch. Allocated in the same batch
    // as the write, so the rev never exists without its row — see bumpRevStatement.
    await db.batch([
      bumpRevStatement(db),
      upsertStatement(db, change.table, row, { revInBatch: true }),
    ]);
  }

  // Read the delta only after applying the push, so the response also carries back the
  // caller's own writes with their server-assigned revs.
  const byTable: { table: SyncedTable; rows: Record<string, unknown>[] }[] = [];
  /*
   * Where a truncated table stopped. Each table is capped on its own, so one that hit the cap may
   * have rows *below* revs another table returned. The cursor therefore cannot pass the lowest of
   * these: rows above it are held back for the next round, whichever table they are in.
   */
  let truncatedAt = Number.POSITIVE_INFINITY;

  for (const table of SYNCED_TABLES) {
    let rows = await changesSince(db, table, since, pullLimit);
    if (rows.length === pullLimit) {
      // Finish the last rev: rows sharing it may lie beyond the cap. See changesThrough.
      const lastRev = rows[rows.length - 1]!.rev as number;
      rows = await changesThrough(db, table, since, lastRev);
      truncatedAt = Math.min(truncatedAt, lastRev);
    }
    byTable.push({ table, rows });
  }

  const more = truncatedAt !== Number.POSITIVE_INFINITY;
  const pulled: SyncResponse["changes"] = [];
  let cursor = since;
  for (const { table, rows } of byTable) {
    for (const row of rows) {
      const rev = row.rev as number;
      if (rev > truncatedAt) continue;
      pulled.push({ table, row });
      cursor = Math.max(cursor, rev);
    }
  }

  /*
   * The cursor is the highest rev actually delivered — never the household's head.
   *
   * It used to be the head, read after the pull. With a table truncated at the cap, that jumped
   * the device's cursor over every row the cap held back, and the next round started above them:
   * a new phone with 5 000 transactions would have received 2 000, forever, with "Reset local
   * mirror" repeating the same loss.
   */
  return { rev: cursor, changes: pulled, conflicts, more };
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

/** Full snapshot of a household, used by the export and backup paths. */
export async function dumpHousehold(
  db: D1Database,
): Promise<Record<SyncedTable, Record<string, unknown>[]>> {
  const dump = {} as Record<SyncedTable, Record<string, unknown>[]>;
  for (const table of SYNCED_TABLES) {
    // rev > 0 is every row that has ever been written.
    dump[table] = await changesSince(db, table, 0, Number.MAX_SAFE_INTEGER);
  }
  return dump;
}
