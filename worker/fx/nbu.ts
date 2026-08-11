import type { Currency } from "@shared/currency";
import { FxError, type RateAdapter } from "./source";

/**
 * FX rates from the National Bank of Ukraine.
 *
 * Free, no API key, and it carries full history — which matters because importing five years of
 * multi-currency transactions needs five years of rates. It is also the only source of the two that
 * quotes the hryvnia at all.
 *
 * Endpoint choice is deliberate. `NBU_Exchange/exchange_site` exposes `units` and `rate_per_unit`
 * explicitly, where the simpler `statdirectory` endpoint returns only `rate`. NBU quotes some
 * currencies per 10 or per 100 units, so reading `rate` blindly would be silently wrong by a factor
 * of ten for those. USD and EUR happen to be quoted per 1 unit today, but relying on that is exactly
 * the kind of assumption that breaks quietly.
 *
 * Verified against the live endpoint: on 2026-08-04, USD 44.7876 and EUR 51.6423 UAH, both with
 * units = 1.
 *
 * NBU returns a value for every calendar day, including weekends and holidays, carrying the last
 * working day's rate forward — so a same-day lookup normally succeeds and the nearest-prior search on
 * the client is a safety net rather than the usual path.
 */

const ENDPOINT = "https://bank.gov.ua/NBU_Exchange/exchange_site";

interface NbuRow {
  cc?: string;
  rate?: number;
  units?: number;
  rate_per_unit?: number;
  exchangedate?: string;
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD', the form NBU's `date` parameter takes. */
function toNbuDate(iso: string): string {
  return iso.replace(/-/g, "");
}

export const nbu: RateAdapter = {
  source: "nbu",
  pivot: "UAH",

  async fetch(iso: string, quotes: Currency[]): Promise<Map<Currency, number>> {
    const response = await fetch(`${ENDPOINT}?date=${toNbuDate(iso)}&json`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new FxError(`NBU responded ${response.status} for ${iso}`);
    }

    const rows = (await response.json()) as NbuRow[];
    if (!Array.isArray(rows)) {
      throw new FxError(`NBU returned an unexpected shape for ${iso}`);
    }

    const out = new Map<Currency, number>();

    for (const quote of quotes) {
      const row = rows.find((candidate) => candidate.cc === quote);
      if (!row) continue;

      // Prefer the explicitly per-unit figure; fall back to rate/units only if it is absent.
      const perUnit =
        row.rate_per_unit ??
        (typeof row.rate === "number" && typeof row.units === "number" && row.units > 0
          ? row.rate / row.units
          : undefined);

      if (typeof perUnit !== "number" || !Number.isFinite(perUnit) || perUnit <= 0) continue;
      out.set(quote, perUnit);
    }

    return out;
  },
};
