import { describe, expect, it } from "vitest";
import {
  MoneyError,
  accountDelta,
  convertMinor,
  minorToMajor,
  parseMajorToMinor,
  signedMinor,
  sumMinor,
} from "@shared/money";

describe("signedMinor", () => {
  it("makes expenses negative and income positive", () => {
    expect(signedMinor("expense", 124000)).toBe(-124000);
    expect(signedMinor("income", 124000)).toBe(124000);
  });

  it("returns zero for transfers", () => {
    // A transfer moves money between the household's own accounts, so counting it as either
    // income or expense would double-count it. This is the classic budget-report bug.
    expect(signedMinor("transfer", 124000)).toBe(0);
  });

  it("refuses a negative magnitude", () => {
    expect(() => signedMinor("expense", -1)).toThrow(MoneyError);
  });
});

describe("accountDelta", () => {
  it("debits the source and credits nothing else for an expense", () => {
    const tx = { kind: "expense" as const, accountId: "a", amountMinor: 500 };
    expect(accountDelta(tx, "a")).toBe(-500);
    expect(accountDelta(tx, "b")).toBe(0);
  });

  it("credits the account for income", () => {
    expect(accountDelta({ kind: "income", accountId: "a", amountMinor: 500 }, "a")).toBe(500);
  });

  it("moves the same amount for a same-currency transfer", () => {
    const tx = {
      kind: "transfer" as const,
      accountId: "a",
      toAccountId: "b",
      amountMinor: 500,
    };
    expect(accountDelta(tx, "a")).toBe(-500);
    expect(accountDelta(tx, "b")).toBe(500);
    // Nets to zero across the household.
    expect(accountDelta(tx, "a") + accountDelta(tx, "b")).toBe(0);
  });

  it("uses both explicit legs for a cross-currency transfer, with no rounding drift", () => {
    // ₴50 000,00 out of a UAH card, €1 020,45 into a EUR account. Neither balance depends on
    // an FX rate, which is precisely why both legs are stored.
    const tx = {
      kind: "transfer" as const,
      accountId: "uah_card",
      toAccountId: "eur_cash",
      amountMinor: 5_000_000,
      toAmountMinor: 102_045,
    };
    expect(accountDelta(tx, "uah_card")).toBe(-5_000_000);
    expect(accountDelta(tx, "eur_cash")).toBe(102_045);
  });
});

describe("parseMajorToMinor", () => {
  it("handles the UA convention of a space group separator and a comma decimal", () => {
    expect(parseMajorToMinor("1 240,50", "UAH")).toBe(124050);
    expect(parseMajorToMinor("1 240,50", "UAH")).toBe(124050); // no-break space
    expect(parseMajorToMinor("1 240,50", "UAH")).toBe(124050); // narrow no-break space
  });

  it("handles the plain English form", () => {
    expect(parseMajorToMinor("1240.5", "UAH")).toBe(124050);
  });

  it("does not drift on values that are not exact in binary floating point", () => {
    // 1.15 * 100 is 114.99999999999999 in IEEE 754. Truncating would give 114.
    expect(parseMajorToMinor("1.15", "EUR")).toBe(115);
    expect(parseMajorToMinor("8.29", "USD")).toBe(829);
    expect(parseMajorToMinor("1.005", "UAH")).toBe(101);
  });

  it("rejects junk rather than silently producing a number", () => {
    expect(() => parseMajorToMinor("", "UAH")).toThrow(MoneyError);
    expect(() => parseMajorToMinor("12abc", "UAH")).toThrow(MoneyError);
    expect(() => parseMajorToMinor("1.2.3", "UAH")).toThrow(MoneyError);
  });
});

describe("convertMinor", () => {
  it("is the identity when currencies match, without touching the rate", () => {
    expect(convertMinor(124000, 48.5, "UAH", "UAH")).toBe(124000);
  });

  it("converts EUR to UAH at the given rate", () => {
    // €100.00 at 48.50 UAH/EUR = ₴4 850,00
    expect(convertMinor(10_000, 48.5, "EUR", "UAH")).toBe(485_000);
  });

  it("rounds half away from zero, so negative amounts are not biased", () => {
    // Exactly the .5 boundary. Math.round(-0.5) is -0 in JS, which rounds negatives towards
    // zero and would slowly understate expenses across thousands of rows.
    expect(convertMinor(1, 0.5, "EUR", "UAH")).toBe(1);
    expect(convertMinor(-1, 0.5, "EUR", "UAH")).toBe(-1);
  });

  it("rounds below the boundary down, in both directions", () => {
    expect(convertMinor(1, 0.4, "EUR", "UAH")).toBe(0);
    expect(convertMinor(-1, 0.4, "EUR", "UAH")).toBe(-0);
  });

  it("rejects a non-positive or non-finite rate", () => {
    expect(() => convertMinor(100, 0, "EUR", "UAH")).toThrow(MoneyError);
    expect(() => convertMinor(100, -1, "EUR", "UAH")).toThrow(MoneyError);
    expect(() => convertMinor(100, Number.NaN, "EUR", "UAH")).toThrow(MoneyError);
  });
});

describe("sumMinor", () => {
  it("adds integer amounts exactly", () => {
    expect(sumMinor([51_281_900, 26_820_000, 22_932_400])).toBe(101_034_300);
  });

  it("refuses to sum a float, rather than quietly producing a fractional total", () => {
    expect(() => sumMinor([100, 0.5])).toThrow(MoneyError);
  });
});

describe("minorToMajor", () => {
  it("scales back for display", () => {
    expect(minorToMajor(124050, "UAH")).toBe(1240.5);
  });
});
