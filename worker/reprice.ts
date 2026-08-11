import { isCurrency, type Currency } from "@shared/currency";
import { HOUSEHOLD_ID } from "@shared/schema";
import { bumpRev, householdCurrencies } from "./db";

/**
 * Changing the household's reporting currency.
 *
 * **What this does not touch:** `amount_minor`, `opening_balance_minor`, or any account balance. Those
 * are in each account's own currency and are reconciled against real cards and statements — a hryvnia
 * card holds hryvnia whatever the household reports in. What moves is `base_amount_minor`, the
 * denormalised roll-up that reports add together, and the transaction's own `fx_rate`.
 *
 * **No network.** The rates needed are already here, and that is not luck: a base is changed to a
 * currency the household already transacts in, so `fx_rates` already holds the pair for every date it
 * has ever needed. Given hryvnia-per-euro and hryvnia-per-dollar on a date, euro-per-dollar is a
 * division. A backfill in the new base would be thousands of requests to someone else's free API for
 * numbers that can be derived exactly.
 *
 * **Resumable, and idempotent, by construction.** Everything is driven by "rows not yet in the new
 * base", so an interrupted run is finished by running again and a finished run does nothing. That
 * property is not a nicety here: converting a row twice would not fail, it would multiply by a rate
 * again and leave a plausible number in a ledger.
 *
 * **Bounded per call**, like the FX backfill: the caller repeats until `remaining` is zero, so no
 * single invocation can exceed the Worker's CPU limit on a household with years of history.
 */

export interface RepriceResult {
  base: Currency;
  /** Rate dates converted in this call. */
  dates: number;
  /** Transactions re-priced in this call. */
  transactions: number;
  /** Transactions still to do. Call again while this is above zero. */
  remaining: number;
  /**
   * Dates whose rates could not be converted because the new base was not quoted on them.
   *
   * Reported rather than swallowed. Transactions on those dates fall back to the nearest prior rate,
   * which is the same convention the rest of the app uses, but a household should be told rather than
   * left to notice.
   */
  skippedDates: string[];
}

const DATES_PER_CALL = 400;
const ROWS_PER_CALL = 500;

/**
 * Converts stored rates from the old base to the new one, one date at a time.
 *
 * Per date rather than per row, because the conversion needs that date's old-base-per-new-base figure
 * as its divisor — so a date is either fully converted or untouched, never half. The row for the old
 * base is written as the reciprocal, which is what lets a hand-entered rate be carried across later.
 */
async function convertRates(
  db: D1Database,
  oldBase: Currency,
  newBase: Currency,
): Promise<{ dates: number; skipped: string[] }> {
  const { results: pending } = await db
    .prepare(
      `SELECT DISTINCT on_date FROM fx_rates WHERE base != ? ORDER BY on_date ASC LIMIT ?`,
    )
    .bind(newBase, DATES_PER_CALL)
    .all<{ on_date: string }>();

  const skipped: string[] = [];
  let converted = 0;

  for (const { on_date } of pending) {
    const { results: rows } = await db
      .prepare(`SELECT quote, rate, source FROM fx_rates WHERE on_date = ? AND base != ?`)
      .bind(on_date, newBase)
      .all<{ quote: string; rate: number; source: string }>();

    const divisor = rows.find((row) => row.quote === newBase)?.rate;
    if (!divisor || !Number.isFinite(divisor) || divisor <= 0) {
      // The new base was not quoted on this date, so nothing on this date can be expressed in it.
      skipped.push(on_date);
      continue;
    }

    const statements = [
      // Start from a clean date: the new base's own row would be a rate of 1 against itself, and
      // leaving the old rows would make the date ambiguous.
      db.prepare(`DELETE FROM fx_rates WHERE on_date = ?`).bind(on_date),
      // The old base becomes an ordinary quoted currency, at the reciprocal.
      db
        .prepare(
          `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES (?, ?, ?, 'derived', ?)`,
        )
        .bind(on_date, oldBase, 1 / divisor, newBase),
    ];

    for (const row of rows) {
      if (row.quote === newBase) continue;
      statements.push(
        db
          .prepare(
            `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(on_date, row.quote, row.rate / divisor, row.source, newBase),
      );
    }

    await db.batch(statements);
    converted++;
  }

  return { dates: converted, skipped };
}

/**
 * Re-prices transactions not yet expressed in the new base.
 *
 * A hand-entered rate is **carried across, not discarded**. Someone typed it because it is what their
 * bank actually charged, and that fact survives a change of reporting currency: the same rate in the
 * new base is `manualRate × newBasePerOldBase` on that date, which is the reciprocal row written by
 * `convertRates`. Throwing it away and substituting a reference rate would silently undo a correction
 * made to match a statement.
 *
 * Every row also gets a fresh `rev`, and that is not bookkeeping. Clients pull "everything since rev
 * N", so a re-priced row with its old revision is a row no client will ever hear about: the phone would
 * keep serving the previous figures from its mirror indefinitely, with no way to tell it is stale. One
 * revision for the whole batch is enough — the cursor only has to move past it.
 */
async function repriceTransactions(
  db: D1Database,
  oldBase: Currency,
  newBase: Currency,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.amount_minor, t.currency, t.occurred_on, t.fx_rate, t.fx_source,
              (SELECT rate FROM fx_rates f
                WHERE f.quote = t.currency AND f.base = ? AND f.on_date <= t.occurred_on
                ORDER BY f.on_date DESC LIMIT 1) AS source_rate,
              (SELECT rate FROM fx_rates f
                WHERE f.quote = ? AND f.base = ? AND f.on_date <= t.occurred_on
                ORDER BY f.on_date DESC LIMIT 1) AS old_base_rate
         FROM transactions t
        WHERE t.fx_base != ? AND t.deleted = 0
        ORDER BY t.occurred_on ASC
        LIMIT ?`,
    )
    .bind(newBase, oldBase, newBase, newBase, ROWS_PER_CALL)
    .all<{
      id: string;
      amount_minor: number;
      currency: string;
      occurred_on: string;
      fx_rate: number;
      fx_source: string | null;
      source_rate: number | null;
      old_base_rate: number | null;
    }>();

  if (results.length === 0) return 0;

  const rev = await bumpRev(db);
  const now = Date.now();

  const statements = results.map((row) => {
    const rate = rateFor(row, oldBase, newBase);
    const scaled = row.amount_minor * rate;
    const baseAmount = Math.sign(scaled) * Math.round(Math.abs(scaled));

    return db
      .prepare(
        `UPDATE transactions
            SET base_amount_minor = ?, fx_rate = ?, fx_base = ?, fx_estimated = ?,
                rev = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        baseAmount,
        rate,
        newBase,
        rate === 1 && row.currency !== newBase ? 1 : 0,
        rev,
        now,
        row.id,
      );
  });

  await db.batch(statements);
  return results.length;
}

/** The rate to use for one row, in the new base. Exported shape kept narrow deliberately. */
function rateFor(
  row: {
    currency: string;
    fx_rate: number;
    fx_source: string | null;
    source_rate: number | null;
    old_base_rate: number | null;
  },
  oldBase: Currency,
  newBase: Currency,
): number {
  // Already in the currency being reported in.
  if (row.currency === newBase) return 1;

  // A rate the person entered, carried across rather than replaced.
  if (row.fx_source === "manual" && row.old_base_rate) return row.fx_rate * row.old_base_rate;

  // The old base is now an ordinary quoted currency, and its reciprocal row is the answer.
  if (row.currency === oldBase && row.old_base_rate) return row.old_base_rate;

  if (row.source_rate && Number.isFinite(row.source_rate) && row.source_rate > 0) {
    return row.source_rate;
  }

  // No rate on or before that date. 1 keeps the row readable and `fx_estimated` marks it for the
  // nightly reconcile, which is the same treatment an entry saved offline gets.
  return 1;
}

/**
 * Changes the reporting currency and re-prices what has already been recorded.
 *
 * The household's base is written **first**, deliberately. Either order leaves an interrupted run in a
 * mixed state; writing it first is the order in which the mixed state is *self-correcting*, because
 * every remaining row is then visibly not in the current base and a repeat call finds it. Writing it
 * last would leave converted rows that nothing could identify as converted.
 */
export async function repriceToBase(db: D1Database, next: unknown): Promise<RepriceResult> {
  if (!isCurrency(next)) throw new Error(`Unsupported base currency: ${String(next)}`);

  const { base: current, enabled } = await householdCurrencies(db);

  /*
   * The currency being converted *from*, remembered across calls.
   *
   * A resumed run cannot read it from the household, because the first call already switched that —
   * and without it the conversion loses the one number it cannot derive: which currency the remaining
   * rows are priced in. It would still find rows to convert and would still produce plausible figures,
   * which is the worst possible failure for this operation.
   */
  const marker = await db
    .prepare(`SELECT value FROM app_meta WHERE key = 'reprice_from'`)
    .first<{ value: string }>();
  const oldBase: Currency = isCurrency(marker?.value) ? marker.value : current;

  if (oldBase === next) {
    // Nothing to convert from: either already done, or the household is asking for the base it has.
    const { count } = (await db
      .prepare(`SELECT COUNT(*) AS count FROM transactions WHERE fx_base != ? AND deleted = 0`)
      .bind(next)
      .first<{ count: number }>()) ?? { count: 0 };
    if (count === 0) return { base: next, dates: 0, transactions: 0, remaining: 0, skippedDates: [] };
  }

  if (current !== next) {
    const withNew = enabled.includes(next) ? enabled : [...enabled, next].sort();
    await db.batch([
      db
        .prepare(`UPDATE households SET base_currency = ?, enabled_currencies = ? WHERE id = ?`)
        .bind(next, JSON.stringify(withNew), HOUSEHOLD_ID),
      db
        .prepare(
          `INSERT INTO app_meta (key, value, updated_at) VALUES ('reprice_from', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(oldBase, Date.now()),
    ]);
  }

  const rates = await convertRates(db, oldBase, next);
  const transactions = await repriceTransactions(db, oldBase, next);

  const { count } = (await db
    .prepare(`SELECT COUNT(*) AS count FROM transactions WHERE fx_base != ? AND deleted = 0`)
    .bind(next)
    .first<{ count: number }>()) ?? { count: 0 };

  // Cleared only when there is nothing left, so an interrupted run keeps the one fact it needs.
  if (count === 0) {
    await db.prepare(`DELETE FROM app_meta WHERE key = 'reprice_from'`).run();
  }

  return {
    base: next,
    dates: rates.dates,
    transactions,
    remaining: count,
    skippedDates: rates.skipped,
  };
}
