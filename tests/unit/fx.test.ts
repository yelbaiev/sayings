import { describe, expect, it } from "vitest";
import { lookupRate, type RateRow } from "~/lib/fx";

/**
 * Rows must be sorted ascending, which is how the caller stores them.
 * Real rates, from the live NBU endpoint on 2026-08-04.
 */
const ROWS: RateRow[] = [
  { on_date: "2026-07-31", quote: "USD", rate: 44.6112 },
  { on_date: "2026-07-31", quote: "EUR", rate: 51.4008 },
  { on_date: "2026-08-01", quote: "USD", rate: 44.6916 },
  { on_date: "2026-08-01", quote: "EUR", rate: 51.5231 },
  { on_date: "2026-08-04", quote: "USD", rate: 44.7876 },
  { on_date: "2026-08-04", quote: "EUR", rate: 51.6423 },
];

describe("lookupRate", () => {
  it("returns 1 for the base currency without consulting the table", () => {
    expect(lookupRate([], "UAH", "2026-08-05", "UAH")).toEqual({ rate: 1, estimated: false });
  });

  it("finds an exact date", () => {
    expect(lookupRate(ROWS, "USD", "2026-08-04", "UAH")).toEqual({ rate: 44.7876, estimated: false });
    expect(lookupRate(ROWS, "EUR", "2026-08-01", "UAH")).toEqual({ rate: 51.5231, estimated: false });
  });

  it("uses the nearest prior rate when a date is missing", () => {
    // 2026-08-02 and 08-03 are a weekend. NBU does publish carried-forward weekend rates, so
    // this path is a safety net for gaps in the mirror rather than the usual case — but when
    // it is hit, the applicable rate genuinely is the last published one.
    expect(lookupRate(ROWS, "USD", "2026-08-03", "UAH")).toEqual({ rate: 44.6916, estimated: false });
  });

  it("never looks forward in time", () => {
    // A future rate must not be applied retroactively, or a historical report would change
    // as new rates arrive.
    expect(lookupRate(ROWS, "USD", "2026-08-05", "UAH").rate).toBe(44.7876);
    expect(lookupRate(ROWS, "USD", "2026-07-31", "UAH").rate).toBe(44.6112);
  });

  it("flags a fallback when the date precedes every known rate", () => {
    // Saved offline with nothing to go on. The entry is kept and marked, because losing the
    // transaction would be far worse than an approximate base figure — the nightly reconcile
    // corrects it.
    const result = lookupRate(ROWS, "USD", "2020-01-01", "UAH");
    expect(result.estimated).toBe(true);
    expect(result.rate).toBe(44.6112);
  });

  it("flags a fallback of 1 when the currency is entirely unknown", () => {
    const result = lookupRate([], "USD", "2026-08-05", "UAH");
    expect(result).toEqual({ rate: 1, estimated: true });
  });

  it("does not mix currencies", () => {
    const eurOnly: RateRow[] = [{ on_date: "2026-08-04", quote: "EUR", rate: 51.6423 }];
    expect(lookupRate(eurOnly, "USD", "2026-08-04", "UAH").estimated).toBe(true);
    expect(lookupRate(eurOnly, "EUR", "2026-08-04", "UAH").estimated).toBe(false);
  });
});
