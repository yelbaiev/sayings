import type { Currency } from "@shared/currency";
import {
  guessMapping,
  isImportable,
  parseTransactions,
  type ColumnMapping,
  type FieldName,
  type ParseResult,
  type ParsedRow,
} from "@shared/import/transactions";
import { parseCsvTable, type CsvTable } from "@shared/import/csv";
import {
  UNCATEGORISED_ID,
  canonicalCategoryName,
  resolveCategoryId,
} from "@shared/import/saldo-summary";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { cn } from "~/lib/cn";
import { Button } from "~/ui/Button";
import { CARD, LIST, ROW, ROW_SUB, ROW_TITLE, SECTION_TITLE } from "~/ui/recipes";
import { db } from "~/db/dexie";
import { newId, putMany } from "~/db/mutations";
import { useAccounts, useCategories } from "~/db/queries";
import { rateFor } from "~/lib/fx";
import { formatMoney } from "~/lib/format";
import { Amount, Field, Sheet, type ToastSpec } from "~/ui";

/**
 * CSV import: drop a file, map the columns, check the preview, commit.
 *
 * The preview is not decoration. Column mapping is a guess, and a transposed day and month
 * would misfile a third of a year without anything looking wrong. Nothing is written until
 * the parsed result has been seen.
 */

const FIELDS: FieldName[] = [
  "ignore",
  "date",
  "amount",
  "currency",
  "account",
  "toAccount",
  "category",
  "note",
  "payee",
  "kind",
];

type Step = "file" | "map" | "commit";

export function ImportPage({ onClose }: { onClose: (toast?: ToastSpec) => void }) {
  const { t, me, locale, baseCurrency, enabledCurrencies } = useApp();
  const accounts = useAccounts(true);
  const categories = useCategories(undefined, true);

  const [step, setStep] = useState<Step>("file");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultCurrency, setDefaultCurrency] = useState<Currency>(baseCurrency);
  const [existingHashes, setExistingHashes] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const result: ParseResult | null = useMemo(() => {
    if (!table) return null;
    return parseTransactions(table, { mapping, defaultCurrency, existingHashes });
  }, [table, mapping, defaultCurrency, existingHashes]);

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseCsvTable(text);
      if (parsed.headers.length === 0) {
        setError(t("common.error"));
        return;
      }

      // Every hash already stored, so a re-run of the same file is a no-op rather than a
      // second copy of five years of history.
      const rows = await db.transactions.toArray();
      setExistingHashes(new Set(rows.map((row) => row.import_hash).filter((h): h is string => !!h)));

      setTable(parsed);
      setMapping(guessMapping(parsed.headers));
      setStep("map");
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  /**
   * Writes the importable rows.
   *
   * Accounts and categories referenced by name are created if missing, so an import does not
   * stall on a setup step. Chunked, because a five-year import is tens of thousands of rows
   * and one giant IndexedDB transaction would block the UI thread for seconds.
   */
  async function commit() {
    if (!result) return;
    const importable = result.rows.filter(isImportable);
    setProgress({ done: 0, total: importable.length });

    const accountByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
    const categoryByName = new Map(categories.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c]));

    const newRows: { table: "accounts" | "categories" | "transactions"; row: Record<string, unknown> }[] = [];

    const ensureAccount = (name: string, currency: Currency): string => {
      const existing = accountByName.get(name.toLowerCase());
      if (existing) return existing.id;
      const id = newId();
      const row = {
        id,
        name,
        type: "bank" as const,
        currency,
        opening_balance_minor: 0,
        icon: "🏦",
        color: "#6E6E76",
        exclude_from_totals: 0 as const,
        archived: 0 as const,
        sort_order: accountByName.size + 1,
      };
      newRows.push({ table: "accounts", row });
      accountByName.set(name.toLowerCase(), { ...row, household_id: "hh_default", rev: 0, updated_at: 0, deleted: 0 } as never);
      return id;
    };

    const ensureCategory = (rawName: string, kind: "expense" | "income"): string => {
      // 'Document ' and 'work' in the Saldo data are renamed through an explicit alias table
      // rather than being silently trimmed.
      const name = canonicalCategoryName(rawName);

      // Resolves against current names first, then the original English seed names. That second
      // step is what keeps an English-labelled export importable after the categories have been
      // renamed — otherwise it would quietly create a duplicate set.
      const resolved = resolveCategoryId(rawName, kind, categoryByName);
      if (resolved) return resolved;

      // Unmatched rows go to Uncategorised, addressed by id. Matching /^uncategorised/ on the
      // name would break silently the moment that category is renamed.
      if (!name) return UNCATEGORISED_ID[kind];

      const id = newId();
      const row = {
        id,
        kind,
        name: name || "Uncategorised",
        parent_id: null,
        icon: "🏷️",
        color: "#6E6E76",
        archived: 0 as const,
        sort_order: categoryByName.size + 1,
      };
      newRows.push({ table: "categories", row });
      categoryByName.set(`${kind}:${name.toLowerCase()}`, {
        ...row,
        household_id: "hh_default",
        rev: 0,
        updated_at: 0,
        deleted: 0,
      } as never);
      return id;
    };

    for (const row of importable) {
      const accountId = ensureAccount(row.accountName, row.currency);
      const toAccountId = row.toAccountName ? ensureAccount(row.toAccountName, row.currency) : null;
      const categoryId =
        row.kind === "transfer"
          ? null
          : ensureCategory(row.categoryName, row.kind === "income" ? "income" : "expense");

      const fx = await rateFor(row.currency, row.occurredOn!, baseCurrency);
      const base = Math.round(row.amountMinor! * fx.rate);

      newRows.push({
        table: "transactions",
        row: {
          created_by: me.id,
          id: newId(),
          kind: row.kind,
          occurred_on: row.occurredOn,
          account_id: accountId,
          to_account_id: toAccountId,
          category_id: categoryId,
          amount_minor: row.amountMinor,
          currency: row.currency,
          to_amount_minor: toAccountId ? row.amountMinor : null,
          to_currency: toAccountId ? row.currency : null,
          base_amount_minor: base,
          fx_rate: fx.rate,
          fx_estimated: fx.estimated ? 1 : 0,
          note: row.note,
          payee: row.payee,
          tags: null,
          split_parent_id: null,
          receipt_key: null,
          // What makes a second run of the same file a no-op.
          import_hash: row.hash,
        },
      });
    }

    const CHUNK = 200;
    for (let i = 0; i < newRows.length; i += CHUNK) {
      await putMany(newRows.slice(i, i + CHUNK) as never, me);
      setProgress({ done: Math.min(i + CHUNK, newRows.length), total: newRows.length });
      // Yields to the event loop so the progress indicator actually paints.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    setProgress(null);
    onClose({ message: t("import.done", { count: importable.length }) });
  }

  return (
    <Sheet title={t("import.title")} onClose={() => onClose()}>
      {step === "file" && (
        <>
          <label className={cn(CARD, "block cursor-pointer text-center hover:bg-accent")}>
            <div className="text-3xl" aria-hidden>
              📄
            </div>
            <div className="mt-2">{t("import.dropFile")}</div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </>
      )}

      {step === "map" && table && result && (
        <>
          <h3 className={SECTION_TITLE}>{t("import.mapColumns")}</h3>

          <Field label={t("import.column.currency")} hint={t("common.optional")}>
            <select
              value={defaultCurrency}
              onChange={(event) => setDefaultCurrency(event.target.value as Currency)}
            >
              {enabledCurrencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>

          <div className={cn(LIST, "mb-4")}>
            {table.headers.map((header) => (
              <div key={header} className={ROW}>
                <span className="min-w-0 flex-1">
                  <span className={ROW_TITLE}>{header}</span>
                  <span className={ROW_SUB}>{table.rows[0]?.[header] || "—"}</span>
                </span>
                <select
                  value={mapping[header] ?? "ignore"}
                  onChange={(event) =>
                    setMapping({ ...mapping, [header]: event.target.value as FieldName })
                  }
                  aria-label={header}
                  className="w-auto min-w-[130px]"
                >
                  {FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {t(`import.column.${field}` as `import.column.${FieldName}`)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className={cn(CARD, "mb-4")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs">
                {t("import.rowsReady", { count: result.counts.ready })}
              </span>
              {result.counts.skipped > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t("import.rowsSkipped", { count: result.counts.skipped })}
                </span>
              )}
            </div>
            {result.counts.duplicates > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {t("import.duplicatesFound", { count: result.counts.duplicates })}
              </div>
            )}
          </div>

          <h3 className={SECTION_TITLE}>{t("import.preview")}</h3>
          <div className={cn(LIST, "max-h-[300px] overflow-y-auto")}>
            {result.rows.slice(0, 40).map((row) => (
              <PreviewRow key={row.line} row={row} locale={locale} />
            ))}
          </div>

          <Button
            variant="primary"
            block
            layoutClassName="mt-4"
            disabled={result.counts.ready === 0 || progress !== null}
            onClick={() => void commit()}
          >
            {progress
              ? `${progress.done} / ${progress.total}`
              : t("import.commit", { count: result.counts.ready })}
          </Button>
        </>
      )}
    </Sheet>
  );
}

function PreviewRow({ row, locale }: { row: ParsedRow; locale: Parameters<typeof formatMoney>[2] }) {
  const { t } = useApp();
  const bad = row.warnings.filter((w) => w !== "noCategory" && w !== "duplicate");

  return (
    <div className={cn(ROW, bad.length && "opacity-55")}>
      <span className="min-w-0 flex-1">
        <span className={ROW_TITLE}>
          {row.occurredOn ?? t("import.warning.noDate")} · {row.categoryName || "—"}
        </span>
        <span className={ROW_SUB}>
          {row.accountName || t("import.warning.noAccount")}
          {row.warnings.length > 0 &&
            ` · ${row.warnings
              .map((w) =>
                w === "duplicate"
                  ? t("import.duplicatesFound", { count: 1 })
                  : t(`import.warning.${w}` as "import.warning.noDate"),
              )
              .join(", ")}`}
        </span>
      </span>
      {row.amountMinor !== null ? (
        <Amount minor={row.amountMinor} currency={row.currency} tone={row.kind} cents />
      ) : (
        <span className="text-xs text-muted-foreground">{t("import.warning.noAmount")}</span>
      )}
      <span className="sr-only">{locale}</span>
    </div>
  );
}
