import { parseCsv } from "./csv";
import { parseImportAmount } from "./transactions";

/**
 * Reader for Saldo's *summary* export — a table of yearly category totals, not a transaction
 * list. See `tests/fixtures/saldo-summary-sample.csv` for the shape.
 *
 * This is not an importer: summary totals cannot be turned back into transactions. It exists
 * so the same file can be used as the acceptance test for the real importer — after importing
 * a per-transaction export, sayFinance's own category totals must reproduce this file to the
 * hryvnia. Anything else means the importer got something wrong.
 */

export interface SummaryRow {
  name: string;
  /** Year -> total in minor units. */
  byYear: Map<string, number>;
}

export interface SaldoSummary {
  years: string[];
  expenses: SummaryRow[];
  income: SummaryRow[];
  totalExpenses: Map<string, number>;
  totalIncome: Map<string, number>;
  profit: Map<string, number>;
}

/** Section markers in the export. Everything between them is category rows. */
const TOTAL_EXPENSES = /^total expenses$/i;
const TOTAL_INCOME = /^total income$/i;
const PROFIT = /^profit$/i;

export function parseSaldoSummary(csv: string): SaldoSummary {
  const rows = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) {
    return {
      years: [],
      expenses: [],
      income: [],
      totalExpenses: new Map(),
      totalIncome: new Map(),
      profit: new Map(),
    };
  }

  // The first cell of the header row is empty; the rest are years.
  const years = rows[0]!.slice(1).map((year) => year.trim());

  const readAmounts = (cells: string[]): Map<string, number> => {
    const byYear = new Map<string, number>();
    years.forEach((year, index) => {
      const parsed = parseImportAmount(cells[index + 1] ?? "", "UAH");
      // A negative Profit is meaningful, so the sign is preserved here — unlike a
      // transaction amount, where direction comes from `kind`.
      byYear.set(year, parsed ? (parsed.negative ? -parsed.minor : parsed.minor) : 0);
    });
    return byYear;
  };

  const expenses: SummaryRow[] = [];
  const income: SummaryRow[] = [];
  let totalExpenses = new Map<string, number>();
  let totalIncome = new Map<string, number>();
  let profit = new Map<string, number>();

  // Rows appear under whichever total last introduced them.
  let section: "expense" | "income" | null = null;

  for (const cells of rows.slice(1)) {
    const name = (cells[0] ?? "").trim();
    if (!name) continue;

    if (TOTAL_EXPENSES.test(name)) {
      totalExpenses = readAmounts(cells);
      section = "expense";
      continue;
    }
    if (TOTAL_INCOME.test(name)) {
      totalIncome = readAmounts(cells);
      section = "income";
      continue;
    }
    if (PROFIT.test(name)) {
      profit = readAmounts(cells);
      section = null;
      continue;
    }

    if (section === null) continue;
    (section === "expense" ? expenses : income).push({ name, byYear: readAmounts(cells) });
  }

  return { years, expenses, income, totalExpenses, totalIncome, profit };
}

/**
 * Category name aliases between the Saldo export and the seeded categories.
 *
 * Two known discrepancies in the source file: `Document ` carries a trailing space, and `work`
 * is lowercase. Both are normalised in the seed, so the mapping is recorded here rather than
 * silently trimmed at import time — a rename should be visible, not implicit.
 */
export const SALDO_CATEGORY_ALIASES: Record<string, string> = {
  "Document ": "Document",
  work: "Work",
};

export function canonicalCategoryName(name: string): string {
  return SALDO_CATEGORY_ALIASES[name] ?? name.trim();
}

/**
 * The English names the seed migration created, mapped to their fixed ids.
 *
 * Exists so that renaming categories in the app — say from English to Russian — cannot break a
 * future import of an English-labelled Saldo export. Transactions always reference categories by
 * id, so a rename is safe for existing data; the risk is only that an importer matching CSV text
 * against current names would stop recognising them and create duplicates alongside the renamed
 * originals. Resolution order is: current name, then this table, then create.
 */
export const SEEDED_CATEGORY_IDS: Record<string, string> = {
  "expense:Balance correction": "cat_balance_exp",
  "expense:Books and toys": "cat_books_toys",
  "expense:Charity": "cat_charity",
  "expense:Clothing": "cat_clothing",
  "expense:Digital": "cat_digital",
  "expense:Document": "cat_document",
  "expense:Eating out": "cat_eating_out",
  "expense:Education": "cat_education",
  "expense:Electronics": "cat_electronics",
  "expense:Entertainment": "cat_entertainment",
  "expense:Family care": "cat_family_care",
  "expense:Fees": "cat_fees",
  "expense:Gifts": "cat_gifts_exp",
  "expense:Groceries": "cat_groceries",
  "expense:Health": "cat_health",
  "expense:Home": "cat_home",
  "expense:Other expense": "cat_other_exp",
  "expense:Parents": "cat_parents",
  "expense:Pets": "cat_pets",
  "expense:Sport": "cat_sport",
  "expense:Transport": "cat_transport",
  "expense:Travel": "cat_travel",
  "expense:Uncategorised expense": "cat_uncat_exp",
  "expense:Work": "cat_work",
  "income:Balance correction": "cat_balance_inc",
  "income:Gifts": "cat_gifts_inc",
  "income:Other income": "cat_other_inc",
  "income:Salary": "cat_salary",
  "income:Sale": "cat_sale",
  "income:Uncategorised income": "cat_uncat_inc",
};

/**
 * Where unmatched rows land. Referenced by id rather than by matching /^uncategorised/ against
 * the name, which would silently stop working the moment the category is renamed.
 */
export const UNCATEGORISED_ID: Record<"expense" | "income", string> = {
  expense: "cat_uncat_exp",
  income: "cat_uncat_inc",
};

/** Resolves a CSV category name to an existing category id, tolerating renames. */
export function resolveCategoryId(
  rawName: string,
  kind: "expense" | "income",
  byLowercasedName: Map<string, { id: string }>,
): string | undefined {
  const name = canonicalCategoryName(rawName);
  if (!name) return undefined;
  return (
    byLowercasedName.get(`${kind}:${name.toLowerCase()}`)?.id ??
    SEEDED_CATEGORY_IDS[`${kind}:${name}`]
  );
}
