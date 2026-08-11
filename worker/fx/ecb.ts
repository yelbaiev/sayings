import type { Currency } from "@shared/currency";
import { FxError, type RateAdapter } from "./source";

/**
 * European Central Bank reference rates, reached through Frankfurter.
 *
 * Free, no key, and it serves the ECB's full historical series, which is what a backfill needs. It
 * covers 30 currencies plus the euro and — verified against the live API — **the hryvnia is not among
 * them.** That single absence is why this app has two sources rather than one adapter with a
 * configurable base.
 *
 * Frankfurter quotes *units of the currency per one euro*, the opposite direction from what the
 * resolver wants, so each figure is inverted here. Doing it in the adapter keeps the resolver's
 * arithmetic uniform: every source answers in pivot-per-unit, whichever way its upstream publishes.
 *
 * The ECB publishes on business days only. Asked for a weekend, Frankfurter answers with the nearest
 * previous business day and says so in `date` — which is the correct rate for that Sunday, and the
 * same convention the client's nearest-prior lookup already uses.
 *
 * **Dependency risk, stated rather than discovered later.** Frankfurter is a third party hosting ECB
 * data. If it stops, this adapter is the only file that changes: the ECB's own XML feed carries the
 * same numbers.
 */

const ENDPOINT = "https://api.frankfurter.app";

interface FrankfurterResponse {
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

export const ecb: RateAdapter = {
  source: "ecb",
  pivot: "EUR",

  async fetch(iso: string, quotes: Currency[]): Promise<Map<Currency, number>> {
    const wanted = quotes.filter((code) => code !== "EUR");
    // Asking for nothing would return every currency it has; asking for the pivot alone is a request
    // with no answer. Either way there is nothing to fetch.
    if (wanted.length === 0) return new Map();

    const url = `${ENDPOINT}/${iso}?base=EUR&symbols=${wanted.join(",")}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });

    if (!response.ok) {
      throw new FxError(`Frankfurter responded ${response.status} for ${iso}`);
    }

    const body = (await response.json()) as FrankfurterResponse;
    if (!body.rates || typeof body.rates !== "object") {
      throw new FxError(`Frankfurter returned an unexpected shape for ${iso}`);
    }

    const out = new Map<Currency, number>();
    for (const quote of wanted) {
      const perEuro = body.rates[quote];
      if (typeof perEuro !== "number" || !Number.isFinite(perEuro) || perEuro <= 0) continue;
      // Published as quote-per-euro; the resolver wants euro-per-quote.
      out.set(quote, 1 / perEuro);
    }
    return out;
  },
};
