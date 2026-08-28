import type { Transaction } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { useAccounts, useCategories, useLookups, useMembers, useTransactions } from "~/db/queries";
import { TransactionRow } from "~/features/transactions/TransactionRow";
import { CashflowChart, TrendChart } from "./charts";
import {
  cashflowByAccount,
  cashflowOverTime,
  categoryMatrix,
  matrixToTsv,
  monthOverview,
  netWorthOverTime,
  periodOf,
  periodRange,
  spendByMember,
  type Period,
} from "~/lib/report-engine";
import { addMonths, formatAmount, formatMonth, formatMonthShort, monthOf, todayIso } from "~/lib/format";
import { cn } from "~/lib/cn";
import { Button } from "~/ui/Button";
import { CARD, LIST, PAGE_TITLE, ROW, ROW_SUB, ROW_TITLE } from "~/ui/recipes";
import { Amount, Chip, EmptyState, IconChip, Segmented, Sheet } from "~/ui";

type ReportTab = "matrix" | "month" | "netWorth" | "cashflow" | "byMember";

export function ReportsPage() {
  const { t, locale, baseCurrency } = useApp();
  const transactions = useTransactions();
  const categories = useCategories(undefined, true);
  const accounts = useAccounts(true);
  const members = useMembers();
  const lookups = useLookups();

  const [tab, setTab] = useState<ReportTab>("matrix");
  const [period, setPeriod] = useState<Period>("month");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [month, setMonth] = useState(() => monthOf(todayIso()));
  /**
   * The matrix used to render every month from the first transaction to today — 33 columns once
   * the Saldo history landed, which is a lot of sideways scrolling to reach the current month.
   * A year is the span actually read; the control is there for when it is not.
   */
  // Kept as a string because Segmented is a string-valued control; "all" means no limit.
  const [monthRange, setMonthRange] = useState<"12" | "24" | "all">("12");
  const [drillDown, setDrillDown] = useState<{ title: string; rows: Transaction[] } | null>(null);
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

  const overview = useMemo(
    () => monthOverview(transactions, categories, month),
    [transactions, categories, month],
  );

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
    setDrillDown({ title, rows: transactions.filter(filter) });
  }

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
              scroll horizontally. The category column stays pinned. */}
          <div className={cn(LIST, "overflow-x-auto")}>
            <table className="matrix">
              <thead>
                <tr>
                  <th className="matrix__corner">{t("entry.category")}</th>
                  {matrix.periods.map((bucket) => (
                    <th key={bucket} className="matrix__period">
                      {period === "month" ? formatMonthShort(bucket, locale) : bucket}
                    </th>
                  ))}
                  <th className="matrix__period matrix__period--total">{t("reports.total")}</th>
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
                    {matrix.periods.map((bucket) => {
                      const value = row.byPeriod.get(bucket) ?? 0;
                      return (
                        <td key={bucket} className="matrix__cell">
                          {value === 0 ? (
                            <span className="matrix__empty muted">—</span>
                          ) : (
                            <button
                              type="button"
                              className="matrix__value"
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

                <tr className="matrix__footer">
                  <th scope="row" className="matrix__category">
                    {kind === "expense" ? t("reports.totalExpenses") : t("reports.totalIncome")}
                  </th>
                  {matrix.periods.map((bucket) => (
                    <td key={bucket} className="matrix__cell matrix__cell--total">
                      {formatAmount(matrix.totalsByPeriod.get(bucket) ?? 0, baseCurrency, locale)}
                    </td>
                  ))}
                  <td className="matrix__cell matrix__cell--total">
                    {formatAmount(matrix.grandTotal, baseCurrency, locale)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "month" && (
        <>
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

          <div className={cn(CARD, "mb-4")}>
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
              <Amount
                minor={overview.net}
                currency={baseCurrency}
                tone={overview.net < 0 ? "expense" : "income"}
                signed
              />
            </div>
          </div>

          <div className={LIST}>
            {overview.byCategory.map((row) => (
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
                  <span className={ROW_SUB}>
                    {Math.round(row.share * 100)}% {t("reports.share")}
                    {row.changeRatio !== null &&
                      ` · ${row.changeRatio > 0 ? "+" : ""}${Math.round(row.changeRatio * 100)}% ${t("reports.change")}`}
                  </span>
                </span>
                <Amount minor={row.total} currency={baseCurrency} tone="neutral" />
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
                <span className={cn(ROW_SUB, "sensitive")}>
                  +{formatAmount(row.inflow, baseCurrency, locale)} · −
                  {formatAmount(row.outflow, baseCurrency, locale)}
                </span>
              </span>
              <Amount
                minor={row.net}
                currency={row.account.currency as never}
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
                drill(row.member.display_name, (tx) => tx.updated_by === row.member.id)
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
            {drillDown.rows.map((tx) => (
              <TransactionRow key={tx.id} transaction={tx} lookups={lookups} />
            ))}
          </div>
        </Sheet>
      )}
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
  const periods = periodRange(from, to, "month");
  const points = netWorthOverTime(transactions, accounts, periods, "month", baseCurrency);
  const latest = points[points.length - 1];

  return (
    <>
      <TrendChart
        points={points.map((point) => ({ period: point.period, total: point.total }))}
        currency={baseCurrency}
        title={t("reports.netWorth")}
      />

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
