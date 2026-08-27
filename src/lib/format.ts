import { minorToMajor, type Minor } from "@shared/money";
import { minorUnitDigits, type Currency, type Locale } from "@shared/currency";
import { translate, type MessageKey } from "~/i18n";

/**
 * All user-facing formatting. Everything goes through `Intl`, so each user sees their own
 * conventions: `uk` and `ru` render ₴1 240,00 with a space group separator and a comma
 * decimal, `en` renders ₴1,240.00. No format is hardcoded.
 */

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(locale: Locale, currency: Currency, cents: boolean): Intl.NumberFormat {
  const key = `${locale}:${currency}:${cents}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      // Without this, ICU falls back to ISO codes for currencies a locale has no default
      // symbol for: UAH renders as "UAH 1,240" in `en`, and EUR as "1 240 EUR" in `uk`.
      // Both are wrong for a household that thinks in ₴, € and $.
      currencyDisplay: "narrowSymbol",
      // The currency's own digits, not two. ICU would otherwise be asked for ¥500.00, which has a
      // minor unit the yen does not have, and would round a Tunisian dinar's three digits to two —
      // showing a different number from the one stored.
      minimumFractionDigits: cents ? minorUnitDigits(currency) : 0,
      maximumFractionDigits: cents ? minorUnitDigits(currency) : 0,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

export interface MoneyFormatOptions {
  /** Show minor units. Off in lists, where cents are noise; on in detail views. */
  cents?: boolean;
  /** Always show a leading + or −, for cashflow figures where direction is the point. */
  signed?: boolean;
}

/**
 * Formats minor units for display.
 *
 * Uses a real minus (−, U+2212) rather than a hyphen: at the type sizes amounts are shown at,
 * a hyphen reads as a dash and is easy to miss entirely.
 */
export function formatMoney(
  amountMinor: Minor,
  currency: Currency,
  locale: Locale,
  options: MoneyFormatOptions = {},
): string {
  const { cents = false, signed = false } = options;
  const magnitude = Math.abs(minorToMajor(amountMinor, currency));
  const body = currencyFormatter(locale, currency, cents).format(magnitude);

  if (amountMinor < 0) return `−${body}`;
  if (signed && amountMinor > 0) return `+${body}`;
  return body;
}

/**
 * The locale's own decimal separator — "," for ru/uk, "." for en.
 *
 * Hardcoding either would print a character the user does not type on paper, and it has to match
 * what the keypad's own key prints, so both read it from here.
 */
export function decimalSeparator(locale: Locale): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? "."
  );
}

/**
 * Formats a *typed* digit string — "45", "45.", "45.0", "1240.50" — for display.
 *
 * The difference from `formatMoney` is the whole point: this echoes the keys rather than the
 * value. `45.` keeps its separator, `45.0` keeps its zero, and neither is normalised into the
 * other, so every keypress visibly moves the display. Rendering the parsed number instead meant
 * "45", "45," and "45,0" all drew as 45, and the decimal key looked dead.
 *
 * Grouping and the separator still come from `Intl`, so the digits read the way the locale writes
 * them. An empty string comes back empty — the caller decides whether that shows as "0".
 */
export function formatTypedNumber(text: string, locale: Locale): string {
  if (text === "") return "";

  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const point = body.indexOf(".");
  const integerText = point === -1 ? body : body.slice(0, point);
  const fraction = point === -1 ? null : body.slice(point + 1);

  // Only the integer part goes through Intl: the fraction is shown exactly as typed, and asking
  // for fraction digits would round it or pad it back to a length nobody keyed.
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Number(integerText || "0"),
  );

  const formatted = fraction === null ? integer : integer + decimalSeparator(locale) + fraction;
  return negative ? `−${formatted}` : formatted;
}

/**
 * The currency symbol and where the locale puts it: `$` before in `en`, `₴` after in `uk`.
 *
 * Read from `Intl` rather than from a table, so it agrees with `formatMoney` down to the space
 * between symbol and digits. It exists for the one case that cannot go through `formatMoney` at
 * all — a part-typed amount, which is text and not a number.
 */
export interface CurrencyAffix {
  symbol: string;
  /** True when the symbol leads the digits. */
  prefix: boolean;
  /** Whatever the locale puts between symbol and digits: a space, a no-break space, or nothing. */
  spacing: string;
}

export function currencyAffix(currency: Currency, locale: Locale): CurrencyAffix {
  const parts = currencyFormatter(locale, currency, false).formatToParts(1);
  const index = parts.findIndex((part) => part.type === "currency");
  if (index === -1) return { symbol: currency, prefix: false, spacing: " " };

  const prefix = index === 0;
  const neighbour = parts[prefix ? index + 1 : index - 1];
  return {
    symbol: parts[index]!.value,
    prefix,
    spacing: neighbour?.type === "literal" ? neighbour.value : "",
  };
}

/** Puts the currency symbol on an already-formatted figure, keeping any minus sign outermost. */
export function withCurrency(formatted: string, currency: Currency, locale: Locale): string {
  const { symbol, prefix, spacing } = currencyAffix(currency, locale);
  const negative = formatted.startsWith("−");
  const body = negative ? formatted.slice(1) : formatted;
  const withSymbol = prefix ? `${symbol}${spacing}${body}` : `${body}${spacing}${symbol}`;
  return negative ? `−${withSymbol}` : withSymbol;
}

/** Bare number, no currency symbol — for table cells where the column header carries it. */
export function formatAmount(
  amountMinor: Minor,
  currency: Currency,
  locale: Locale,
  cents = false,
): string {
  const magnitude = Math.abs(minorToMajor(amountMinor, currency));
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(magnitude);
  return amountMinor < 0 ? `−${body}` : body;
}

/* ------------------------------------------------------------------------------- dates */

/** Today as 'YYYY-MM-DD' in the *device's* timezone, not UTC. A purchase happens on a local
 *  calendar day, and using UTC would file late-evening spending under tomorrow. */
export function todayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Day of the month, 1-31, from an ISO date — without constructing a Date. */
export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function daysBetween(fromIso: string, toIso: string): number {
  const asUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((asUtc(toIso) - asUtc(fromIso)) / 86_400_000);
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

function isoToUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatDate(iso: string, locale: Locale): string {
  return dateFormatter(locale, { day: "numeric", month: "long", year: "numeric" }).format(
    isoToUtcDate(iso),
  );
}

export function formatDateShort(iso: string, locale: Locale): string {
  return dateFormatter(locale, { day: "numeric", month: "short" }).format(isoToUtcDate(iso));
}

export function formatMonth(month: string, locale: Locale): string {
  return dateFormatter(locale, { month: "long", year: "numeric" }).format(
    isoToUtcDate(`${month}-01`),
  );
}

export function formatMonthShort(month: string, locale: Locale): string {
  return dateFormatter(locale, { month: "short" }).format(isoToUtcDate(`${month}-01`));
}

/**
 * "Today" / "Yesterday" / a formatted date. Day headings are the main use, where relative
 * labels genuinely help — a date that is neither today nor yesterday gets its real name.
 */
export function formatDayHeading(iso: string, locale: Locale, today = todayIso()): string {
  const t = (key: MessageKey) => translate(locale, key);
  if (iso === today) return t("date.today");
  if (iso === addDaysIso(today, -1)) return t("date.yesterday");
  return formatDate(iso, locale);
}

/** Coarse "how long ago" for the sync pill and the duplicate nudge. */
export function formatRelativeTime(timestamp: number, locale: Locale, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return translate(locale, "date.justNow");

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return translate(locale, "date.minutesAgo", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(locale, "date.hoursAgo", { count: hours });

  return translate(locale, "date.daysAgo", { count: Math.floor(hours / 24) });
}

/** Byte size for the storage line in Settings. */
export function formatBytes(bytes: number, locale: Locale): string {
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 });
  return `${formatted.format(value)} ${units[unit]}`;
}
