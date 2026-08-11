import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_INFO,
  SOURCE_PIVOT,
  canPriceAutomatically,
  minorUnitDigits,
  minorUnitScale,
  sourcesFor,
  type Currency,
} from "@shared/currency";
import { minorToMajor, parseMajorToMinor } from "@shared/money";
import { formatMoney } from "~/lib/format";

/**
 * The currency table, checked against something other than my own memory of ISO 4217.
 *
 * Widening the list from three currencies to forty-three moved the risk in this app. Nothing here is
 * new logic — `shared/money.ts` already routes every amount through `minorUnitDigits` — but until now
 * that function could answer 2 and be right, because all three supported currencies use two digits.
 * At forty-three it is data, and a single wrong row is a hundredfold error in stored amounts that
 * never throws, looks unremarkable in any one transaction, and surfaces months later as a report
 * that is inexplicably large.
 *
 * So the first test does not check the table against a list I typed out again. It checks it against
 * ICU's own ISO 4217 data, which ships with the platform. That is an independent source, and it is
 * the only test here that could catch a typo in a row nobody thought to write a case for.
 */

/** ICU's own answer for a currency, which is derived from ISO 4217 rather than from this repo. */
function icuDigits(currency: Currency): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * Where this app deliberately keeps more precision than ICU would display, and why.
 *
 * ICU follows CLDR, which records what people actually use rather than what the standard defines.
 * All three of these legally have two digits under ISO 4217 and a minor unit nobody transacts in:
 * the fillér was withdrawn in 1999, and the sen and paisa are long out of practical use.
 *
 * The table keeps two, because the two directions are not equally recoverable. Storing whole units
 * and later needing the fraction means every amount already recorded was rounded, and no migration
 * can bring back a digit that was never stored. Storing the fraction and never using it costs a
 * trailing pair of zeros in a detail view.
 */
const COARSER_IN_PRACTICE: Record<string, string> = {
  HUF: "fillér withdrawn in 1999",
  IDR: "sen not used in practice",
  PKR: "paisa not used in practice",
};

describe("minor units", () => {
  it("agrees with ICU except where the difference is a recorded decision", () => {
    /*
     * The test that makes the other forty-two rows trustworthy, because ICU's table is independent
     * of anything in this repository. A wrong digit count is not a failing assertion somewhere down
     * the line — it is silently multiplied into every amount ever entered in that currency, and
     * unwinding it means knowing which rows were affected.
     */
    const disagreements = CURRENCIES.filter(
      (code) => minorUnitDigits(code) !== icuDigits(code) && !(code in COARSER_IN_PRACTICE),
    ).map((code) => `${code}: table says ${minorUnitDigits(code)}, ICU says ${icuDigits(code)}`);
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  it("keeps the recorded exceptions to two digits, and only those", () => {
    // If CLDR changes its mind, or one of these is quietly dropped to 0 to make a test pass, this
    // says so rather than letting the allowlist above silently cover a real mistake.
    for (const [code, reason] of Object.entries(COARSER_IN_PRACTICE)) {
      expect(minorUnitDigits(code as Currency), `${code} (${reason})`).toBe(2);
      expect(icuDigits(code as Currency), `${code} no longer differs from ICU`).toBe(0);
    }
  });

  it("names the exceptions explicitly, so a regression to 2 is visible", () => {
    // The ICU comparison above would catch these too, but only as a diff in a list of forty-three.
    // Named, a failure says which currency and what it should be.
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(minorUnitDigits("KRW")).toBe(0);
    expect(minorUnitDigits("ISK")).toBe(0);
    expect(minorUnitDigits("VND")).toBe(0);
    expect(minorUnitDigits("TND")).toBe(3);
    expect(minorUnitDigits("UAH")).toBe(2);
  });

  it("scales by the digit count", () => {
    expect(minorUnitScale("UAH")).toBe(100);
    expect(minorUnitScale("JPY")).toBe(1);
    expect(minorUnitScale("TND")).toBe(1000);
  });
});

describe("parsing round-trips for every currency", () => {
  it("returns the same major amount it was given", () => {
    /*
     * Parse, then convert back, for all forty-three. The input is written with each currency's own
     * number of digits, because that is what a user of it would type.
     */
    for (const code of CURRENCIES) {
      const digits = minorUnitDigits(code);
      const major = digits === 0 ? "1240" : `1240.${"5".repeat(digits)}`;
      const minor = parseMajorToMinor(major, code);
      expect(minorToMajor(minor, code), code).toBe(Number(major));
    }
  });

  it("formats back to the digits that were entered", () => {
    // The round trip that would have caught the formatter asking ICU for two digits regardless: a
    // yen amount came back with a decimal point it has no units for, and a dinar lost its third.
    for (const code of CURRENCIES) {
      const digits = minorUnitDigits(code);
      const minor = parseMajorToMinor(digits === 0 ? "1240" : `1240.${"5".repeat(digits)}`, code);
      const shown = formatMoney(minor, code, "en", { cents: true });
      // `en` deliberately, so the decimal separator is a dot and the group separator is a comma —
      // matching either would read the last group of ¥1,240 as a fraction.
      const fraction = /\.(\d+)$/.exec(shown)?.[1] ?? "";
      expect(fraction.length, `${code} rendered as ${shown}`).toBe(digits);
    }
  });

  it("stores ¥500 as 500 units, not 50 000", () => {
    /*
     * Stated as its own case because it is the specific failure this whole file exists for. With the
     * old flat 2, this assertion returned 50000 — a hundred times the amount, in a currency where
     * nothing about the number would look wrong.
     */
    expect(parseMajorToMinor("500", "JPY")).toBe(500);
    expect(parseMajorToMinor("500", "UAH")).toBe(50_000);
    expect(parseMajorToMinor("500", "TND")).toBe(500_000);
  });

  it("rounds a fraction the currency cannot hold", () => {
    // Half away from zero, at whatever precision the currency actually has.
    expect(parseMajorToMinor("500.6", "JPY")).toBe(501);
    expect(parseMajorToMinor("500.4", "JPY")).toBe(500);
    expect(parseMajorToMinor("1.2345", "TND")).toBe(1235);
    expect(parseMajorToMinor("-500.5", "JPY")).toBe(-501);
  });
});

describe("source coverage", () => {
  it("offers nothing it cannot price", () => {
    // The promise the list is built on. A currency no source quotes is one whose totals quietly
    // stop adding up, so it does not belong in the picker at all.
    const unquoted = CURRENCIES.filter((code) => sourcesFor(code).length === 0);
    expect(unquoted).toEqual([]);
  });

  it("can price every pair a household could choose", () => {
    const unpriceable: string[] = [];
    for (const base of CURRENCIES) {
      for (const quote of CURRENCIES) {
        if (!canPriceAutomatically(quote, base)) unpriceable.push(`${quote}→${base}`);
      }
    }
    expect(unpriceable, unpriceable.slice(0, 10).join(", ")).toEqual([]);
  });

  it("keeps UAH out of the ECB set", () => {
    /*
     * Not a detail — it is the reason there are two adapters rather than one. The ECB does not
     * publish a hryvnia rate, so a single euro-based source cannot serve this household, and a
     * single hryvnia-based one cannot serve a household in Portugal.
     */
    expect(sourcesFor("UAH")).toEqual(["nbu"]);
    expect(sourcesFor("EUR")).toContain("ecb");
  });

  it("has each source quoting its own pivot", () => {
    for (const [source, pivot] of Object.entries(SOURCE_PIVOT)) {
      expect(sourcesFor(pivot), `${source} pivot ${pivot}`).toContain(source);
    }
  });

  it("lists every currency once, sorted, matching the table", () => {
    expect(CURRENCIES).toEqual([...CURRENCIES].sort());
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
    expect(CURRENCIES.length).toBe(Object.keys(CURRENCY_INFO).length);
  });
});

describe("nothing compiles a base currency in", () => {
  /*
   * The base is the household's setting, and this is what stops it drifting back to a constant.
   *
   * It went in as one, and grep found it in places no plan predicted: net worth summed the wrong
   * key and returned zero for a euro household, and the TSV export divided by 100 — which would
   * have written a hundredth of every amount into a spreadsheet for a household reporting in yen.
   * Both read as ordinary code. Neither would fail a test written against a hryvnia household,
   * which is every test in this repository.
   */
  const allowed = new Set([
    // The fallback for a value that crossed a network boundary, and its server-side twin.
    "src/app/AppContext.tsx",
  ]);

  function sourceFiles(dir: URL, prefix: string): { path: string; text: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) return sourceFiles(child, `${prefix}${entry.name}/`);
      if (!/\.tsx?$/.test(entry.name)) return [];
      return [{ path: `${prefix}${entry.name}`, text: readFileSync(child, "utf8") }];
    });
  }

  it("names no currency literally outside the two places that may", () => {
    const offenders = sourceFiles(new URL("../../src/", import.meta.url), "src/")
      .filter(({ path }) => !allowed.has(path))
      // A quoted three-letter uppercase code that is in the supported list. Narrow on purpose:
      // matching any uppercase triple would flag `URL`, `GET` and every acronym in the codebase.
      .filter(({ text }) =>
        CURRENCIES.some((code) => new RegExp(`["']${code}["']`).test(text)),
      )
      .map(({ path }) => path);
    expect(offenders, `hardcoded currency in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("divides no amount by a literal 100", () => {
    // The other half of the same mistake. `/ 100` is a minor-unit assumption written as arithmetic,
    // and it is invisible until a household picks a currency with a different scale.
    const offenders = sourceFiles(new URL("../../src/", import.meta.url), "src/")
      // Any identifier that *ends or begins* with a minor-unit word: `amountMinor / 100` and
      // `opening_balance_minor / 100` alike. The second form slipped through the first regex.
      .filter(({ text }) => /\w*(?:minor|amount|total|Minor)\w*\s*\/\s*100\b/.test(text))
      .map(({ path }) => path);
    expect(offenders, `divides minor units by 100 in: ${offenders.join(", ")}`).toEqual([]);
  });
});
