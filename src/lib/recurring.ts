import type { Currency } from "@shared/currency";
import type { Recurring } from "@shared/schema";
import { addDaysIso } from "./format";

/**
 * Scheduling for recurring transactions — rent, utilities, subscriptions.
 *
 * Deliberately a *review* queue rather than an auto-poster. Utilities vary month to month, and a
 * background job that silently invents a ₴25 000 transaction is a worse failure than being
 * prompted for one. Nothing is written until it is confirmed.
 */

export type Cadence = Recurring["cadence"];

/** Days in a given year and 1-indexed month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The next date after `from`.
 *
 * Monthly is the interesting case: a rent day of the 31st has to land on the 28th, 29th or 30th
 * in the months that have no 31st, and must then return to the 31st afterwards rather than
 * drifting earlier every month. That is why `dayOf` is carried separately instead of being read
 * back off the previous occurrence.
 */
export function nextOccurrence(from: string, cadence: Cadence, dayOf: number): string {
  if (cadence === "weekly") return addDaysIso(from, 7);

  const [year, month] = from.split("-").map(Number) as [number, number, number];

  if (cadence === "yearly") {
    const nextYear = year + 1;
    // 29 February in a non-leap year becomes the 28th, without shifting the anniversary.
    const day = Math.min(dayOf, daysInMonth(nextYear, month));
    return `${nextYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const totalMonths = year * 12 + (month - 1) + 1;
  const nextYearValue = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  const day = Math.min(dayOf, daysInMonth(nextYearValue, nextMonth));

  return `${nextYearValue}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Advances a schedule past today, so a template left untouched for months does not queue up one
 * prompt per missed period.
 *
 * Bounded, because an inactive schedule from years back would otherwise loop hundreds of times.
 * Returns the first due date and how many periods were skipped, so the UI can say so.
 */
export function catchUp(
  nextOn: string,
  cadence: Cadence,
  dayOf: number,
  today: string,
  maxSteps = 240,
): { next: string; skipped: number } {
  let cursor = nextOn;
  let skipped = 0;
  while (cursor <= today && skipped < maxSteps) {
    cursor = nextOccurrence(cursor, cadence, dayOf);
    skipped++;
  }
  return { next: cursor, skipped };
}

/** Active schedules whose date has arrived. */
export function dueRecurring(items: Recurring[], today: string): Recurring[] {
  return items
    .filter((item) => item.deleted === 0 && item.active === 1 && item.next_on <= today)
    .sort((a, b) => a.next_on.localeCompare(b.next_on));
}

/**
 * One schedule's cost expressed per month.
 *
 * Necessary because the list mixes cadences: a weekly ₴500 and a yearly ₴500 are wildly
 * different commitments, so a total of the raw amounts would be a meaningless number. Every
 * schedule is put on a monthly footing before anything is added up.
 *
 * Weekly uses 52/12, not 4 — "four weeks to a month" understates a weekly commitment by about
 * 8%, which on a household's fixed costs is real money.
 */
export function monthlyEquivalent(amountMinor: number, cadence: Cadence): number {
  if (cadence === "weekly") return Math.round((amountMinor * 52) / 12);
  if (cadence === "yearly") return Math.round(amountMinor / 12);
  return amountMinor;
}

export interface MonthlyEntry {
  amount_minor: number;
  currency: Currency;
  cadence: Cadence;
}

export interface MonthlyTotal {
  /** Monthly subtotal per currency, base currency first. */
  byCurrency: [Currency, number][];
  /** Every subtotal converted to the base currency and added. */
  grand: number;
  /**
   * False when any currency had no rate available. A grand total missing one currency understates
   * the household's commitments, which is exactly the direction a budgeting figure must not err
   * in — so the caller shows the per-currency breakdown alone instead.
   */
  grandUsable: boolean;
}

/**
 * Monthly-equivalent totals for a set of schedules.
 *
 * `convert` is injected rather than reading rates directly, so this stays pure and the awkward
 * cases (a missing rate) are testable without a database.
 */
export function monthlyTotal(
  entries: MonthlyEntry[],
  convert: (minor: number, currency: Currency) => number | null,
  base: Currency,
): MonthlyTotal {
  const byCurrency = new Map<Currency, number>();
  for (const entry of entries) {
    const monthly = monthlyEquivalent(entry.amount_minor, entry.cadence);
    byCurrency.set(entry.currency, (byCurrency.get(entry.currency) ?? 0) + monthly);
  }

  let grand = 0;
  let complete = true;
  for (const [currency, minor] of byCurrency) {
    const converted = convert(minor, currency);
    if (converted === null) complete = false;
    else grand += converted;
  }

  return {
    byCurrency: [...byCurrency.entries()].sort((a, b) =>
      a[0] === base ? -1 : b[0] === base ? 1 : a[0].localeCompare(b[0]),
    ),
    grand,
    grandUsable: complete && byCurrency.size > 0,
  };
}
