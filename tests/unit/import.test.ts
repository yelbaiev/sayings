import { readFileSync } from "node:fs";
import { parseCsv, parseCsvTable } from "@shared/import/csv";
import { canonicalCategoryName, parseSaldoSummary } from "@shared/import/saldo-summary";
import {
  guessMapping,
  hashRow,
  isImportable,
  parseFile,
  parseImportAmount,
  parseImportDate,
  parseImportKind,
} from "@shared/import/transactions";
import { describe, expect, it } from "vitest";

describe("parseCsv", () => {
  it("handles quoted fields containing commas", () => {
    // A naive split(",") corrupts every note and payee with a comma in it.
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('a,"say ""hi""",c')).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("handles newlines inside a quoted field", () => {
    expect(parseCsv('a,"line1\nline2",c')).toEqual([["a", "line1\nline2", "c"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a UTF-8 BOM, which would otherwise corrupt the first header", () => {
    const table = parseCsvTable("﻿Date,Amount\n2026-08-05,100");
    expect(table.headers).toEqual(["Date", "Amount"]);
  });

  it("does not emit a phantom row for a trailing newline", () => {
    expect(parseCsv("a,b\nc,d\n")).toHaveLength(2);
  });

  it("disambiguates duplicate headers instead of losing a column", () => {
    const table = parseCsvTable("Amount,Amount\n1,2");
    expect(table.headers).toEqual(["Amount", "Amount_2"]);
    expect(table.rows[0]).toEqual({ Amount: "1", Amount_2: "2" });
  });
});

describe("parseImportDate", () => {
  it("reads ISO dates, with or without a time", () => {
    expect(parseImportDate("2026-08-05")).toBe("2026-08-05");
    expect(parseImportDate("2026-08-05 14:30:00")).toBe("2026-08-05");
  });

  it("reads day-first dates, which is the Ukrainian convention", () => {
    // Deliberate: this data comes from a Ukrainian app. The preview shows the parsed date
    // back, because a silently transposed day and month would misfile a third of the year.
    expect(parseImportDate("05.08.2026")).toBe("2026-08-05");
    expect(parseImportDate("5/8/2026")).toBe("2026-08-05");
    expect(parseImportDate("05-08-26")).toBe("2026-08-05");
  });

  it("rejects a date that does not exist rather than rolling it over", () => {
    // Date would happily turn 31 February into 3 March.
    expect(parseImportDate("31.02.2026")).toBeNull();
    expect(parseImportDate("2026-02-31")).toBeNull();
  });

  it("rejects junk", () => {
    expect(parseImportDate("")).toBeNull();
    expect(parseImportDate("last Tuesday")).toBeNull();
    expect(parseImportDate("13/13/2026")).toBeNull();
  });
});

describe("parseImportAmount", () => {
  it("reads a plain amount", () => {
    expect(parseImportAmount("1240.50", "UAH")).toEqual({ minor: 124_050, negative: false });
  });

  it("strips currency symbols", () => {
    expect(parseImportAmount("₴1 240,50", "UAH")?.minor).toBe(124_050);
    expect(parseImportAmount("€100.00", "EUR")?.minor).toBe(10_000);
    expect(parseImportAmount("100.00 USD", "USD")?.minor).toBe(10_000);
  });

  it("disambiguates 1,234.56 from 1.234,56 by which separator comes last", () => {
    expect(parseImportAmount("1,234.56", "UAH")?.minor).toBe(123_456);
    expect(parseImportAmount("1.234,56", "UAH")?.minor).toBe(123_456);
  });

  it("treats a lone comma before three digits as a thousands separator", () => {
    expect(parseImportAmount("1,234", "UAH")?.minor).toBe(123_400);
    expect(parseImportAmount("12,34", "UAH")?.minor).toBe(1234);
  });

  it("returns a magnitude plus a sign flag, never a negative amount", () => {
    // Letting a stray minus into a stored amount is how a ledger gets negative expenses.
    expect(parseImportAmount("-500", "UAH")).toEqual({ minor: 50_000, negative: true });
    expect(parseImportAmount("(500)", "UAH")).toEqual({ minor: 50_000, negative: true });
  });

  it("returns null for junk", () => {
    expect(parseImportAmount("", "UAH")).toBeNull();
    expect(parseImportAmount("n/a", "UAH")).toBeNull();
  });
});

describe("parseImportKind", () => {
  const positive = { minor: 100, negative: false };
  const negative = { minor: 100, negative: true };

  it("reads an explicit type column, in any of the three languages", () => {
    expect(parseImportKind("Expense", positive, false)).toBe("expense");
    expect(parseImportKind("Витрата", positive, false)).toBe("expense");
    expect(parseImportKind("Доход", negative, false)).toBe("income");
    expect(parseImportKind("Переказ", positive, false)).toBe("transfer");
  });

  it("treats a destination account as proof of a transfer", () => {
    expect(parseImportKind("", positive, true)).toBe("transfer");
  });

  it("falls back to the sign when there is no type column", () => {
    expect(parseImportKind(undefined, negative, false)).toBe("expense");
    expect(parseImportKind(undefined, positive, false)).toBe("income");
  });
});

describe("guessMapping", () => {
  it("recognises common English headers", () => {
    const mapping = guessMapping(["Date", "Amount", "Currency", "Account", "Category", "Note"]);
    expect(mapping).toEqual({
      Date: "date",
      Amount: "amount",
      Currency: "currency",
      Account: "account",
      Category: "category",
      Note: "note",
    });
  });

  it("recognises Ukrainian headers", () => {
    const mapping = guessMapping(["Дата", "Сума", "Валюта", "Рахунок", "Категорія"]);
    expect(mapping["Дата"]).toBe("date");
    expect(mapping["Сума"]).toBe("amount");
    expect(mapping["Рахунок"]).toBe("account");
    expect(mapping["Категорія"]).toBe("category");
  });

  it("maps a destination column before a plain account column", () => {
    const mapping = guessMapping(["To Account", "Account"]);
    expect(mapping["To Account"]).toBe("toAccount");
    expect(mapping["Account"]).toBe("account");
  });

  it("ignores columns it does not recognise", () => {
    expect(guessMapping(["Internal Ref"])).toEqual({ "Internal Ref": "ignore" });
  });
});

describe("parseFile", () => {
  const csv = [
    "Date,Amount,Currency,Account,Category,Note",
    "05.08.2026,-1240.50,UAH,Mono,Groceries,Weekly shop",
    "04.08.2026,74000,UAH,Mono,Salary,",
    "03.08.2026,-100,EUR,EUR cash,Travel,\"Taxi, airport\"",
    "not a date,-50,UAH,Mono,Groceries,",
    "02.08.2026,,UAH,Mono,Groceries,",
    "01.08.2026,-500,UAH,Mono,,No category here",
  ].join("\n");

  const result = parseFile(csv, { defaultCurrency: "UAH" });

  it("parses the importable rows and flags the rest", () => {
    expect(result.counts.total).toBe(6);
    // Two rows are unusable (bad date, missing amount); the missing-category row still imports.
    expect(result.counts.ready).toBe(4);
    expect(result.counts.skipped).toBe(2);
  });

  it("derives direction from the sign when there is no type column", () => {
    expect(result.rows[0]!.kind).toBe("expense");
    expect(result.rows[1]!.kind).toBe("income");
  });

  it("stores magnitudes, never negative amounts", () => {
    expect(result.rows[0]!.amountMinor).toBe(124_050);
  });

  it("respects a per-row currency over the default", () => {
    expect(result.rows[2]!.currency).toBe("EUR");
    expect(result.rows[2]!.amountMinor).toBe(10_000);
  });

  it("keeps a quoted comma inside the note intact", () => {
    expect(result.rows[2]!.note).toBe("Taxi, airport");
  });

  it("flags the rows it cannot use, pointing at the source line", () => {
    expect(result.rows[3]!.warnings).toContain("noDate");
    expect(result.rows[3]!.line).toBe(5);
    expect(result.rows[4]!.warnings).toContain("noAmount");
  });

  it("imports a row with no category rather than dropping it", () => {
    // It lands in Uncategorised, matching the existing convention in the Saldo data, and can
    // be cleaned up with bulk recategorise. Dropping it would lose real money.
    const row = result.rows[5]!;
    expect(row.warnings).toContain("noCategory");
    expect(isImportable(row)).toBe(true);
  });

  it("collects the distinct account and category names for the mapping step", () => {
    expect(result.accountNames).toEqual(["EUR cash", "Mono"]);
    expect(result.categoryNames).toEqual(["Groceries", "Salary", "Travel"]);
  });
});

describe("idempotency", () => {
  const csv = ["Date,Amount,Account,Category", "05.08.2026,-1240.50,Mono,Groceries"].join("\n");

  it("produces a stable hash for identical content", () => {
    const first = parseFile(csv, { defaultCurrency: "UAH" });
    const second = parseFile(csv, { defaultCurrency: "UAH" });
    expect(first.rows[0]!.hash).toBe(second.rows[0]!.hash);
  });

  it("skips rows already imported, so re-running never duplicates", () => {
    const first = parseFile(csv, { defaultCurrency: "UAH" });
    const again = parseFile(csv, {
      defaultCurrency: "UAH",
      existingHashes: new Set([first.rows[0]!.hash]),
    });
    expect(again.counts.duplicates).toBe(1);
    expect(again.counts.ready).toBe(0);
    expect(isImportable(again.rows[0]!)).toBe(false);
  });

  it("gives different content different hashes", () => {
    expect(hashRow(["2026-08-05", 100])).not.toBe(hashRow(["2026-08-05", 101]));
    expect(hashRow(["a", "b"])).not.toBe(hashRow(["b", "a"]));
  });
});

/**
 * The reconciliation harness, against a sample export.
 *
 * The fixture is synthetic — round, obviously invented figures — but it reproduces every awkward
 * property of a real Saldo export: empty leading years, an "Uncategorised expense" block,
 * "Balance correction" appearing in both sections, a loss-making year, two malformed category
 * names, and category rows that do not quite sum to the stated totals.
 *
 * That last property is the reason this file is generated rather than copied. Saldo rounds each
 * cell while totalling unrounded values, so its export is not internally consistent; here the
 * shortfall is *chosen*, which turns it from an artefact of somebody's budget into a fixed
 * quantity a parser change cannot move without failing a test.
 */
describe("the Saldo summary export format", () => {
  const csv = readFileSync(
    new URL("../fixtures/saldo-summary-sample.csv", import.meta.url),
    "utf8",
  );
  const summary = parseSaldoSummary(csv);

  it("reads all six years", () => {
    expect(summary.years).toEqual(["2021", "2022", "2023", "2024", "2025", "2026"]);
  });

  it("reads the 24 expense and 6 income categories the seed migration mirrors", () => {
    expect(summary.expenses).toHaveLength(24);
    expect(summary.income).toHaveLength(6);
  });

  it("reads the headline totals exactly", () => {
    expect(summary.totalExpenses.get("2025")).toBe(33_100_600);
    expect(summary.totalExpenses.get("2026")).toBe(15_530_900);
    expect(summary.totalIncome.get("2025")).toBe(40_000_000);
    expect(summary.totalIncome.get("2026")).toBe(20_000_000);
  });

  it("reads a negative profit without turning it positive", () => {
    // 2024 ran at a loss. Losing that sign would flatter the year.
    expect(summary.profit.get("2024")).toBe(-4_472_500);
    expect(summary.profit.get("2025")).toBe(6_899_400);
  });

  it("reads individual category totals", () => {
    const groceries = summary.expenses.find((row) => row.name === "Groceries")!;
    expect(groceries.byYear.get("2025")).toBe(12_000_000);
    expect(groceries.byYear.get("2026")).toBe(6_000_000);
  });

  it("category rows nearly add up to the stated totals — Saldo rounds each cell", () => {
    // The category rows do NOT sum exactly to the stated totals: 2024 is short by ₴5, 2025 by
    // ₴6, 2026 by ₴9. That models per-cell rounding in Saldo's own export, where each category
    // is rounded to whole hryvnia while the total comes from unrounded values.
    //
    // The consequence matters for the import: such a file cannot be a to-the-hryvnia
    // reconciliation target, because it is not internally consistent. The achievable criterion
    // is agreement within about ₴1 per category, and that is what is asserted here.
    for (const year of summary.years) {
      const nonZero = summary.expenses.filter((row) => (row.byYear.get(year) ?? 0) !== 0).length;
      const tolerance = Math.max(1, nonZero) * 100; // ₴1 per category, in minor units

      const summed = summary.expenses.reduce((total, row) => total + (row.byYear.get(year) ?? 0), 0);
      const stated = summary.totalExpenses.get(year) ?? 0;
      expect(Math.abs(summed - stated), `expenses ${year}`).toBeLessThanOrEqual(tolerance);

      const incomeSummed = summary.income.reduce(
        (total, row) => total + (row.byYear.get(year) ?? 0),
        0,
      );
      const incomeStated = summary.totalIncome.get(year) ?? 0;
      expect(Math.abs(incomeSummed - incomeStated), `income ${year}`).toBeLessThanOrEqual(tolerance);
    }
  });

  it("pins the exact rounding shortfall, so a parser change cannot hide behind it", () => {
    // Recorded precisely rather than waved away as "rounding": if these numbers move, either
    // the parser changed or the fixture did, and both are worth knowing about.
    const shortfall = (year: string) =>
      summary.expenses.reduce((total, row) => total + (row.byYear.get(year) ?? 0), 0) -
      (summary.totalExpenses.get(year) ?? 0);

    expect(shortfall("2023")).toBe(0);
    expect(shortfall("2024")).toBe(-500);
    expect(shortfall("2025")).toBe(-600);
    expect(shortfall("2026")).toBe(-900);
  });

  it("profit matches income minus expenses to within the same rounding", () => {
    for (const year of summary.years) {
      const expected = (summary.totalIncome.get(year) ?? 0) - (summary.totalExpenses.get(year) ?? 0);
      // The stated profit is off by at most ₴1 from the stated totals, for the same reason.
      expect(Math.abs((summary.profit.get(year) ?? 0) - expected), `profit ${year}`)
        .toBeLessThanOrEqual(100);
    }
  });

  it("surfaces the Saldo artifacts rather than quietly reclassifying them", () => {
    // A large "Uncategorised expense" block and "Balance correction" as a major income line are
    // real features of Saldo exports. They must show up as-is and be cleaned up deliberately,
    // not disappear inside an import. Note "Balance correction" appears in both sections, so
    // the parser has to keep them apart by section rather than by name.
    const uncategorised = summary.expenses.find((row) => row.name === "Uncategorised expense")!;
    expect(uncategorised.byYear.get("2025")).toBe(2_500_000);

    const correction = summary.income.find((row) => row.name === "Balance correction")!;
    expect(correction.byYear.get("2026")).toBe(3_000_000);
    expect(summary.expenses.find((row) => row.name === "Balance correction")).toBeDefined();
  });

  it("normalises the two malformed category names in the source", () => {
    // The fixture has 'Document ' with a trailing space and 'work' in lowercase, as the real
    // reader trims names, so the trailing space is already gone by the time rows come out —
    // but the alias table still records both, because the *transaction* importer sees raw
    // values and a rename should be explicit rather than an accident of trimming.
    expect(summary.expenses.some((row) => row.name === "Document")).toBe(true);
    expect(summary.expenses.some((row) => row.name === "work")).toBe(true);

    expect(canonicalCategoryName("Document ")).toBe("Document");
    expect(canonicalCategoryName("work")).toBe("Work");
    expect(canonicalCategoryName("Groceries")).toBe("Groceries");
  });
});
