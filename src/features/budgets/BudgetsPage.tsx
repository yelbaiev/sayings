import { type Currency } from "@shared/currency";
import { minorToMajor } from "@shared/money";
import type { Budget, Category } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { db } from "~/db/dexie";
import { newId, put, remove } from "~/db/mutations";
import { useCategories, useTransactions } from "~/db/queries";
import { AmountField } from "~/features/entry/AmountField";
import { budgetStatuses } from "~/lib/budget-engine";
import { addMonths, formatMonth, monthOf, todayIso } from "~/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { Amount, EmptyState, Field, IconChip, Progress, Sheet } from "~/ui";
import { Button } from "~/ui/Button";
import { HoldButton } from "~/ui/HoldButton";
import { cn } from "~/lib/cn";
import { CARD, PAGE, PAGE_TITLE } from "~/ui/recipes";

export function BudgetsPage() {
  const { t, locale, baseCurrency } = useApp();
  const categories = useCategories("expense");
  const transactions = useTransactions();
  // `?? []` here would allocate a fresh array every render and defeat the memo below,
  // so the fallback is applied inside it instead.
  const budgets = useLiveQuery(async () => db.budgets.toArray());

  const [month, setMonth] = useState(() => monthOf(todayIso()));
  const [editing, setEditing] = useState<Budget | "new" | null>(null);

  const statuses = useMemo(
    () => budgetStatuses(budgets ?? [], categories, transactions, month, todayIso()),
    [budgets, categories, transactions, month],
  );

  return (
    <div className={PAGE}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className={cn(PAGE_TITLE, "mb-0")}>{t("budgets.title")}</h1>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("budgets.add")}
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </Button>
        <strong>{formatMonth(month, locale)}</strong>
        <Button size="sm" onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </Button>
      </div>

      {statuses.length === 0 ? (
        <EmptyState icon="🎯" message={t("budgets.empty")} />
      ) : (
        <div className="flex flex-col gap-2">
          {statuses.map((status) => (
            <button
              key={status.budget.id}
              type="button"
              className={cn(CARD, "text-left hover:bg-accent active:bg-accent")}
              onClick={() => setEditing(status.budget)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <IconChip icon={status.category.icon} color={status.category.color} small />
                  <strong className="truncate">{status.category.name}</strong>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <Amount minor={status.spent} currency={baseCurrency} tone="neutral" /> /{" "}
                  <Amount minor={status.effectiveLimit} currency={baseCurrency} tone="muted" />
                </span>
              </div>

              <div className="mt-2.5">
                <Progress ratio={status.ratio} />
              </div>

              <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
                <span
                  className={cn(
                    "sensitive",
                    status.remaining < 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {status.remaining < 0
                    ? t("budgets.over", {
                        amount: formatAmountText(-status.remaining, locale),
                      })
                    : t("budgets.remaining", {
                        amount: formatAmountText(status.remaining, locale),
                      })}
                </span>

                {/* Run-rate projection, shown only for the month in progress — a finished
                    month's actual is the answer, and a future month has no run rate. */}
                {status.projected !== null && (
                  <span
                    className={cn(
                      "sensitive",
                      status.projected > status.effectiveLimit
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {t("budgets.projected", {
                      amount: formatAmountText(status.projected, locale),
                    })}
                  </span>
                )}
              </div>

              {status.budget.rollover === 1 && status.effectiveLimit !== status.baseLimit && (
                <div className="mt-1 text-xs text-muted-foreground">{t("budgets.rollover")}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <BudgetSheet
          budget={editing === "new" ? undefined : editing}
          month={month}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );

  function formatAmountText(minor: number, forLocale: typeof locale): string {
    return new Intl.NumberFormat(forLocale, {
      style: "currency",
      currency: baseCurrency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).format(minorToMajor(minor, baseCurrency));
  }
}

function BudgetSheet({
  budget,
  month,
  categories,
  onClose,
}: {
  budget?: Budget | undefined;
  month: string;
  // Passed in rather than queried: a sheet's first render happens before its own Dexie query
  // resolves, so a useState initialiser reading it would see an empty list.
  categories: Category[];
  onClose: () => void;
}) {
  const { t, me, baseCurrency } = useApp();

  const [categoryId, setCategoryId] = useState(budget?.category_id ?? categories[0]?.id ?? "");
  const [amountMinor, setAmountMinor] = useState<number | null>(budget?.amount_minor ?? null);
  const [rollover, setRollover] = useState(budget?.rollover === 1);
  const [everyMonth, setEveryMonth] = useState(budget ? !budget.period_month : true);
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
        period_month: everyMonth ? null : month,
        amount_minor: minor,
        currency: baseCurrency,
        rollover: rollover ? 1 : 0,
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

      <Field label={t("budgets.limit")}>
        {/* A budget is said as arithmetic more often than as a figure — "1200 a week times four" —
            which is exactly what the pad is for. */}
        <AmountField
          valueMinor={amountMinor}
          currency={baseCurrency as Currency}
          onChange={setAmountMinor}
          label={t("budgets.limit")}
          autoFocus
        />
      </Field>

      <label className="mt-3 flex min-h-11 items-center justify-between gap-3">
        <span>{t("budgets.everyMonth")}</span>
        <input
          type="checkbox"
          checked={everyMonth}
          onChange={(event) => setEveryMonth(event.target.checked)}
        />
      </label>

      <label className="flex min-h-11 items-center justify-between gap-3">
        <span>{t("budgets.rollover")}</span>
        <input
          type="checkbox"
          checked={rollover}
          onChange={(event) => setRollover(event.target.checked)}
        />
      </label>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Button variant="primary" block layoutClassName="mt-4" onClick={() => void save()}>
        {t("common.save")}
      </Button>

      {budget && (
        <HoldButton block layoutClassName="mt-2" onConfirm={() => void remove("budgets", budget.id, me).then(onClose)}>
          {t("common.delete")}
        </HoldButton>
      )}
    </Sheet>
  );
}
