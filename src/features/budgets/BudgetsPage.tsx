import { type Currency } from "@shared/currency";
import type { Budget, Category } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { db } from "~/db/dexie";
import { newId, put, remove } from "~/db/mutations";
import { useCategories } from "~/db/queries";
import { useToBase } from "~/db/useRates";
import { AmountField } from "~/features/entry/AmountField";
import { formatMoney, formatMonth } from "~/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { Amount, Chip, EmptyState, Field, IconChip, Sheet } from "~/ui";
import { Button } from "~/ui/Button";
import { HoldButton } from "~/ui/HoldButton";
import { cn } from "~/lib/cn";
import { HINT, LIST, PAGE, PAGE_TITLE, ROW, ROW_SUB, ROW_TITLE } from "~/ui/recipes";

/**
 * The list of monthly limits, and nothing else.
 *
 * This page used to be a dashboard — a month stepper, spent/limit bars, "over by", carried-over
 * amounts, a conversion line under each foreign limit. Spending against a budget now lives in
 * Reports, beside the rest of the month's figures, so this is where limits are *set*: category,
 * amount, done. Two places showing the same comparison in two different ways was the complexity.
 */
export function BudgetsPage() {
  const { t, locale } = useApp();
  const categories = useCategories("expense");
  const budgets = useLiveQuery(async () => db.budgets.toArray());
  const [editing, setEditing] = useState<Budget | "new" | null>(null);

  // In the categories' own order, so the list reads like the category picker.
  const rows = useMemo(() => {
    const order = new Map(categories.map((c, index) => [c.id, index]));
    return (budgets ?? [])
      .filter((b) => b.deleted === 0 && order.has(b.category_id))
      .sort(
        (a, b) =>
          order.get(a.category_id)! - order.get(b.category_id)! ||
          (a.period_month ?? "").localeCompare(b.period_month ?? ""),
      )
      .map((budget) => ({
        budget,
        category: categories.find((c) => c.id === budget.category_id)!,
      }));
  }, [budgets, categories]);

  return (
    <div className={PAGE}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className={cn(PAGE_TITLE, "mb-0")}>{t("budgets.title")}</h1>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("budgets.add")}
        </Button>
      </div>
      <p className={cn(HINT, "mb-4")}>{t("budgets.hint")}</p>

      {rows.length === 0 ? (
        <EmptyState icon="🎯" message={t("budgets.empty")} />
      ) : (
        <div className={LIST}>
          {rows.map(({ budget, category }) => (
            <button
              key={budget.id}
              type="button"
              className={cn(ROW, "hover:bg-accent active:bg-accent")}
              onClick={() => setEditing(budget)}
            >
              <IconChip icon={category.icon} color={category.color} />
              <span className="min-w-0 flex-1">
                <span className={ROW_TITLE}>{category.name}</span>
                {/* Older one-month limits still exist; they say which month they are for. */}
                {budget.period_month && (
                  <span className={ROW_SUB}>
                    {t("budgets.onlyMonth", { month: formatMonth(budget.period_month, locale) })}
                  </span>
                )}
              </span>
              <Amount
                minor={budget.amount_minor}
                currency={budget.currency as Currency}
                tone="neutral"
              />
            </button>
          ))}
        </div>
      )}

      {editing && (
        <BudgetSheet
          budget={editing === "new" ? undefined : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BudgetSheet({
  budget,
  categories,
  onClose,
}: {
  budget?: Budget | undefined;
  // Passed in rather than queried: a sheet's first render happens before its own Dexie query
  // resolves, so a useState initialiser reading it would see an empty list.
  categories: Category[];
  onClose: () => void;
}) {
  const { t, me, locale, baseCurrency, secondaryCurrency } = useApp();
  const toBase = useToBase(baseCurrency);

  /*
   * The main currency, the second one from Settings, and — when editing — whatever the budget is
   * already in, so a limit set before the second currency changed can still be saved as it is.
   */
  const currencies = [
    ...new Set(
      [baseCurrency, secondaryCurrency, budget?.currency as Currency | undefined].filter(
        (c): c is Currency => !!c,
      ),
    ),
  ];
  const [currency, setCurrency] = useState<Currency>(
    (budget?.currency as Currency | undefined) ?? baseCurrency,
  );

  const [categoryId, setCategoryId] = useState(budget?.category_id ?? categories[0]?.id ?? "");
  const [amountMinor, setAmountMinor] = useState<number | null>(budget?.amount_minor ?? null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    // The pad cannot produce anything unparseable, so the try/catch the text input needed is gone.
    const minor = amountMinor ?? 0;
    if (minor <= 0 || !categoryId) {
      setError(t("entry.needAmount"));
      return;
    }

    await put(
      "budgets",
      {
        id: budget?.id ?? newId(),
        category_id: categoryId,
        // Every limit is a standing monthly one now. An older one-month limit keeps its month
        // when edited, so changing its amount does not quietly turn it into every month.
        period_month: budget?.period_month ?? null,
        amount_minor: minor,
        currency,
        // Carry-over is gone: Reports compare each month with its own limit.
        rollover: 0,
      } as never,
      me,
    );
    onClose();
  }

  return (
    <Sheet title={t("budgets.add")} onClose={onClose}>
      {/* Fields in a sheet stack with a gap now that the legacy .field margin is gone. */}
      <Field label={t("entry.category")}>
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      {/* Only offered when there is a choice: a household with one currency never sees this. */}
      {currencies.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {currencies.map((option) => (
            <Chip key={option} active={currency === option} onClick={() => setCurrency(option)}>
              {option}
            </Chip>
          ))}
        </div>
      )}

      <Field label={t("budgets.limit")}>
        {/* A budget is said as arithmetic more often than as a figure — "1200 a week times four" —
            which is exactly what the pad is for. */}
        <AmountField
          valueMinor={amountMinor}
          currency={currency}
          onChange={setAmountMinor}
          label={t("budgets.limit")}
          autoFocus
        />
      </Field>

      {currency !== baseCurrency && amountMinor !== null && amountMinor > 0 && (
        <p className="sensitive mt-1.5 text-xs text-muted-foreground">
          {(() => {
            const inBase = toBase(amountMinor, currency);
            return inBase === null
              ? t("budgets.noRate", { currency })
              : t("budgets.inBase", { amount: formatMoney(inBase, baseCurrency, locale) });
          })()}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Button variant="primary" block layoutClassName="mt-4" onClick={() => void save()}>
        {t("common.save")}
      </Button>

      {budget && (
        <HoldButton
          block
          layoutClassName="mt-2"
          onConfirm={() => void remove("budgets", budget.id, me).then(onClose)}
        >
          {t("common.delete")}
        </HoldButton>
      )}
    </Sheet>
  );
}
