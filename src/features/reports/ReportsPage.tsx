import type { Currency } from "@shared/currency";
import { signedMinor } from "@shared/money";
import type { Budget, Transaction } from "@shared/schema";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { db } from "~/db/dexie";
import { useAccounts, useCategories, useLookups, useMembers, useTransactions } from "~/db/queries";
import { useLatestRates, useToBase } from "~/db/useRates";
import { EntrySheet } from "~/features/entry/EntrySheet";
import { TransactionRow } from "~/features/transactions/TransactionRow";
import { budgetFor, limitInBase } from "~/lib/budget-engine";
import { CashflowChart, DonutChart, PeriodStrip, Sparkline, TrendChart } from "./charts";
import {
  authorOf,
  cashflowByAccount,
  cashflowOverTime,
  categoryMatrix,
  categoryTrends,
  countsForMemberReport,
  matrixToTsv,
  monthOverview,
  netWorthOverTime,
  periodOf,
  periodRange,
  spendByMember,
  type Period,
} from "~/lib/report-engine";
import {
  addMonths,
  formatAmount,
  formatMoney,
  formatMonth,
  formatMonthShort,
  monthOf,
  todayIso,
} from "~/lib/format";
import { cn } from "~/lib/cn";
import { Button } from "~/ui/Button";
import { CARD, LIST, PAGE_TITLE, ROW, ROW_SUB, ROW_TITLE } from "~/ui/recipes";
import {
  Amount,
  Chip,
  EmptyState,
  IconChip,
  SecondaryAmount,
  Segmented,
  Sheet,
  Toast,
  type ToastSpec,
} from "~/ui";

type ReportTab = "matrix" | "month" | "netWorth" | "cashflow" | "byMember";

const TAB_KEY = "sayings.reports.tab";
const TABS: ReportTab[] = ["matrix", "month", "netWorth", "cashflow", "byMember"];

/**
 * The tab to open on: the last one chosen on this device, else Month on a phone and the table on
 * anything wider. The table is a spreadsheet — on a 390px screen it shows one category column and
 * two months — while Month is one screen of donut and list, made for a thumb.
 *
 * Remembered in localStorage as a per-device convenience; it can be missing or throw (private
 * mode), and then the width decides.
 */
function initialTab(): ReportTab {
  try {
    const saved = window.localStorage.getItem(TAB_KEY);
    if (saved && (TABS as string[]).includes(saved)) return saved as ReportTab;
  } catch {
    // Storage unavailable: fall through to the width.
  }
  return window.matchMedia?.("(max-width: 640px)").matches ? "month" : "matrix";
}

const NO_BUDGETS: Budget[] = [];

export function ReportsPage() {
  const { t, locale, baseCurrency } = useApp();
  const transactions = useTransactions();
  const categories = useCategories(undefined, true);
  const accounts = useAccounts(true);
  const members = useMembers();
  const lookups = useLookups();

  const [tab, setTabState] = useState<ReportTab>(initialTab);
  const setTab = (next: ReportTab) => {
    setTabState(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembered this time; the choice still applies.
    }
  };
  // Raw rows; `budgetFor` skips deleted ones. The fallback is a constant so memos stay stable.
  const budgets = useLiveQuery(async () => db.budgets.toArray()) ?? NO_BUDGETS;
  const toBase = useToBase(baseCurrency);
  const [editing, setEditing] = useState<Transaction | undefined>(undefined);
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [month, setMonth] = useState(() => monthOf(todayIso()));
  /** Which side the month report is showing. Spending is what gets read most, so it leads. */
  const [monthKind, setMonthKind] = useState<"expense" | "income">("expense");
  /**
   * The matrix used to render every month from the first transaction to today — 33 columns once
   * the Saldo history landed, which is a lot of sideways scrolling to reach the current month.
   * A year is the span actually read; the control is there for when it is not.
   */
  // Kept as a string because Segmented is a string-valued control; "all" means no limit.
  const [monthRange, setMonthRange] = useState<"12" | "24" | "all">("12");
  /*
   * The filter, not the rows. Holding the rows froze the list at the moment it opened, so a
   * transaction edited from it kept showing its old amount and category until the sheet was closed
   * and reopened. Filtering the live ledger on every render keeps the list true after an edit — and
   * a row moved to another category simply leaves it.
   */
  const [drillDown, setDrillDown] = useState<{
    title: string;
    filter: (tx: Transaction) => boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Range spans from the earliest transaction to today, so a first-time user sees only the
  // periods they actually have data for rather than a wall of empty columns.
  const range = useMemo(() => {
    if (transactions.length === 0) return { from: todayIso(), to: todayIso() };
    let earliest = transactions[0]!.occurred_on;
    for (const tx of transactions) if (tx.occurred_on < earliest) earliest = tx.occurred_on;

    // Years are few enough to always show in full; only the monthly view needs limiting.
    if (period === "year" || monthRange === "all") return { from: earliest, to: todayIso() };

    const windowStart = `${addMonths(monthOf(todayIso()), -(Number(monthRange) - 1))}-01`;
    return { from: windowStart > earliest ? windowStart : earliest, to: todayIso() };
  }, [transactions, period, monthRange]);

  const matrix = useMemo(
    () => categoryMatrix(transactions, categories, kind, period, range.from, range.to),
    [transactions, categories, kind, period, range],
  );
  /* Newest period first, so the month being asked about is the one already on screen rather than
     the far end of a sideways scroll. The engine and the copied table stay chronological — a
     spreadsheet reads left to right in time. */
  const matrixPeriods = useMemo(() => [...matrix.periods].reverse(), [matrix.periods]);

  const overview = useMemo(
    () => monthOverview(transactions, categories, month),
    [transactions, categories, month],
  );
  const monthRows = overview.byCategory[monthKind];

  /* Six months ending at the one being read, for the sparkline in each category row. One pass over
     the ledger for every category at once — see categoryTrends. */
  const trends = useMemo(() => {
    const periods = Array.from({ length: 6 }, (_, index) => addMonths(month, index - 5));
    return categoryTrends(transactions, periods, "month");
  }, [transactions, month]);

  /* Nine months ending at the one being read, each sized by that side's total. */
  const monthBars = useMemo(() => {
    const months = Array.from({ length: 9 }, (_, index) => addMonths(month, index - 8));
    const totals = new Map(months.map((bucket) => [bucket, 0]));
    for (const tx of transactions) {
      const bucket = monthOf(tx.occurred_on);
      if (!totals.has(bucket)) continue;
      const signed = signedMinor(tx.kind, tx.base_amount_minor);
      if (signed === 0) continue;
      if (monthKind === "income" ? signed > 0 : signed < 0) {
        totals.set(bucket, (totals.get(bucket) ?? 0) + Math.abs(signed));
      }
    }
    return months.map((bucket) => ({ period: bucket, value: totals.get(bucket) ?? 0 }));
  }, [transactions, month, monthKind]);

  if (transactions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4">
        <h1 className={PAGE_TITLE}>{t("reports.title")}</h1>
        <EmptyState icon="📊" message={t("reports.empty")} />
      </div>
    );
  }

  /** Every figure in every report opens the transactions behind it. */
  function drill(title: string, filter: (tx: Transaction) => boolean) {
    setDrillDown({ title, filter });
  }

  /**
   * A category's budget for a month, for display beside its figures: the limit as set, in the
   * currency it was set in, and the same limit in base for the over/under comparison.
   *
   * The plain monthly limit, with no rollover and no projection. Reports answer "what was the
   * budget and did we keep to it"; the Budgets page is where carried-over amounts live.
   */
  function budgetOf(categoryId: string, bucket: string) {
    const budget = budgetFor(budgets, categoryId, bucket);
    if (!budget) return null;
    const inBase = limitInBase(budget, toBase);
    if (inBase === null) return null;
    return {
      label: formatMoney(budget.amount_minor, budget.currency as Currency, locale),
      inBase,
    };
  }

  // Shown only in the monthly table, and only when some category has a budget at all.
  const showBudgetColumn =
    period === "month" &&
    kind === "expense" &&
    matrix.rows.some((row) => budgetFor(budgets, row.category.id, monthOf(todayIso())));

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <h1 className={PAGE_TITLE}>{t("reports.title")}</h1>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {(
          [
            ["matrix", t("reports.matrix")],
            ["month", t("reports.month")],
            ["netWorth", t("reports.netWorth")],
            ["cashflow", t("reports.cashflow")],
            ["byMember", t("reports.byMember")],
          ] as [ReportTab, string][]
        ).map(([value, label]) => (
          <Chip key={value} active={tab === value} onClick={() => setTab(value)}>
            {label}
          </Chip>
        ))}
      </div>

      {tab === "matrix" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: "expense", label: t("categories.expenses") },
                { value: "income", label: t("categories.income") },
              ]}
            />
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "month", label: t("reports.byMonth") },
                { value: "year", label: t("reports.byYear") },
              ]}
            />
            {period === "month" && (
              <Segmented
                value={monthRange}
                onChange={setMonthRange}
                options={[
                  { value: "12", label: t("reports.range12") },
                  { value: "24", label: t("reports.range24") },
                  { value: "all", label: t("reports.rangeAll") },
                ]}
              />
            )}
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(matrixToTsv(matrix, t("reports.total"), baseCurrency))
                  .then(() => setCopied(true));
              }}
            >
              {copied ? t("reports.copied") : t("reports.copyTable")}
            </Button>
          </div>

          {/* Wide content scrolls inside its own container; the page itself must never
              scroll horizontally. The box scrolls both ways and is capped below the viewport
              height: a sticky header only sticks inside its scroll container, and one that only
              scrolled sideways let the header leave with the page. The category column, the
              header and the totals row under it all stay pinned. */}
          <div className={cn(LIST, "max-h-[70dvh] overflow-auto")}>
            <table className="matrix">
              <thead>
                <tr>
                  <th className="matrix__corner">{t("entry.category")}</th>
                  {showBudgetColumn && (
                    <th className="matrix__period">{t("reports.budget")}</th>
                  )}
                  {matrixPeriods.map((bucket) => (
                    <th key={bucket} className="matrix__period">
                      {period === "month" ? formatMonthShort(bucket, locale) : bucket}
                    </th>
                  ))}
                  <th className="matrix__period matrix__period--total">{t("reports.total")}</th>
                </tr>
                {/* Totals lead rather than trail: the column sum is the figure read first, and at the
                    bottom of thirty categories it was the one that needed scrolling to. */}
                <tr className="matrix__totals">
                  <th scope="row" className="matrix__category">
                    {kind === "expense" ? t("reports.totalExpenses") : t("reports.totalIncome")}
                  </th>
                  {showBudgetColumn && <td className="matrix__cell" />}
                  {matrixPeriods.map((bucket) => (
                    <td key={bucket} className="matrix__cell matrix__cell--total">
                      {formatAmount(matrix.totalsByPeriod.get(bucket) ?? 0, baseCurrency, locale)}
                    </td>
                  ))}
                  <td className="matrix__cell matrix__cell--total">
                    {formatAmount(matrix.grandTotal, baseCurrency, locale)}
                  </td>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.category.id}>
                    <th scope="row" className="matrix__category">
                      <span className="flex flex-wrap items-center gap-2">
                        <IconChip icon={row.category.icon} color={row.category.color} small />
                        {row.category.name}
                      </span>
                    </th>
                    {showBudgetColumn && (
                      <td className="matrix__cell matrix__budget sensitive">
                        {budgetOf(row.category.id, monthOf(todayIso()))?.label ?? ""}
                      </td>
                    )}
                    {matrixPeriods.map((bucket) => {
                      const value = row.byPeriod.get(bucket) ?? 0;
                      const limit =
                        period === "month" && kind === "expense"
                          ? budgetOf(row.category.id, bucket)
                          : null;
                      return (
                        <td key={bucket} className="matrix__cell">
                          {value === 0 ? (
                            <span className="matrix__empty muted">—</span>
                          ) : (
                            <button
                              type="button"
                              className={cn(
                                "matrix__value",
                                limit && value > limit.inBase && "matrix__value--over",
                              )}
                              onClick={() =>
                                drill(
                                  t("reports.drillDown", {
                                    category: row.category.name,
                                    period:
                                      period === "month" ? formatMonth(bucket, locale) : bucket,
                                  }),
                                  (tx) =>
                                    tx.category_id === row.category.id &&
                                    periodOf(tx.occurred_on, period) === bucket,
                                )
                              }
                            >
                              {formatAmount(value, baseCurrency, locale)}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="matrix__cell matrix__cell--total">
                      {formatAmount(row.total, baseCurrency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "month" && (
        <>
          {/* Which side is being read. The two are different questions — the spending report and
              the earning one — and they used to share one list, with every share taken against
              expenses so a salary read as "226% of expenses". */}
          <div className="mb-3">
            <Segmented
              value={monthKind}
              onChange={(value) => setMonthKind(value as "expense" | "income")}
              options={[
                { value: "expense", label: t("kind.expense") },
                { value: "income", label: t("kind.income") },
              ]}
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setMonth(addMonths(month, -1))}>
              ‹
            </Button>
            <strong>{formatMonth(month, locale)}</strong>
            <Button
              size="sm"
              disabled={month >= monthOf(todayIso())}
              onClick={() => setMonth(addMonths(month, 1))}
            >
              ›
            </Button>
          </div>

          <div className={cn(CARD, "mb-3")}>
            <DonutChart
              slices={monthRows.map((row) => ({
                id: row.category.id,
                label: row.category.name,
                color: row.category.color ?? "var(--muted-foreground)",
                value: row.total,
              }))}
              total={monthKind === "income" ? overview.income : overview.expenses}
              currency={baseCurrency}
              label={monthKind === "income" ? t("reports.totalIncome") : t("reports.totalExpenses")}
              caption={formatMonth(month, locale)}
            />

            {/* The strip doubles as the way between months: nine of them ending at the one being
                read, which is as many as fit under a thumb. The arrows above still step one at a
                time, and the window follows them. */}
            <div className="mt-4">
              <PeriodStrip
                bars={monthBars}
                selected={month}
                onSelect={setMonth}
                tone={monthKind}
              />
            </div>
          </div>

          <div className={cn(CARD, "mb-3")}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t("reports.totalIncome")}</span>
              <Amount minor={overview.income} currency={baseCurrency} tone="income" />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t("reports.totalExpenses")}</span>
              <Amount minor={overview.expenses} currency={baseCurrency} tone="expense" />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t("reports.profit")}</span>
              {/* Only the net carries the second currency here. Three of them in a stack of three
                  rows is a column of conversions nobody reads; the line worth repeating is the one
                  that says whether the month came out ahead. */}
              <span className="text-right">
                <Amount
                  minor={overview.net}
                  currency={baseCurrency}
                  tone={overview.net < 0 ? "expense" : "income"}
                  signed
                />
                <SecondaryAmount minor={overview.net} />
              </span>
            </div>
          </div>

          <div className={LIST}>
            {monthRows.map((row) => (
              <button
                key={row.category.id}
                type="button"
                className={cn(ROW, "hover:bg-accent active:bg-accent")}
                onClick={() =>
                  drill(
                    t("reports.drillDown", {
                      category: row.category.name,
                      period: formatMonth(month, locale),
                    }),
                    (tx) => tx.category_id === row.category.id && monthOf(tx.occurred_on) === month,
                  )
                }
              >
                <IconChip icon={row.category.icon} color={row.category.color} />
                <span className="min-w-0 flex-1">
                  <span className={ROW_TITLE}>{row.category.name}</span>
                  {/* The word "change" went with the sparkline's arrival: a signed percentage
                      beside a line that shows the direction does not also need naming, and the
                      three of them together pushed the row into truncating. */}
                  <span className={ROW_SUB}>
                    {Math.round(row.share * 100)}% {t("reports.share")}
                    {row.changeRatio !== null &&
                      ` · ${row.changeRatio > 0 ? "+" : ""}${Math.round(row.changeRatio * 100)}%`}
                  </span>
                </span>
                {/* Six months of shape beside the one month of figure. "+18%" is one comparison
                    against one month; the line says whether it is a spike or a climb. */}
                <Sparkline
                  values={trends.get(row.category.id) ?? []}
                  color={row.category.color ?? "var(--muted-foreground)"}
                  label={t("reports.trend")}
                />
                {(() => {
                  const limit = monthKind === "expense" ? budgetOf(row.category.id, month) : null;
                  if (!limit) return <Amount minor={row.total} currency={baseCurrency} tone="neutral" />;
                  // The budget under the figure, and the figure red once past it. Nothing more:
                  // no bar and no pace — the number against the number is the whole question.
                  return (
                    <span className="shrink-0 text-right">
                      <Amount
                        minor={row.total}
                        currency={baseCurrency}
                        tone={row.total > limit.inBase ? "expense" : "neutral"}
                      />
                      <span className="sensitive block text-xs text-muted-foreground">
                        {t("reports.ofBudget", { amount: limit.label })}
                      </span>
                    </span>
                  );
                })()}
              </button>
            ))}
          </div>
        </>
      )}

      {tab === "netWorth" && (
        <NetWorthReport
          transactions={transactions}
          accounts={accounts}
          from={range.from}
          to={range.to}
        />
      )}

      {tab === "cashflow" && (
        <>
          {/* The chart answers "are we spending more than we earn, and is it getting worse"; the
              rows below answer "on which card". Different questions, one tab. */}
          <div className="mb-3">
            <CashflowChart
              points={cashflowOverTime(transactions, periodRange(range.from, range.to, period), period)}
              currency={baseCurrency}
            />
          </div>

          <div className={LIST}>
          {cashflowByAccount(transactions, accounts, range.from, range.to).map((row) => (
            <div key={row.account.id} className={cn(ROW, "hover:bg-accent active:bg-accent")}>
              <IconChip icon={row.account.icon} color={row.account.color} />
              <span className="min-w-0 flex-1">
                <span className={ROW_TITLE}>{row.account.name}</span>
                {/* The account's own currency, not the base one. These figures are that card's
                    movements, summed natively — printing a euro card's €500 with a ₴ beside it
                    was two different units on one line. */}
                <span className={cn(ROW_SUB, "sensitive")}>
                  +{formatAmount(row.inflow, row.account.currency as Currency, locale)} · −
                  {formatAmount(row.outflow, row.account.currency as Currency, locale)}
                </span>
              </span>
              <Amount
                minor={row.net}
                currency={row.account.currency as Currency}
                tone={row.net < 0 ? "expense" : "income"}
                signed
              />
            </div>
          ))}
          </div>
        </>
      )}

      {tab === "byMember" && (
        <div className={LIST}>
          {spendByMember(transactions, members, range.from, range.to).map((row) => (
            <button
              key={row.member.id}
              type="button"
              className={cn(ROW, "hover:bg-accent active:bg-accent")}
              onClick={() =>
                drill(
                  row.member.display_name,
                  (tx) =>
                    authorOf(tx) === row.member.id &&
                    countsForMemberReport(tx, range.from, range.to),
                )
              }
            >
              <IconChip icon="👤" color={row.member.avatar_color} />
              <span className="min-w-0 flex-1">
                <span className={ROW_TITLE}>{row.member.display_name}</span>
                <span className={ROW_SUB}>{t("history.count", { count: row.count })}</span>
              </span>
              <Amount minor={row.expenses} currency={baseCurrency} tone="expense" />
            </button>
          ))}
        </div>
      )}

      {drillDown && (
        <Sheet title={drillDown.title} onClose={() => setDrillDown(null)}>
          <div className={LIST}>
            {transactions.filter(drillDown.filter).map((tx) => (
              <TransactionRow
                key={tx.id}
                transaction={tx}
                lookups={lookups}
                showDate
                onClick={() => setEditing(tx)}
              />
            ))}
          </div>
        </Sheet>
      )}

      {/* Opened over the list, which stays underneath: after saving, the list shows the change and
          the next transaction is one tap away. */}
      {editing && (
        <EntrySheet
          editing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(spec) => {
            setEditing(undefined);
            if (spec) setToast(spec);
          }}
        />
      )}

      {toast && <Toast spec={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function NetWorthReport({
  transactions,
  accounts,
  from,
  to,
}: {
  transactions: Transaction[];
  accounts: ReturnType<typeof useAccounts>;
  from: string;
  to: string;
}) {
  const { t, locale, baseCurrency } = useApp();
  /* Today's rates, the same ones the home screen totals with — a balance is a current position and
     has no per-transaction rate to fall back on. See netWorthOverTime. */
  const rates = useLatestRates(baseCurrency);
  const periods = periodRange(from, to, "month");
  const points = netWorthOverTime(transactions, accounts, periods, "month", baseCurrency, rates);
  const latest = points[points.length - 1];
  const missing = latest?.missing ?? [];

  return (
    <>
      <TrendChart
        points={points.map((point) => ({ period: point.period, total: point.total }))}
        currency={baseCurrency}
        title={t("reports.netWorth")}
      />

      {/* Named, not hidden. A total that quietly leaves out the euro accounts is the bug this
          release fixes; a total that says which currency it could not price is not the same thing. */}
      {missing.length > 0 && (
        <div className={cn(CARD, "mt-3 border-warning")} role="status">
          <div className="text-xs">{t("reports.noRate", { currencies: missing.join(", ") })}</div>
        </div>
      )}

      {latest && latest.byCurrency.size > 1 && (
        <div className={cn(LIST, "mt-4")}>
          {[...latest.byCurrency.entries()].map(([currency, amount]) => (
            <div key={currency} className={cn(ROW, "hover:bg-accent active:bg-accent")}>
              <span className="min-w-0 flex-1">
                <span className={ROW_TITLE}>{currency}</span>
              </span>
              <span className="sensitive tabular-nums">
                {formatAmount(amount, currency as never, locale, true)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
