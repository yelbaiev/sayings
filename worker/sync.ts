import {
  HOUSEHOLD_ID,
  SYNCED_TABLES,
  syncRequestSchema,
  tableSchemas,
  type SyncResponse,
  type SyncedTable,
} from "@shared/schema";
import {
  bumpRev,
  changesSince,
  currentRev,
  existingUpdatedAt,
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
): Promise<SyncResponse> {
  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new SyncError(`Malformed sync request: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  const { since, changes } = parsed.data;

  const conflicts: SyncResponse["conflicts"] = [];

  for (const change of changes) {
    const schema = tableSchemas[change.table];

    // The client may not write to another household, nor forge authorship. Both are set
    // server-side from the verified identity rather than trusted from the payload.
    const candidate = {
      ...change.row,
      household_id: HOUSEHOLD_ID,
      updated_by: member.id,
    };

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
    // cursor lands between rows rather than in the middle of a batch.
    const rev = await bumpRev(db);
    await upsertStatement(db, change.table, { ...row, rev }).run();
  }

  // Read the delta only after applying the push, so the response also carries back the
  // caller's own writes with their server-assigned revs.
  const pulled: SyncResponse["changes"] = [];
  let more = false;

  for (const table of SYNCED_TABLES) {
    const rows = await changesSince(db, table, since, PULL_LIMIT);
    if (rows.length === PULL_LIMIT) more = true;
    for (const row of rows) pulled.push({ table, row });
  }

  return { rev: await currentRev(db), changes: pulled, conflicts, more };
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
