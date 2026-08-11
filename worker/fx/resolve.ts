import { sourcesFor, type Currency, type RateSource } from "@shared/currency";

/**
 * Which source can price a pair, and how to get from its pivot to the pair.
 *
 * Pure and separate from the fetching, because this is the part where a mistake is expensive and
 * invisible: an inverted cross-rate is not an error, it is a number about 1/1600th of the right one
 * that lands in `base_amount_minor` and stays there.
 *
 *   rate(quote → base) = pivotPerQuote / pivotPerBase
 *
 * Read it as cancelling the pivot: hryvnia-per-dollar over hryvnia-per-euro leaves euro per dollar.
 * When the base *is* the pivot, `pivotPerBase` is 1 and it degenerates to the direct quote, which is
 * why one formula covers both cases rather than a special case per source.
 */

/** A source that quotes both sides of the pair, preferring one whose pivot is the base. */
export function sourceFor(quote: Currency, base: Currency): RateSource | null {
  const shared = sourcesFor(quote).filter((source) => sourcesFor(base).includes(source));
  if (shared.length === 0) return null;
  // A source whose pivot is the base needs no cross-rating, so its answer involves one published
  // number rather than two — half the rounding and half the chances of a missing quote.
  const direct = shared.find((source) => (source === "nbu" ? base === "UAH" : base === "EUR"));
  return direct ?? shared[0]!;
}

/**
 * Cross-rates through the pivot both figures share.
 *
 * Returns null rather than a guess when either side is missing — a household is better served by a
 * transaction marked estimated and corrected overnight than by a plausible wrong number.
 */
export function crossRate(
  pivotPerQuote: number | undefined,
  pivotPerBase: number | undefined,
): number | null {
  if (!pivotPerQuote || !Number.isFinite(pivotPerQuote) || pivotPerQuote <= 0) return null;
  if (!pivotPerBase || !Number.isFinite(pivotPerBase) || pivotPerBase <= 0) return null;
  return pivotPerQuote / pivotPerBase;
}
