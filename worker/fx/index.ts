import { CURRENCIES, SOURCE_PIVOT, type Currency, type RateSource } from "@shared/currency";
import { householdCurrencies } from "../db";
import { ecb } from "./ecb";
import { nbu } from "./nbu";
import { crossRate, sourceFor } from "./resolve";
import type { RateAdapter } from "./source";

/**
 * Rate fetching, storage, and the nightly job.
 *
 * Two sources behind one interface (`./source.ts`), chosen per *pair* rather than per household: a
 * household reporting in euro and holding hryvnia needs NBU for that pair and the ECB for the rest,
 * and nothing about the household as a whole decides which. `./resolve.ts` holds the arithmetic,
 * separately and purely, because an inverted cross-rate is not an error — it is a plausible number
 * about 1/1600th of the right one, written into `base_amount_minor` where nothing questions it.
 */

export { FxError } from "./source";

const ADAPTERS: Record<string, RateAdapter> = { nbu, ecb };

/**
 * The currencies this household needs a rate for: everything it has enabled or already holds, minus
 * the base, whose rate is 1 by definition.
 *
 * Derived from the household rather than from the supported list. When the list held three currencies
 * those were the same thing; at forty-three they are not, and fetching all of them would write forty
 * rows a night for currencies nobody holds — and turn a five-year backfill into ~84,000 writes,
 * against the 100,000-a-day free-tier ceiling SELF-HOSTING.md already warns about.
 *
 * The enabled set is included even where no account uses it yet, so the first transaction in a newly
 * added currency is priced from a real rate rather than being marked estimated and corrected
 * overnight. Held-but-not-enabled is also covered, because an account can outlive its setting.
 */
export async function quotedCurrencies(
  db: D1Database,
): Promise<{ base: Currency; quoted: Currency[] }> {
  const { base, enabled } = await householdCurrencies(db);

  const { results } = await db
    .prepare(
      `SELECT DISTINCT currency FROM accounts WHERE deleted = 0
        UNION SELECT DISTINCT currency FROM transactions WHERE deleted = 0`,
    )
    .all<{ currency: string }>();

  const wanted = new Set<string>([...enabled, ...results.map((row) => row.currency)]);
  wanted.delete(base);
  // Intersected with what is supported, so a row holding something unrecognised cannot make the
  // fetcher ask an upstream for a currency that does not exist.
  //
  // The base comes back with the list because every caller needs both, and reading the household row
  // twice is how the two would eventually disagree.
  return { base, quoted: CURRENCIES.filter((code) => wanted.has(code)) };
}

export interface FetchedRate {
  onDate: string;
  quote: Currency;
  /** Base currency units per one unit of `quote`. */
  rate: number;
  /** Which upstream produced it. Recorded because it depends on the pair, not on the household. */
  source: RateSource;
}

/**
 * Every rate needed for one date, in the household's base.
 *
 * Grouped by source before fetching, so a day costs one request per source rather than one per
 * currency — and each source is asked for its pivot alongside the currencies, because cross-rating
 * needs pivot-per-base as well as pivot-per-quote.
 *
 * A source that fails takes only its own pairs with it. The alternative — one failure abandoning the
 * date — would mean a single upstream outage leaving a household with no rates for currencies its
 * other source covers perfectly well.
 */
export async function fetchRatesForDate(
  iso: string,
  quoted: Currency[],
  base: Currency,
): Promise<FetchedRate[]> {
  const bySource = new Map<string, Currency[]>();
  const unpriceable: Currency[] = [];

  for (const quote of quoted) {
    const source = sourceFor(quote, base);
    if (!source) {
      unpriceable.push(quote);
      continue;
    }
    bySource.set(source, [...(bySource.get(source) ?? []), quote]);
  }

  if (unpriceable.length > 0) {
    // Not thrown: the rest of the date is still worth storing. Logged because a currency no source
    // covers is a configuration problem the owner can act on, not a transient failure.
    console.error(`No rate source covers ${unpriceable.join(", ")} against ${base}`);
  }

  const out: FetchedRate[] = [];

  for (const [source, quotes] of bySource) {
    const adapter = ADAPTERS[source];
    if (!adapter) continue;

    try {
      const pivot = SOURCE_PIVOT[adapter.source];
      // The base is requested alongside the quotes: cross-rating divides by pivot-per-base, and when
      // the base *is* the pivot that divisor is 1 rather than something to look up.
      const needed = base === pivot ? quotes : [...quotes, base];
      const published = await adapter.fetch(iso, needed);
      const pivotPerBase = base === pivot ? 1 : published.get(base);

      for (const quote of quotes) {
        const rate = crossRate(published.get(quote), pivotPerBase);
        if (rate === null) continue;
        out.push({ onDate: iso, quote, rate, source: adapter.source });
      }
    } catch (error) {
      console.error(`FX source ${source} failed for ${iso}:`, (error as Error).message);
    }
  }

  return out;
}

/**
 * Idempotent upsert, so a re-run or an overlapping backfill costs nothing.
 *
 * `base` is stored on the row rather than implied. It used to be implied — every row meant hryvnia per
 * unit, because hryvnia was compiled in — and with the base configurable that implication would become
 * a silent reinterpretation of five years of history the moment someone changed it.
 *
 * The conflict target stays (on_date, quote), so the table holds rates in the *current* base and a
 * base change overwrites rather than accumulating a second set nothing would read. `source` is
 * recorded per row now too: which upstream priced a pair depends on the pair, so a table-wide default
 * of 'nbu' would have been wrong as soon as the second source existed.
 */
export async function storeRates(
  db: D1Database,
  rates: FetchedRate[],
  base: Currency,
): Promise<number> {
  if (rates.length === 0) return 0;

  await db.batch(
    rates.map((rate) =>
      db
        .prepare(
          `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(on_date, quote) DO UPDATE
             SET rate = excluded.rate, source = excluded.source, base = excluded.base`,
        )
        .bind(rate.onDate, rate.quote, rate.rate, rate.source, base),
    ),
  );

  return rates.length;
}

/**
 * Rates changed since a date, for the client to mirror.
 *
 * `base` rides along so the client can tell whether its mirror is still expressed in the currency it
 * is now reporting in. Without it, a base change would leave the client holding old-base rates for
 * every historical date — it syncs forward from its newest row, so nothing would ever refetch them.
 */
export async function ratesSince(
  db: D1Database,
  since: string,
): Promise<{ on_date: string; quote: string; rate: number; base: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT on_date, quote, rate, base FROM fx_rates
        WHERE on_date >= ?
        ORDER BY on_date ASC`,
    )
    .bind(since)
    .all<{ on_date: string; quote: string; rate: number; base: string }>();
  return results;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface BackfillResult {
  requested: number;
  stored: number;
  failedDates: string[];
}

/**
 * Fills a date range, skipping days already present.
 *
 * Sequential with a small delay rather than parallel: this is someone else's free public API
 * and a five-year backfill is ~1800 days. Hammering it would be rude and is the fastest way
 * to get rate-limited mid-import.
 */
export async function backfillRange(
  db: D1Database,
  fromIso: string,
  toIso: string,
  options: { delayMs?: number; maxDays?: number } = {},
): Promise<BackfillResult> {
  const { delayMs = 120, maxDays = 400 } = options;

  const { results: existing } = await db
    .prepare(`SELECT DISTINCT on_date FROM fx_rates WHERE on_date BETWEEN ? AND ?`)
    .bind(fromIso, toIso)
    .all<{ on_date: string }>();
  const have = new Set(existing.map((row) => row.on_date));

  const wanted: string[] = [];
  for (let cursor = fromIso; cursor <= toIso; cursor = addDays(cursor, 1)) {
    if (!have.has(cursor)) wanted.push(cursor);
    // Bounded per call so one invocation cannot exceed the Worker's CPU limit; the caller
    // repeats until `requested` comes back zero.
    if (wanted.length >= maxDays) break;
  }

  const { base, quoted } = await quotedCurrencies(db);
  if (quoted.length === 0) return { requested: 0, stored: 0, failedDates: [] };

  let stored = 0;
  const failedDates: string[] = [];

  for (const date of wanted) {
    try {
      stored += await storeRates(db, await fetchRatesForDate(date, quoted, base), base);
    } catch (error) {
      // One bad day must not abandon the rest of the range.
      console.error(`FX backfill failed for ${date}:`, (error as Error).message);
      failedDates.push(date);
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { requested: wanted.length, stored, failedDates };
}

/**
 * Daily cron: today plus a few days back.
 *
 * The lookback covers a missed run or a late NBU publication without needing a separate
 * repair job — the upsert makes re-fetching a day free.
 */
export async function runDailyFxUpdate(db: D1Database, today: string): Promise<number> {
  const { base, quoted } = await quotedCurrencies(db);
  if (quoted.length === 0) return 0;

  let stored = 0;
  for (let offset = 0; offset >= -3; offset--) {
    const date = addDays(today, offset);
    try {
      stored += await storeRates(db, await fetchRatesForDate(date, quoted, base), base);
    } catch (error) {
      console.error(`FX daily update failed for ${date}:`, (error as Error).message);
    }
  }
  return stored;
}

/**
 * Re-prices transactions saved offline with no rate available.
 *
 * Those rows were stored with `fx_estimated = 1` rather than being refused — losing an entry would be
 * far worse than an approximate base figure — and this corrects them once the real rate arrives.
 *
 * **Scoped to `fx_source = 'estimated'`, and that is the whole point of the column.** It used to
 * re-price everything flagged estimated, which is right for a row saved offline and destructive for
 * one whose rate was corrected by hand to match a bank statement: this job would replace the person's
 * own figure with the central bank's, overnight, with no error and no record. The only symptom would
 * be a number that drifted back while nobody was looking.
 *
 * `fx_estimated = 1` is still required alongside it, so a row written by an older client — which sets
 * the flag but not the column — is still repaired.
 */
export async function reconcileEstimatedRates(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.amount_minor, t.currency, t.occurred_on,
              (SELECT rate FROM fx_rates f
                WHERE f.quote = t.currency AND f.on_date <= t.occurred_on
                ORDER BY f.on_date DESC LIMIT 1) AS resolved_rate
         FROM transactions t
        WHERE t.fx_estimated = 1 AND t.fx_source != 'manual' AND t.deleted = 0
        LIMIT 500`,
    )
    .all<{
      id: string;
      amount_minor: number;
      currency: string;
      occurred_on: string;
      resolved_rate: number | null;
    }>();

  const fixable = results.filter((row) => row.resolved_rate !== null);
  if (fixable.length === 0) return 0;

  await db.batch(
    fixable.map((row) => {
      const scaled = row.amount_minor * row.resolved_rate!;
      const base = Math.sign(scaled) * Math.round(Math.abs(scaled));
      return db
        .prepare(
          `UPDATE transactions
              SET base_amount_minor = ?, fx_rate = ?, fx_estimated = 0, fx_source = 'auto'
            WHERE id = ?`,
        )
        .bind(base, row.resolved_rate, row.id);
    }),
  );

  return fixable.length;
}
