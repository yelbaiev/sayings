import type { Currency } from "@shared/currency";
import { cn } from "~/lib/cn";
import { Button } from "~/ui/Button";
import { HoldButton } from "~/ui/HoldButton";
import { CARD, HINT, LIST, PAGE, PAGE_TITLE, ROW, ROW_SUB, ROW_TITLE, SECTION_TITLE } from "~/ui/recipes";
import { parseTemplate, serialiseTemplate, type QuickTileTemplate } from "@shared/quick-tile";
import type { Account, Category, Recurring } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { newId, put, remove } from "~/db/mutations";
import { useAccounts, useCategories } from "~/db/queries";
import { AmountField } from "~/features/entry/AmountField";
import { toBaseAtLatest, useLatestRates } from "~/db/useRates";
import { formatDate, formatMoney, todayIso } from "~/lib/format";
import {
  monthlyTotal,
  nextOccurrence,
  type MonthlyEntry,
  type MonthlyTotal,
} from "~/lib/recurring";
import { Amount, EmptyState, Field, IconChip, Sheet, Toast, type ToastSpec } from "~/ui";
import { useRecurringActions, useRecurringList } from "./useRecurring";

type CadenceKey = `recurring.cadence.${Recurring["cadence"]}`;

export function RecurringPage() {
  const { t, locale, baseCurrency } = useApp();
  const items = useRecurringList();
  const categories = useCategories(undefined, true);
  // Loaded here and passed down; see the note in QuickTiles.
  const accounts = useAccounts();
  const expenseCategories = useCategories("expense");
  const incomeCategories = useCategories("income");
  const { post, skip } = useRecurringActions();
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const [toast, setToast] = useState<ToastSpec | null>(null);

  const today = todayIso();
  const rates = useLatestRates(baseCurrency);

  /*
   * What a month of standing commitments costs.
   *
   * Two things this has to get right. Cadences are mixed, so everything is normalised to a
   * monthly figure before being added — see monthlyEquivalent. And the schedules are in three
   * currencies, so each currency keeps its own subtotal and the combined figure is converted at
   * today's rate; a single UAH number would hide the euro and dollar subscriptions entirely,
   * which is the same bug the Home total had.
   *
   * Paused schedules are excluded: a paused subscription is not a commitment.
   */
  const totals = useMemo(() => {
    const expense: MonthlyEntry[] = [];
    const income: MonthlyEntry[] = [];
    let paused = 0;

    for (const item of items) {
      if (item.active === 0) {
        paused++;
        continue;
      }
      const template = parseTemplate(item.template);
      if (!template) continue;
      const entry: MonthlyEntry = {
        amount_minor: template.amount_minor,
        currency: template.currency,
        cadence: item.cadence,
      };
      (template.kind === "income" ? income : expense).push(entry);
    }

    const convert = (minor: number, currency: Currency) =>
      toBaseAtLatest(minor, currency, rates, baseCurrency);

    return {
      expense: monthlyTotal(expense, convert, baseCurrency),
      income: monthlyTotal(income, convert, baseCurrency),
      paused,
    };
  }, [items, rates, baseCurrency]);

  return (
    <div className={PAGE}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className={cn(PAGE_TITLE, "mb-0")}>{t("recurring.title")}</h1>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("recurring.add")}
        </Button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">{t("recurring.reviewHint")}</p>

      {items.length > 0 && (
        <div className={cn(CARD, "mb-4")}>
          <MonthlyBlock label={t("recurring.monthlyExpense")} total={totals.expense} tone="expense" />
          {totals.income.byCurrency.length > 0 && (
            <div className="mt-2.5 border-t border-border pt-2.5">
              <MonthlyBlock label={t("recurring.monthlyIncome")} total={totals.income} tone="income" />
            </div>
          )}
          <p className={cn(HINT, "mt-2.5")}>
            {t("recurring.monthlyHint")}
            {totals.paused > 0 && ` · ${t("recurring.pausedExcluded")}`}
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon="🔁" message={t("recurring.empty")} />
      ) : (
        <div className={LIST}>
          {items.map((item) => {
            const template = parseTemplate(item.template);
            const category = template
              ? categories.find((c) => c.id === template.category_id)
              : undefined;
            const due = item.active === 1 && item.next_on <= today;

            return (
              <div key={item.id} className={ROW}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  onClick={() => setEditing(item)}
                >
                  <IconChip icon={category?.icon ?? "🔁"} color={category?.color} />
                  <span className="min-w-0 flex-1">
                    <span className={ROW_TITLE}>{item.label}</span>
                    <span className={ROW_SUB}>
                      {t(`recurring.cadence.${item.cadence}` as CadenceKey)}
                      {item.active === 0
                        ? ` · ${t("recurring.paused")}`
                        : ` · ${t("recurring.next", { date: formatDate(item.next_on, locale) })}`}
                    </span>
                  </span>
                  {template && (
                    <span className="shrink-0">
                      <Amount
                        minor={template.amount_minor}
                        currency={template.currency}
                        tone={template.kind}
                      />
                    </span>
                  )}
                </button>

                {/* Sized by their labels. These used to reuse `.reorder__btn` — the 30x26px arrow
                    button from the accounts list — with a hardcoded 56px width, so "Пропустить"
                    overflowed its box and the two labels printed on top of each other. */}
                {due && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() =>
                        void post(item).then(
                          () => setToast({ message: t("recurring.added", { label: item.label }) }),
                        )
                      }
                    >
                      {t("recurring.addNow")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void skip(item).then(
                          () => setToast({ message: t("recurring.skipped", { label: item.label }) }),
                        )
                      }
                    >
                      {t("recurring.skip")}
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <RecurringSheet
          item={editing === "new" ? undefined : editing}
          accounts={accounts}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && <Toast spec={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function RecurringSheet({
  item,
  accounts,
  expenseCategories: expense,
  incomeCategories: income,
  onClose,
}: {
  item?: Recurring | undefined;
  accounts: Account[];
  expenseCategories: Category[];
  incomeCategories: Category[];
  onClose: () => void;
}) {
  const { t, me, baseCurrency, enabledCurrencies } = useApp();

  const existing = item ? parseTemplate(item.template) : null;

  const [label, setLabel] = useState(item?.label ?? "");
  const [kind, setKind] = useState<"expense" | "income">(existing?.kind ?? "expense");
  // The schedule's own currency, resolved first: the amount is scaled by it.
  const prefillCurrency: Currency = existing?.currency ?? baseCurrency;
  const [amountMinor, setAmountMinor] = useState<number | null>(existing?.amount_minor ?? null);
  const [currency, setCurrency] = useState<Currency>(prefillCurrency);
  const [categoryId, setCategoryId] = useState(existing?.category_id ?? "");
  const [accountId, setAccountId] = useState(existing?.account_id ?? accounts[0]?.id ?? "");
  const [cadence, setCadence] = useState<Recurring["cadence"]>(item?.cadence ?? "monthly");
  const [dayOf, setDayOf] = useState(item?.day_of ?? 1);
  const [active, setActive] = useState(item?.active !== 0);
  const [error, setError] = useState<string | null>(null);

  const categories = kind === "expense" ? expense : income;

  async function save() {
    // The pad cannot produce anything unparseable, so the try/catch the text input needed is gone.
    const minor = amountMinor ?? 0;
    if (!label.trim()) {
      setError(t("quickTile.needLabel"));
      return;
    }
    if (minor <= 0) {
      setError(t("entry.needAmount"));
      return;
    }
    if (!categoryId) {
      setError(t("entry.needCategory"));
      return;
    }
    if (!accountId) {
      setError(t("entry.needAccount"));
      return;
    }

    const template: QuickTileTemplate = {
      kind,
      amount_minor: minor,
      currency,
      category_id: categoryId,
      account_id: accountId,
    };

    // A new schedule starts at its next occurrence rather than today, so creating it does not
    // immediately prompt for a payment that has probably already been made.
    const nextOn = item?.next_on ?? nextOccurrence(todayIso(), cadence, dayOf);

    await put(
      "recurring",
      {
        id: item?.id ?? newId(),
        label: label.trim(),
        template: serialiseTemplate(template),
        cadence,
        day_of: dayOf,
        next_on: nextOn,
        active: active ? 1 : 0,
      } as never,
      me,
    );
    onClose();
  }

  return (
    <Sheet title={item ? t("recurring.edit") : t("recurring.add")} onClose={onClose}>
      <Field label={t("recurring.label")}>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t("recurring.labelPlaceholder")}
          autoFocus
        />
      </Field>

      <div className="mb-3 flex w-full rounded-lg bg-muted p-1" role="group">
        {(["expense", "income"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={cn(
              "min-h-9 flex-1 rounded-md text-sm font-medium text-muted-foreground",
              kind === option && "bg-background text-foreground shadow-sm",
            )}
            aria-pressed={kind === option}
            onClick={() => {
              // Only on a real change. Firing this for the already-selected kind wiped a
              // category the user had just chosen, and the failure then surfaced as an
              // unrelated "enter the amount" message.
              if (option === kind) return;
              setKind(option);
              setCategoryId("");
            }}
          >
            {t(`kind.${option}`)}
          </button>
        ))}
      </div>

      <Field label={t("entry.amount")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">
            <AmountField
              valueMinor={amountMinor}
              currency={currency}
              onChange={setAmountMinor}
              label={t("entry.amount")}
            />
          </span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            aria-label={t("accounts.currency")}
            className="w-auto"
          >
            {enabledCurrencies.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </Field>

      <Field label={t("entry.category")}>
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("entry.account")}>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          {/* An explicit empty option so a value matching nothing renders as "—" instead of
              silently displaying the first account while holding no selection. That mismatch is
              what made "Выберите счёт" appear next to an apparently chosen account. */}
          <option value="">—</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.currency}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("recurring.cadence")}>
        <select
          value={cadence}
          onChange={(event) => setCadence(event.target.value as Recurring["cadence"])}
        >
          {(["weekly", "monthly", "yearly"] as const).map((option) => (
            <option key={option} value={option}>
              {t(`recurring.cadence.${option}` as CadenceKey)}
            </option>
          ))}
        </select>
      </Field>

      {cadence !== "weekly" && (
        <Field
          label={t("recurring.dayOf")}
          hint={dayOf > 28 ? t("recurring.next", { date: nextOccurrence(todayIso(), cadence, dayOf) }) : undefined}
        >
          <input
            type="number"
            min={1}
            max={31}
            value={dayOf}
            onChange={(event) =>
              setDayOf(Math.max(1, Math.min(31, Number(event.target.value) || 1)))
            }
          />
        </Field>
      )}

      <label className="mt-3 flex min-h-11 items-center justify-between gap-3">
        <span>{t("recurring.pause")}</span>
        <input
          type="checkbox"
          checked={!active}
          onChange={(event) => setActive(!event.target.checked)}
        />
      </label>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Button variant="primary" block layoutClassName="mt-4" onClick={() => void save()}>
        {t("common.save")}
      </Button>

      {item && (
        <HoldButton block layoutClassName="mt-2" onConfirm={() => void remove("recurring", item.id, me).then(onClose)}>
          {t("common.delete")}
        </HoldButton>
      )}
    </Sheet>
  );
}

/** Prompt shown on Home when something is due. Never writes without confirmation. */
export function RecurringDuePrompt() {
  const { t, locale } = useApp();
  const { post, skip } = useRecurringActions();
  const items = useRecurringList();
  const due = items.filter((i) => i.active === 1 && i.next_on <= todayIso());

  if (due.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className={SECTION_TITLE}>{t("recurring.due")}</h2>
      <div className={LIST}>
        {due.map((item) => {
          const template = parseTemplate(item.template);
          return (
            <div key={item.id} className={ROW}>
              <span className="min-w-0 flex-1">
                <span className={ROW_TITLE}>{item.label}</span>
                <span className={cn(ROW_SUB, "sensitive")}>
                  {template
                    ? formatMoney(template.amount_minor, template.currency, locale)
                    : t("common.none")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={() => void skip(item)}
                >
                  {t("recurring.skip")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void post(item)}
                >
                  {t("recurring.addNow")}
                </Button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * One monthly figure: the converted total as the headline, per-currency subtotals beneath it.
 *
 * The breakdown appears only when there is more than one currency — with a single currency it
 * would just repeat the headline. When a rate is missing there is no headline at all, only the
 * breakdown, because a combined total short of one currency understates what the household is
 * committed to.
 */
function MonthlyBlock({
  label,
  total,
  tone,
}: {
  label: string;
  total: MonthlyTotal;
  tone: "expense" | "income";
}) {
  const { t, baseCurrency } = useApp();

  if (total.byCurrency.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Amount minor={0} currency={baseCurrency} tone="neutral" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        {total.grandUsable ? (
          <Amount minor={total.grand} currency={baseCurrency} tone={tone} />
        ) : (
          <span className="text-xs text-muted-foreground">{t("recurring.noRate")}</span>
        )}
      </div>

      {total.byCurrency.length > 1 &&
        total.byCurrency.map(([currency, minor]) => (
          <div key={currency} className="flex items-center justify-between gap-3">
            <span className="pl-3 text-xs text-muted-foreground">
              {t("home.totalIn", { currency })}
            </span>
            <Amount minor={minor} currency={currency} tone="neutral" />
          </div>
        ))}
    </div>
  );
}
