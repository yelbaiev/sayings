import { type Currency } from "@shared/currency";
import type { Budget, Category } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { db } from "~/db/dexie";
import { newId, put, remove } from "~/db/mutations";
import { useCategories, useTransactions } from "~/db/queries";
import { AmountField } from "~/features/entry/AmountField";
import { budgetStatuses } from "~/lib/budget-engine";
import { addMonths, formatMoney, formatMonth, monthOf, todayIso } from "~/lib/format";
import { useBudgetFigures } from "./useBudgetFigures";
import { useLiveQuery } from "dexie-react-hooks";
import { Amount, Chip, EmptyState, Field, IconChip, Progress, Sheet } from "~/ui";
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

  const { figures, toBase } = useBudgetFigures();
  const statuses = useMemo(
    () => budgetStatuses(budgets ?? [], categories, transactions, month, toBase),
    [budgets, categories, transactions, month, toBase],
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
          {statuses.map((status) => {
            const f = figures(status);
            return (
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
                    <Amount minor={f.spent} currency={f.currency} tone="neutral" /> /{" "}
                    <Amount minor={f.limit} currency={f.currency} tone="muted" />
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
                      ? t("budgets.over", { amount: formatWhole(-f.remaining, f.currency) })
                      : t("budgets.remaining", { amount: formatWhole(f.remaining, f.currency) })}
                  </span>
                </div>

                {status.budget.rollover === 1 && status.effectiveLimit !== status.baseLimit && (
                  <div className="mt-1 text-xs text-muted-foreground">{t("budgets.rollover")}</div>
                )}

                {/* A limit in another currency says what it is worth in the base today, since that
                  is the figure it is being compared against. */}
                {f.currency !== baseCurrency && (
                  <div className="sensitive mt-1 text-xs text-muted-foreground">
                    {t("budgets.inBase", {
                      amount: formatWhole(status.effectiveLimit, baseCurrency),
                    })}
                  </div>
                )}
              </button>
            );
          })}
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

  /** Whole units: a budget line is a glance, and kopecks on a ₴10 000 limit are noise. */
  function formatWhole(minor: number, currency: Currency): string {
    return formatMoney(minor, currency, locale);
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
  const { t, me, locale, baseCurrency, secondaryCurrency } = useApp();
  const { toBase } = useBudgetFigures();

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
        currency,
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
