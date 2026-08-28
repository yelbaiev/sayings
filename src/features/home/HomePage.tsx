import { type Currency } from "@shared/currency";
import { signedMinor } from "@shared/money";
import type { Transaction } from "@shared/schema";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { Link, useRouter } from "~/app/router";
import { useBalances, useLookups, useTransactions } from "~/db/queries";
import { getDevicePrefs } from "~/db/dexie";
import { toBaseAtLatest, useLatestRates } from "~/db/useRates";
import { addMonths, dayOfMonth, formatMoney, monthOf, todayIso } from "~/lib/format";
import {
  Amount,
  EmptyState,
  IconChip,
  Progress,
  SecondaryAmount,
  Toast,
  type ToastSpec,
} from "~/ui";
import { Button } from "~/ui/Button";
import { cn } from "~/lib/cn";
import { CARD, LIST, PAGE, SECTION_TITLE } from "~/ui/recipes";
import { EntrySheet } from "~/features/entry/EntrySheet";
import { IntroSheet } from "~/features/intro/IntroSheet";
import { InstallBanner } from "./InstallBanner";
import { QuickTiles } from "./QuickTiles";
import { RecurringDuePrompt } from "~/features/recurring/RecurringPage";
import { TransactionRow } from "~/features/transactions/TransactionRow";

/**
 * Home answers three questions, in this order:
 *
 *   1. How much have we spent this month, and is that normal?
 *   2. Where is the money right now?
 *   3. What just happened?
 *
 * Deliberately not a dashboard of charts. Charts belong in Reports, where there is room to
 * read them; here they would be decoration.
 */
export function HomePage() {
  const { t, locale, baseCurrency } = useApp();
  const transactions = useTransactions();
  const balances = useBalances();
  const lookups = useLookups();
  const rates = useLatestRates(baseCurrency);
  const { navigate } = useRouter();
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const [editing, setEditing] = useState<Transaction | undefined>(undefined);
  const [showIntro, setShowIntro] = useState(false);
  /** Set by the intro's last panel, so finishing it lands in the entry sheet. */
  const [entryOpen, setEntryOpen] = useState(false);

  useEffect(() => {
    // Read once on mount. Deliberately not gated on the transaction count: someone restoring from a
    // backup onto a new phone has data but has still never seen this, and the flag is what records
    // whether they have.
    void getDevicePrefs().then((prefs) => setShowIntro(!prefs.introSeen));
  }, []);

  const today = todayIso();
  const thisMonth = monthOf(today);
  const dayOfThisMonth = dayOfMonth(today);

  const summary = useMemo(() => {
    let spent = 0;
    let earned = 0;
    let spentSameDayLastMonth = 0;
    const lastMonth = addMonths(thisMonth, -1);

    // Excluded accounts hold the imported Saldo history, whose rows all sit on the 1st of their
    // month. Counting them made the "by this day last month" comparison badly wrong — a whole
    // month of July spending looked like it had all happened by the 5th. This card is about
    // real current spending; the history belongs in Reports.
    const realAccounts = new Set(
      balances.filter((b) => b.account.exclude_from_totals === 0).map((b) => b.account.id),
    );

    for (const tx of transactions) {
      if (!realAccounts.has(tx.account_id)) continue;
      // Transfers contribute nothing — they move money between our own accounts, and
      // counting them would double the month.
      const signed = signedMinor(tx.kind, tx.base_amount_minor);
      if (signed === 0) continue;

      const month = monthOf(tx.occurred_on);
      if (month === thisMonth) {
        if (signed < 0) spent += -signed;
        else earned += signed;
      } else if (month === lastMonth && dayOfMonth(tx.occurred_on) <= dayOfThisMonth && signed < 0) {
        // Same *day* of last month, not the whole month: comparing a partial month against a
        // complete one always flatters the current one.
        spentSameDayLastMonth += -signed;
      }
    }

    return { spent, earned, spentSameDayLastMonth };
  }, [transactions, balances, thisMonth, dayOfThisMonth]);

  const visibleBalances = balances.filter((b) => b.account.archived === 0);

  // Recent activity means real accounts. The imported Saldo history lives on an excluded
  // account and would otherwise fill this list with synthetic monthly rows.
  const recent = useMemo(() => {
    const realAccounts = new Set(
      balances.filter((b) => b.account.exclude_from_totals === 0).map((b) => b.account.id),
    );
    return transactions.filter((tx) => realAccounts.has(tx.account_id)).slice(0, 10);
  }, [transactions, balances]);

  // A single UAH figure hid the euro accounts entirely. Now: a subtotal per currency, plus a
  // grand total converted at today's rate — today's, because this is a current position, unlike
  // a historical report which must use each transaction's own snapshotted rate.
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const b of visibleBalances) {
      if (b.account.exclude_from_totals !== 0) continue;
      byCurrency.set(b.account.currency, (byCurrency.get(b.account.currency) ?? 0) + b.native);
    }

    let grand = 0;
    let complete = true;
    for (const [currency, minor] of byCurrency) {
      const converted = toBaseAtLatest(minor, currency as Currency, rates, baseCurrency);
      if (converted === null) complete = false;
      else grand += converted;
    }

    return {
      byCurrency: [...byCurrency.entries()].sort((a, b) =>
        a[0] === baseCurrency ? -1 : b[0] === baseCurrency ? 1 : a[0].localeCompare(b[0]),
      ),
      grand,
      // Only shown when every currency could be converted; a partial "grand total" would lie.
      grandUsable: complete && byCurrency.size > 1,
    };
  }, [visibleBalances, rates]);

  return (
    <div className={PAGE}>
      <section className="mb-6">
        <div className={CARD}>
          <div className={SECTION_TITLE}>{t("home.spentThisMonth")}</div>
          <Amount minor={summary.spent} currency={baseCurrency} tone="expense" size="hero" />

          {summary.spentSameDayLastMonth > 0 ? (
            <div className="mt-3">
              <Progress ratio={summary.spent / summary.spentSameDayLastMonth} />
              <div className="sensitive mt-1.5 text-xs text-muted-foreground">
                {t("home.vsLastMonth", {
                  amount: formatMoney(summary.spentSameDayLastMonth, baseCurrency, locale),
                })}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">{t("home.noComparison")}</div>
          )}

          {summary.earned > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t("home.earnedThisMonth")}</span>
              <Amount minor={summary.earned} currency={baseCurrency} tone="income" />
            </div>
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className={SECTION_TITLE}>{t("home.accounts")}</h2>

        {visibleBalances.length === 0 ? (
          <EmptyState
            icon="💳"
            message={t("accounts.empty")}
            action={
              <Button variant="primary" onClick={() => navigate("/accounts")}>
                {t("accounts.add")}
              </Button>
            }
          />
        ) : (
          <>
            {/* Scrolls sideways on a phone, wraps into a grid on a desktop. Left as a scroller it
                cut the last account in half on a 2000px display. */}
            <div
              className={cn(
                "flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]",
                "min-[900px]:flex-wrap min-[900px]:overflow-x-visible",
              )}
            >
              {visibleBalances.map(({ account, native }) => (
                // Tappable: the obvious question about a balance is "what went through it?",
                // and the card was inert.
                <button
                  key={account.id}
                  type="button"
                  className={cn(
                    CARD,
                    "min-w-[132px] shrink-0 text-left",
                    "hover:bg-accent active:bg-accent",
                    "min-[900px]:max-w-[280px] min-[900px]:flex-[1_1_200px]",
                  )}
                  onClick={() => navigate(`/history?account=${encodeURIComponent(account.id)}`)}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <IconChip icon={account.icon} color={account.color} small />
                    {/* `sensitive`: the household names its cards after their owners. */}
                    <span className="sensitive truncate text-xs text-muted-foreground">
                      {account.name}
                    </span>
                  </div>
                  <Amount
                    minor={native}
                    currency={account.currency as Currency}
                    tone={native < 0 ? "expense" : "neutral"}
                  />
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              {totals.byCurrency.map(([currency, minor]) => (
                <div key={currency} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {t("home.totalIn", { currency })}
                  </span>
                  <Amount
                    minor={minor}
                    currency={currency as Currency}
                    tone={minor < 0 ? "expense" : "neutral"}
                  />
                </div>
              ))}

              {totals.grandUsable && (
                <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
                  <span className="text-xs">
                    <strong>{t("home.grandTotal")}</strong>
                    <span className="text-muted-foreground"> · {t("home.grandTotalHint")}</span>
                  </span>
                  <span className="text-right">
                    <Amount minor={totals.grand} currency={baseCurrency} tone="neutral" />
                    <SecondaryAmount minor={totals.grand} />
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <InstallBanner />

      <RecurringDuePrompt />

      <section className="mb-6">
        <h2 className={SECTION_TITLE}>{t("home.quickTiles")}</h2>
        <QuickTiles />
      </section>

      <section className="mb-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={SECTION_TITLE}>{t("home.recent")}</h2>
          <Link to="/history" className="text-xs underline-offset-2 hover:underline">
            {t("nav.history")}
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState icon="🧾" message={t("home.empty")} />
        ) : (
          <div className={LIST}>
            {/* Tappable here as well as in History. These are the rows you look at right after
                saving, so they are where a typo gets noticed — making them inert meant a trip
                through History to fix something already on screen. */}
            {recent.map((tx) => (
              <TransactionRow
                key={tx.id}
                transaction={tx}
                lookups={lookups}
                onClick={() => setEditing(tx)}
              />
            ))}
          </div>
        )}
      </section>

      {showIntro && (
        <IntroSheet
          onClose={() => setShowIntro(false)}
          onAddFirst={() => {
            setShowIntro(false);
            setEntryOpen(true);
          }}
        />
      )}

      {entryOpen && (
        <EntrySheet
          onClose={() => setEntryOpen(false)}
          onSaved={(spec) => {
            setEntryOpen(false);
            if (spec) setToast(spec);
          }}
        />
      )}

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
