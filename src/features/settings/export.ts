import type { Locale } from "@shared/currency";
import { SYNCED_TABLES } from "@shared/schema";
import { db } from "~/db/dexie";
import { todayIso } from "~/lib/format";

/**
 * Client-side export of everything.
 *
 * The whole point of the project: the data must be retrievable without asking anyone's
 * permission, including ours. This runs entirely against the local mirror, so it works with
 * no network and no server involvement at all — if this app's backend disappeared tomorrow,
 * this button would still work.
 */

/** RFC 4180 quoting. Values containing a comma, quote, or newline get wrapped and escaped. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  // Union of keys across all rows, so a column present on only some rows is not silently lost.
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return lines.join("\n");
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface ExportBundle {
  exported_at: string;
  app: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function buildExport(): Promise<ExportBundle> {
  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const table of SYNCED_TABLES) {
    // Soft-deleted rows are included on purpose: an archive that quietly omits deletions is
    // not a faithful copy, and a restore needs them to reproduce the same state.
    tables[table] = (await db[table].toArray()) as unknown as Record<string, unknown>[];
  }
  tables.fx_rates = (await db.fxRates.toArray()) as unknown as Record<string, unknown>[];

  return {
    exported_at: new Date().toISOString(),
    app: "SAYings",
    tables,
  };
}

/**
 * Downloads one JSON bundle plus a CSV per table.
 *
 * Both formats deliberately: JSON round-trips exactly for a restore, CSV opens in a
 * spreadsheet so the data is legible without any software of ours.
 */
export async function exportEverything(_locale: Locale): Promise<void> {
  const bundle = await buildExport();
  const stamp = todayIso();

  download(
    `sayings-${stamp}.json`,
    JSON.stringify(bundle, null, 2),
    "application/json",
  );

  for (const [table, rows] of Object.entries(bundle.tables)) {
    if (rows.length === 0) continue;
    download(`sayings-${table}-${stamp}.csv`, toCsv(rows), "text/csv;charset=utf-8");
  }
}
