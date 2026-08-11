import { describe, expect, it } from "vitest";
import { crossRate, sourceFor } from "../../worker/fx/resolve";

/**
 * Cross-rate arithmetic, against numbers checkable by hand.
 *
 * This is the highest-consequence arithmetic in the app and the least likely to announce a mistake.
 * An inverted cross-rate does not throw and does not look odd: it produces a plausible number about
 * 1/1600th of the right one, writes it into `base_amount_minor`, and the transaction sits there
 * looking like a small purchase. So the figures below are real published rates, and the expected
 * answers were worked out on paper first.
 */

// NBU, 2026-08-04, hryvnia per unit.
const UAH_PER_USD = 44.7876;
const UAH_PER_EUR = 51.6423;

describe("crossRate", () => {
  it("cancels the pivot", () => {
    /*
     * Hryvnia-per-dollar over hryvnia-per-euro leaves euro per dollar. 44.7876 / 51.6423 ≈ 0.867,
     * which is the right order of magnitude for a dollar in euro — and the inverted form would be
     * ≈1.153, which is also plausible. That is exactly why this is tested rather than eyeballed.
     */
    const rate = crossRate(UAH_PER_USD, UAH_PER_EUR);
    expect(rate).toBeCloseTo(0.86727, 4);
  });

  it("degenerates to the direct quote when the base is the pivot", () => {
    // pivotPerBase of 1 is what makes one formula serve both the direct and the crossed case.
    expect(crossRate(UAH_PER_USD, 1)).toBe(UAH_PER_USD);
  });

  it("is the reciprocal in the other direction", () => {
    const there = crossRate(UAH_PER_USD, UAH_PER_EUR)!;
    const back = crossRate(UAH_PER_EUR, UAH_PER_USD)!;
    expect(there * back).toBeCloseTo(1, 10);
  });

  it("refuses rather than guesses when either side is missing", () => {
    /*
     * Returning null is the point. A household is better served by a transaction marked estimated and
     * corrected overnight than by a number invented from one half of a pair.
     */
    expect(crossRate(undefined, UAH_PER_EUR)).toBeNull();
    expect(crossRate(UAH_PER_USD, undefined)).toBeNull();
    expect(crossRate(0, UAH_PER_EUR)).toBeNull();
    expect(crossRate(UAH_PER_USD, 0)).toBeNull();
    expect(crossRate(-1, UAH_PER_EUR)).toBeNull();
    expect(crossRate(UAH_PER_USD, Number.NaN)).toBeNull();
    expect(crossRate(Number.POSITIVE_INFINITY, UAH_PER_EUR)).toBeNull();
  });
});

describe("sourceFor", () => {
  it("prefers the source whose pivot is already the base", () => {
    // Half the rounding and half the chances of a missing quote: one published number instead of two.
    expect(sourceFor("USD", "UAH")).toBe("nbu");
    expect(sourceFor("USD", "EUR")).toBe("ecb");
  });

  it("uses NBU for a pair the ECB does not publish", () => {
    /*
     * The hryvnia is the reason there are two sources. A euro household holding hryvnia has to be
     * priced through NBU, because the ECB quotes no hryvnia rate at all — so the source follows the
     * pair, not the household.
     */
    expect(sourceFor("UAH", "EUR")).toBe("nbu");
    expect(sourceFor("UAH", "USD")).toBe("nbu");
  });

  it("picks NBU-only currencies through the hryvnia even for a euro base", () => {
    // Cross-rated: hryvnia-per-tenge over hryvnia-per-euro.
    expect(sourceFor("KZT", "EUR")).toBe("nbu");
    expect(sourceFor("GEL", "GBP")).toBe("nbu");
  });

  it("finds a source for any pair the app offers", () => {
    // The promise the currency list is built on, restated where the fetching can see it.
    expect(sourceFor("JPY", "TND")).not.toBeNull();
    expect(sourceFor("VND", "ISK")).not.toBeNull();
  });
});
