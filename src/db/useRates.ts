import type { Currency } from "@shared/currency";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./dexie";

/**
 * The most recent rate held for each currency, for *current* figures like a net-worth total.
 *
 * Deliberately not used for historical reports: those read each transaction's own snapshotted
 * rate, so last year's totals do not move when today's rate does.
 */
export function useLatestRates(base: Currency): Map<string, number> {
  return (
    useLiveQuery(async () => {
      const rows = await db.fxRates.orderBy("on_date").toArray();
      const latest = new Map<string, number>([[base, 1]]);
      // Ascending by date, so the last write per currency wins.
      for (const row of rows) latest.set(row.quote, row.rate);
      return latest;
    }, [base]) ?? new Map<string, number>([[base, 1]])
  );
}

/** Converts to the household base currency at today's rate. Returns null if no rate is held. */
export function toBaseAtLatest(
  minor: number,
  currency: Currency,
  rates: Map<string, number>,
  base: Currency,
): number | null {
  if (currency === base) return minor;
  const rate = rates.get(currency);
  if (!rate) return null;
  const scaled = minor * rate;
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

/**
 * Base currency to another, at today's rate. Null when no rate is held for it.
 *
 * The mirror of `toBaseAtLatest`, and the reason both exist rather than one with a flag: the map
 * holds base-per-quote, so one multiplies and the other divides, and a single function taking a
 * direction is a function whose call sites read the same whichever way they are wrong.
 */
export function fromBaseAtLatest(
  minor: number,
  currency: Currency,
  rates: Map<string, number>,
  base: Currency,
): number | null {
  if (currency === base) return minor;
  const rate = rates.get(currency);
  if (!rate) return null;
  const scaled = minor / rate;
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}
