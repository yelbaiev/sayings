import { CURRENCIES, CURRENCY_INFO, type Currency } from "./currencies";

/**
 * Currency and locale helpers.
 *
 * The data itself moved to `./currencies.ts` when the list grew from three to forty-three — see there
 * for why the minor-unit column is the one that has to be right.
 *
 * The rule the palette exists to enforce is unchanged: colour carries exactly one meaning, money
 * direction. That lives in `styles/tokens.css`; this file is about how much a unit is worth.
 */

export { CURRENCIES, CURRENCY_INFO, canPriceAutomatically, sourcesFor, SOURCE_PIVOT } from "./currencies";
export type { Currency, CurrencyInfo, RateSource } from "./currencies";

/**
 * Reads the stored `households.enabled_currencies` array.
 *
 * Tolerant on purpose. The column is JSON in a TEXT field, so it can hold anything an older version,
 * a hand-run SQL statement or a failed write left behind — and the one thing this must never do is
 * throw, because it sits on the path that decides whether the app can start at all. Anything
 * unreadable degrades to the base currency alone, which is always a valid configuration.
 *
 * The base is always included even when the stored list omits it: a household that cannot record a
 * transaction in the currency it reports in has no working state.
 */
export function parseEnabledCurrencies(raw: unknown, base: Currency): Currency[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = null;
    }
  }
  const codes = Array.isArray(list) ? list.filter(isCurrency) : [];
  // Sorted and deduplicated here rather than at each call site, so the pickers and the rate fetcher
  // cannot disagree about order.
  return [...new Set<Currency>([base, ...codes])].sort();
}

/**
 * Digits after the decimal separator, per ISO 4217.
 *
 * Never assume two. The yen has none and the Tunisian dinar has three, and getting it wrong is a
 * hundred- or thousandfold error in stored amounts that nothing else will catch.
 */
export function minorUnitDigits(currency: Currency): number {
  return CURRENCY_INFO[currency].digits;
}

/** Minor units in one major unit — 100 for most, 1 for the yen, 1000 for the dinar. */
export function minorUnitScale(currency: Currency): number {
  return 10 ** minorUnitDigits(currency);
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

export const SUPPORTED_LOCALES = ["en", "uk", "ru"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
