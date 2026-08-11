import { HOUSEHOLD_ID } from "@shared/schema";
import { dumpHousehold } from "./sync";

/**
 * Nightly backup to R2.
 *
 * This is the feature the project exists for. Saldo went down for over a week and there was
 * no way to reach the data; the answer is that a full snapshot lands in object storage every
 * night, retention is explicit, and the restore path is documented and tested.
 *
 * Retention: 30 daily, 12 monthly. A month-end snapshot is promoted to the monthly set, so a
 * mistake discovered a year later is still recoverable.
 */

const DAILY_KEEP = 30;
const MONTHLY_KEEP = 12;

export interface BackupResult {
  key: string;
  bytes: number;
  rows: number;
  kind: "daily" | "monthly";
  pruned: string[];
}

function isLastDayOfMonth(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}

export async function runBackup(
  db: D1Database,
  bucket: R2Bucket,
  today: string,
): Promise<BackupResult> {
  const dump = await dumpHousehold(db);
  const { results: rates } = await db
    .prepare(`SELECT on_date, quote, rate FROM fx_rates ORDER BY on_date`)
    .all<Record<string, unknown>>();

  const rows = Object.values(dump).reduce((sum, table) => sum + table.length, 0);
  const kind: "daily" | "monthly" = isLastDayOfMonth(today) ? "monthly" : "daily";

  const payload = JSON.stringify({
    app: "SAYings",
    household_id: HOUSEHOLD_ID,
    created_at: today,
    // Schema version travels with the data: a restore two years from now must be able to
    // tell what shape it is looking at.
    schema: 1,
    tables: { ...dump, fx_rates: rates },
  });

  const key = `backups/${kind}/${today}.json`;
  const body = new TextEncoder().encode(payload);

  await bucket.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows: String(rows), kind },
  });

  await db
    .prepare(
      `INSERT INTO backups (key, household_id, created_at, kind, row_count, bytes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         created_at = excluded.created_at,
         row_count = excluded.row_count,
         bytes = excluded.bytes`,
    )
    .bind(key, HOUSEHOLD_ID, Date.now(), kind, rows, body.byteLength)
    .run();

  const pruned = await prune(bucket, db, kind);

  return { key, bytes: body.byteLength, rows, kind, pruned };
}

/** Deletes snapshots beyond the retention window for one kind. */
async function prune(
  bucket: R2Bucket,
  db: D1Database,
  kind: "daily" | "monthly",
): Promise<string[]> {
  const keep = kind === "monthly" ? MONTHLY_KEEP : DAILY_KEEP;
  const listing = await bucket.list({ prefix: `backups/${kind}/` });

  // Keys are ISO-dated, so lexical order is chronological order.
  const keys = listing.objects.map((object) => object.key).sort();
  const doomed = keys.slice(0, Math.max(0, keys.length - keep));
  if (doomed.length === 0) return [];

  await bucket.delete(doomed);
  await db.batch(doomed.map((key) => db.prepare(`DELETE FROM backups WHERE key = ?`).bind(key)));

  return doomed;
}

export interface BackupSummary {
  key: string;
  created_at: number;
  kind: string;
  row_count: number;
  bytes: number;
}

export async function latestBackup(db: D1Database): Promise<BackupSummary | null> {
  return await db
    .prepare(
      `SELECT key, created_at, kind, row_count, bytes FROM backups
        WHERE household_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(HOUSEHOLD_ID)
    .first<BackupSummary>();
}

export async function listBackups(db: D1Database): Promise<BackupSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT key, created_at, kind, row_count, bytes FROM backups
        WHERE household_id = ? ORDER BY created_at DESC LIMIT 60`,
    )
    .bind(HOUSEHOLD_ID)
    .all<BackupSummary>();
  return results;
}
