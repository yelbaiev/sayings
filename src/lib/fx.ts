import type { Currency } from "@shared/currency";

/**
 * FX rate lookup on the client.
 *
 * Rates are mirrored locally like everything else, so a rate can be found with no network.
 * The lookup is nearest-prior rather than exact-date, which is both robust and *correct*:
 * the NBU publishes no rate for weekends or public holidays, so the applicable rate on a
 * Sunday genuinely is Friday's.
 */

export interface FxLookup {
  rate: number;
  /** True when no rate at or before the date was available, so a fallback was used. */
  estimated: boolean;
}

export interface RateRow {
  on_date: string;
  quote: string;
  rate: number;
}

/** In-memory cache of the local rate table, refreshed when a sync brings new rows. */
let cache: RateRow[] | null = null;

export function primeRateCache(rows: RateRow[]): void {
  cache = [...rows].sort((a, b) => a.on_date.localeCompare(b.on_date));
}

export function clearRateCache(): void {
  cache = null;
}

/**
 * Finds the rate for a currency on a date, in base-currency units per 1 unit of `currency`.
 *
 * Pure, so it can be tested without a database. `rows` must be sorted by date ascending.
 */
export function lookupRate(
  rows: readonly RateRow[],
  currency: Currency,
  onDate: string,
  base: Currency,
): FxLookup {
  if (currency === base) return { rate: 1, estimated: false };

  let best: RateRow | undefined;
  for (const row of rows) {
    if (row.quote !== currency) continue;
    if (row.on_date > onDate) break; // sorted ascending, so nothing later can qualify
    best = row;
  }

  if (best) return { rate: best.rate, estimated: false };

  // No rate at or before this date. Fall back to the earliest known rate for the currency
  // rather than refusing the save — the transaction still gets recorded, flagged for a later
  // reconcile pass. Losing the entry would be far worse than an approximate base figure.
  const earliest = rows.find((row) => row.quote === currency);
  return { rate: earliest?.rate ?? 1, estimated: true };
}

/** Reads from the local mirror, loading it on first use. */
export async function rateFor(
  currency: Currency,
  onDate: string,
  base: Currency,
): Promise<FxLookup> {
  if (currency === base) return { rate: 1, estimated: false };

  if (!cache) {
    const { db } = await import("~/db/dexie");
    const rows = await db.fxRates.toArray();
    primeRateCache(rows);
  }

  return lookupRate(cache ?? [], currency, onDate, base);
}

/** Converts to base currency using the rate applicable on a date. */
export async function toBase(
  amountMinor: number,
  currency: Currency,
  onDate: string,
  base: Currency,
): Promise<{ minor: number; rate: number; estimated: boolean }> {
  const { rate, estimated } = await rateFor(currency, onDate, base);
  const scaled = amountMinor * rate;
  return {
    minor: Math.sign(scaled) * Math.round(Math.abs(scaled)),
    rate,
    estimated,
  };
}

/**
 * The pricing fields for a copy of a transaction re-dated to `onDate`.
 *
 * Duplicate and repeat-last both move a row to today, and copying its rate along with it kept the
 * original day's figure — a euro coffee from March repeated in October at March's rate, marked
 * "manual" if the original was, which also shielded it from every later correction.
 */
export async function pricingFor(
  amountMinor: number,
  currency: Currency,
  onDate: string,
  base: Currency,
): Promise<{
  base_amount_minor: number;
  fx_rate: number;
  fx_estimated: 0 | 1;
  fx_source: string;
  fx_base: Currency;
}> {
  const { rate, estimated } = await rateFor(currency, onDate, base);
  return {
    base_amount_minor: Math.round(amountMinor * rate),
    fx_rate: rate,
    fx_estimated: estimated ? 1 : 0,
    fx_source: estimated ? "estimated" : "auto",
    fx_base: base,
  };
}
