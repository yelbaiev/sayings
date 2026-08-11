import { readFileSync, writeFileSync } from "node:fs";

/**
 * Imports Saldo's category × month summary export as synthetic transactions.
 *
 * Saldo could only give us monthly totals per category, not individual transactions. That is
 * enough to reproduce the category × month matrix — the report actually used day to day — but
 * it has no dates within the month, no payees, and no account attribution, because that
 * information does not exist in the file.
 *
 * Two design choices follow from that:
 *
 *  1. **Everything lands on one dedicated account** ("Saldo history"), archived and excluded
 *     from totals. Reports aggregate by category and date, never by account, so the matrix
 *     picks the history up while real account balances and net worth stay exactly as entered.
 *     Attaching synthetic rows to real accounts would corrupt balances that are currently
 *     correct.
 *
 *  2. **`updated_by` is left NULL.** Nobody entered these, so attributing them to a member
 *     would skew the spend-by-person report. `spendByMember` only counts rows it can attribute,
 *     so they are correctly ignored there.
 *
 * Rows carry a readable `import_hash` (`saldo:<period>:<category>`), which the unique index on
 * (household_id, import_hash) turns into idempotency — and which makes them trivially
 * identifiable if a real per-transaction export ever replaces them.
 *
 * Usage:
 *   node scripts/import-saldo-monthly.mjs <csv> [--through YYYY-MM] > import.sql
 */

const HOUSEHOLD = "hh_default";
const ACCOUNT_ID = "acc_saldo_history";
const ACCOUNT_NAME = "Saldo history";

/** Category ids keyed by `${kind}:${name}`, matching migrations/0002_seed.sql. */
const CATEGORY_IDS = {
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

/** The two malformed names in the source: a trailing space, and one lowercased. */
const ALIASES = { "Document ": "Document", Document: "Document", work: "Work" };

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/* --------------------------------------------------------------------------- CSV parsing */

function parseCsv(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** "Jan, 2020" -> "2020-01"; a bare "2021" -> "2021". */
function parsePeriod(label) {
  const monthly = /^([A-Za-z]{3}),\s*(\d{4})$/.exec(label.trim());
  if (monthly) {
    const month = MONTHS.indexOf(monthly[1]) + 1;
    if (month === 0) return null;
    return `${monthly[2]}-${String(month).padStart(2, "0")}`;
  }
  return /^\d{4}$/.test(label.trim()) ? label.trim() : null;
}

/**
 * "₴1,234" -> 123400 minor units. Integer arithmetic on the digits, never a float multiply —
 * `Number("1234.56") * 100` is the drift this project exists to avoid.
 */
function parseAmount(raw) {
  let text = String(raw).replace(/[₴\s\u00a0\u2009\u202f,]/g, "").trim();
  if (!text) return 0;
  const negative = text.startsWith("-");
  text = text.replace(/^[-+]/, "");
  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") return 0;
  const [whole = "0", frac = ""] = text.split(".");
  const minor = BigInt(whole || "0") * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0") || "0");
  return Number(negative ? -minor : minor);
}

/* ------------------------------------------------------------------------------ main */

const [csvPath, ...rest] = process.argv.slice(2);
if (!csvPath) {
  console.error("usage: node scripts/import-saldo-monthly.mjs <csv> [--through YYYY-MM]");
  process.exit(1);
}
const throughIndex = rest.indexOf("--through");
const through = throughIndex === -1 ? null : rest[throughIndex + 1];

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const periods = rows[0].slice(1).map(parsePeriod);
if (periods.some((p) => p === null)) {
  console.error("unrecognised period labels in header");
  process.exit(1);
}

let section = null;
const cells = [];
const unmatched = new Set();
let skippedFuture = 0;

for (const row of rows.slice(1)) {
  const rawName = row[0];
  const name = rawName.trim();
  const lower = name.toLowerCase();

  // Section markers. The totals rows are checks, not data.
  if (lower === "total expenses") {
    section = "expense";
    continue;
  }
  if (lower === "total income") {
    section = "income";
    continue;
  }
  if (lower === "profit") {
    section = null;
    continue;
  }
  if (!section) continue;

  const canonical = ALIASES[rawName] ?? ALIASES[name] ?? name;
  const categoryId = CATEGORY_IDS[`${section}:${canonical}`];
  if (!categoryId) {
    unmatched.add(`${section}:${canonical}`);
    continue;
  }

  periods.forEach((period, i) => {
    const minor = parseAmount(row[i + 1] ?? "");
    if (minor === 0) return;
    if (through && period > through) {
      skippedFuture++;
      return;
    }
    // Dated the 1st: always a real, non-future date for any period that has data, and
    // unambiguously synthetic.
    const occurredOn = period.length === 7 ? `${period}-01` : `${period}-01-01`;
    cells.push({
      period,
      occurredOn,
      kind: section,
      categoryId,
      // Magnitudes only — direction comes from `kind`, per shared/money.ts.
      minor: Math.abs(minor),
    });
  });
}

if (unmatched.size) {
  console.error(`ERROR: unmatched categories: ${[...unmatched].join(", ")}`);
  process.exit(1);
}

const sql = [];
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

sql.push("-- Saldo monthly summary import. Idempotent: re-running changes nothing.");
sql.push("-- Generated by scripts/import-saldo-monthly.mjs — do not edit by hand.");
sql.push("");
sql.push(
  "-- One dedicated account, archived and excluded from totals, so real balances are untouched.",
);
sql.push(`INSERT INTO accounts
  (id, household_id, name, type, currency, opening_balance_minor, icon, color,
   exclude_from_totals, archived, sort_order, rev, updated_at, updated_by, deleted)
VALUES (${q(ACCOUNT_ID)}, ${q(HOUSEHOLD)}, ${q(ACCOUNT_NAME)}, 'bank', 'UAH', 0, '🗄️',
        '#6E6E76', 1, 1, 999,
        (SELECT rev + 1 FROM household_seq WHERE household_id = ${q(HOUSEHOLD)}),
        CAST(strftime('%s','now') AS INTEGER) * 1000, NULL, 0)
ON CONFLICT(id) DO UPDATE SET exclude_from_totals = 1, archived = 1;`);
sql.push("");

// The unique index on (household_id, import_hash) is PARTIAL — it carries
// `WHERE import_hash IS NOT NULL` — and SQLite will not match a partial index for an upsert
// unless the conflict target repeats that predicate. Omitting it fails with
// "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
for (const c of cells) {
  const hash = `saldo:${c.period}:${c.categoryId}`;
  sql.push(`INSERT INTO transactions
  (id, household_id, kind, occurred_on, account_id, to_account_id, category_id,
   amount_minor, currency, to_amount_minor, to_currency, base_amount_minor, fx_rate,
   fx_estimated, note, payee, tags, split_parent_id, receipt_key, import_hash,
   rev, updated_at, updated_by, deleted)
VALUES (${q(`tx_${hash}`)}, ${q(HOUSEHOLD)}, ${q(c.kind)}, ${q(c.occurredOn)}, ${q(ACCOUNT_ID)},
        NULL, ${q(c.categoryId)}, ${c.minor}, 'UAH', NULL, NULL, ${c.minor}, 1, 0,
        'Saldo monthly total', NULL, NULL, NULL, NULL, ${q(hash)},
        (SELECT rev + 1 FROM household_seq WHERE household_id = ${q(HOUSEHOLD)}),
        CAST(strftime('%s','now') AS INTEGER) * 1000, NULL, 0)
ON CONFLICT(household_id, import_hash) WHERE import_hash IS NOT NULL DO NOTHING;`);
}

sql.push("");
sql.push("-- Single rev bump for the whole batch: the sync cursor is \"everything above N\",");
sql.push("-- so clients pull all of these in one page and advance past them together.");
sql.push(
  `UPDATE household_seq SET rev = rev + 1 WHERE household_id = ${q(HOUSEHOLD)};`,
);

writeFileSync(rest.includes("-o") ? rest[rest.indexOf("-o") + 1] : "saldo-import.sql", sql.join("\n") + "\n");

const byKind = cells.reduce((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {});
const total = cells.reduce((acc, c) => acc + (c.kind === "expense" ? c.minor : 0), 0);
console.error(
  `${cells.length} transactions (${byKind.expense ?? 0} expense, ${byKind.income ?? 0} income)` +
    `\nperiods ${cells[0]?.period} .. ${cells[cells.length - 1]?.period}` +
    `\nexpense total ₴${(total / 100).toLocaleString("en-US")}` +
    (skippedFuture ? `\nskipped ${skippedFuture} cells after ${through}` : ""),
);
