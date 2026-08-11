/**
 * The currencies this app supports, and the two facts about each that matter.
 *
 * **Minor-unit digits are the dangerous column.** Until now every supported currency happened to use
 * two, so `minorUnitDigits` could answer 2 and be right. It is not a property of money in general: the
 * yen has no minor unit at all and the Tunisian dinar has three. Get one wrong and
 * `parseMajorToMinor("500")` stores 50 000 units for ¥500 — a hundredfold error that never throws,
 * never looks odd in a single row, and only shows up as a report that is inexplicably large.
 *
 * The values are ISO 4217. They are data rather than a guess, and `tests/unit/currency.test.ts` checks
 * that a major amount parsed and formatted again comes back unchanged for every one of them.
 *
 * **Source coverage** decides what the app can convert without asking. Nothing here is offered that no
 * source quotes — a currency the app cannot price is a currency whose totals silently stop adding up.
 * A rate can always be corrected by hand on an individual transaction, but that is for when a bank's
 * rate differs from the reference one, not a substitute for having a source.
 */

/** Which upstream publishes a rate for a currency. */
export type RateSource =
  /** European Central Bank reference rates, reached through Frankfurter. Euro-based. */
  | "ecb"
  /** National Bank of Ukraine. Hryvnia-based, and the only source that quotes UAH at all. */
  | "nbu";

export interface CurrencyInfo {
  /** Digits after the decimal separator. ISO 4217. */
  digits: 0 | 2 | 3;
  /** Every source known to quote it. A pair only one source covers is cross-rated through its pivot. */
  sources: RateSource[];
}

/**
 * Both sources, so a household on any of these can be priced against any other.
 *
 * The ECB set was read from its published list rather than assumed, and notably **excludes UAH** —
 * which is why one source cannot serve every household and why these are adapters rather than a
 * function. The NBU-only entries are the regional currencies the ECB does not publish.
 */
export const CURRENCY_INFO = {
  // --- Quoted by both, so available whichever base a household picks.
  AUD: { digits: 2, sources: ["ecb", "nbu"] },
  BRL: { digits: 2, sources: ["ecb", "nbu"] },
  CAD: { digits: 2, sources: ["ecb", "nbu"] },
  CHF: { digits: 2, sources: ["ecb", "nbu"] },
  CNY: { digits: 2, sources: ["ecb", "nbu"] },
  CZK: { digits: 2, sources: ["ecb", "nbu"] },
  DKK: { digits: 2, sources: ["ecb", "nbu"] },
  EUR: { digits: 2, sources: ["ecb", "nbu"] },
  GBP: { digits: 2, sources: ["ecb", "nbu"] },
  HKD: { digits: 2, sources: ["ecb", "nbu"] },
  HUF: { digits: 2, sources: ["ecb", "nbu"] },
  IDR: { digits: 2, sources: ["ecb", "nbu"] },
  ILS: { digits: 2, sources: ["ecb", "nbu"] },
  INR: { digits: 2, sources: ["ecb", "nbu"] },
  // No minor unit. A price is a whole number of krónur.
  ISK: { digits: 0, sources: ["ecb", "nbu"] },
  // No minor unit — the sen was withdrawn in 1953.
  JPY: { digits: 0, sources: ["ecb", "nbu"] },
  // No minor unit in practice; the jeon is not used.
  KRW: { digits: 0, sources: ["ecb", "nbu"] },
  MXN: { digits: 2, sources: ["ecb", "nbu"] },
  MYR: { digits: 2, sources: ["ecb", "nbu"] },
  NOK: { digits: 2, sources: ["ecb", "nbu"] },
  NZD: { digits: 2, sources: ["ecb", "nbu"] },
  PHP: { digits: 2, sources: ["ecb", "nbu"] },
  PLN: { digits: 2, sources: ["ecb", "nbu"] },
  RON: { digits: 2, sources: ["ecb", "nbu"] },
  SEK: { digits: 2, sources: ["ecb", "nbu"] },
  SGD: { digits: 2, sources: ["ecb", "nbu"] },
  THB: { digits: 2, sources: ["ecb", "nbu"] },
  TRY: { digits: 2, sources: ["ecb", "nbu"] },
  USD: { digits: 2, sources: ["ecb", "nbu"] },
  ZAR: { digits: 2, sources: ["ecb", "nbu"] },

  // --- Quoted by the NBU only. A household using one of these with a non-UAH base is priced by
  // cross-rating through the hryvnia.
  UAH: { digits: 2, sources: ["nbu"] },
  AED: { digits: 2, sources: ["nbu"] },
  AZN: { digits: 2, sources: ["nbu"] },
  BGN: { digits: 2, sources: ["nbu"] },
  EGP: { digits: 2, sources: ["nbu"] },
  GEL: { digits: 2, sources: ["nbu"] },
  KZT: { digits: 2, sources: ["nbu"] },
  MDL: { digits: 2, sources: ["nbu"] },
  PKR: { digits: 2, sources: ["nbu"] },
  RSD: { digits: 2, sources: ["nbu"] },
  SAR: { digits: 2, sources: ["nbu"] },
  // Three digits, not two. The millime is a thousandth of a dinar.
  TND: { digits: 3, sources: ["nbu"] },
  // No minor unit; the hào and xu are long out of use.
  VND: { digits: 0, sources: ["nbu"] },
} as const satisfies Record<string, CurrencyInfo>;

export const CURRENCIES = Object.keys(CURRENCY_INFO).sort() as (keyof typeof CURRENCY_INFO)[];

/**
 * Still a union of literals rather than `string`.
 *
 * That is what keeps `z.enum(CURRENCIES)` typing the database and stops a typo becoming a currency.
 * Widening the list from three to forty-three is safe for stored data — the column is TEXT — and the
 * type stays as strict as it was.
 */
export type Currency = keyof typeof CURRENCY_INFO;

/** The pivot each source quotes everything against. */
export const SOURCE_PIVOT: Record<RateSource, Currency> = { ecb: "EUR", nbu: "UAH" };

/** Sources that can price this currency directly. Empty means it must be entered by hand. */
export function sourcesFor(currency: Currency): readonly RateSource[] {
  return CURRENCY_INFO[currency].sources;
}

/**
 * Whether a pair can be priced automatically — directly or by cross-rating through a shared pivot.
 *
 * Used by the currency picker, so someone choosing a base can see which of their currencies will be
 * converted for them and which will ask every time.
 */
export function canPriceAutomatically(quote: Currency, base: Currency): boolean {
  if (quote === base) return true;
  const shared = sourcesFor(quote).filter((source) => sourcesFor(base).includes(source));
  return shared.length > 0;
}
