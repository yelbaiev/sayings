import type { Account, Budget, Category, Transaction } from "@shared/schema";
import { useMemo } from "react";
import { useApp } from "~/app/AppContext";
import type { EntryPrefill } from "~/features/entry/EntrySheet";
import { formatMoney, formatMonth } from "~/lib/format";
import { savingsAccountFor, savingsSuggestion } from "~/lib/savings";
import { Amount } from "~/ui";
import { Button } from "~/ui/Button";
import { CARD, SECTION_TITLE } from "~/ui/recipes";

/** How many overspent categories are named before the rest become "and N more". */
const NAMED_OVER = 2;

/**
 * What the month left over, and a one-tap way to put it in savings.
 *
 * The button opens the entry sheet as a transfer with the suggested amount filled in, never saves
 * straight away: the suggestion is arithmetic, and only the person knows what is already promised
 * elsewhere. See src/lib/savings.ts for why the under-limit figure is part of the leftover rather
 * than added to it.
 */
export function SavingsCard({
  transactions,
  accounts,
  budgets,
  categories,
  today,
  onMove,
}: {
  transactions: Transaction[];
  accounts: Account[];
  budgets: Budget[];
  categories: Category[];
  today: string;
  onMove: (prefill: EntryPrefill) => void;
}) {
  const { t, locale, baseCurrency } = useApp();

  const s = useMemo(
    () => savingsSuggestion(transactions, accounts, budgets, categories, today),
    [transactions, accounts, budgets, categories, today],
  );
  const target = savingsAccountFor(accounts, baseCurrency);

  // A month with no income has nothing to suggest saving from, and a card of zeros is noise.
  if (s.income === 0) return null;

  const money = (minor: number) => formatMoney(minor, baseCurrency, locale);
  const monthName = formatMonth(s.month, locale);

  const overNames = s.over
    .slice(0, NAMED_OVER)
    .map((o) => o.category.name)
    .join(", ");
  const overMore = s.over.length - NAMED_OVER;
  const overTotal = s.over.reduce((sum, o) => sum - o.remaining, 0);

  return (
    <section className="mb-6">
      <h2 className={SECTION_TITLE}>
        {s.inProgress ? t("savings.titleSoFar") : t("savings.titleMonth", { month: monthName })}
      </h2>

      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm">
            {s.inProgress ? t("savings.leftoverSoFar") : t("savings.leftover")}
          </span>
          <Amount
            minor={s.leftover}
            currency={baseCurrency}
            tone={s.leftover < 0 ? "expense" : "income"}
          />
        </div>
        <div className="sensitive mt-1 text-xs text-muted-foreground">
          {t("savings.formula", { income: money(s.income), expenses: money(s.expenses) })}
        </div>

        {/* Under-limit praise only for a closed month: mid-month, money left under a limit is
            budget still to be spent, not savings. */}
        {!s.inProgress && s.underCount > 0 && s.leftover > 0 && (
          <p className="sensitive mt-3 text-sm">
            {s.underLimits <= s.leftover
              ? t("savings.underPart", { amount: money(s.underLimits), count: s.underCount })
              : t("savings.underWhole", { amount: money(s.underLimits), count: s.underCount })}
          </p>
        )}

        {s.over.length > 0 && (
          <p className="sensitive mt-3 text-sm text-destructive">
            {t("savings.over", {
              names: overMore > 0 ? t("savings.overMore", { names: overNames, count: overMore }) : overNames,
              amount: money(overTotal),
            })}
            {/* Only once the month is closed: mid-month the rest has not "made up" for anything yet. */}
            {!s.inProgress && s.leftover > 0 && (
              <span className="text-muted-foreground"> {t("savings.overCovered")}</span>
            )}
          </p>
        )}

        {s.leftover <= 0 ? (
          <p className="sensitive mt-3 text-sm text-muted-foreground">
            {t("savings.overspent", { amount: money(-s.leftover) })}
          </p>
        ) : (
          <>
            {s.alreadySaved > 0 && (
              <div className="mt-3 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span>{t("savings.already")}</span>
                <Amount minor={s.alreadySaved} currency={baseCurrency} tone="muted" />
              </div>
            )}

            {s.suggested > 0 ? (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="sensitive text-sm">
                  {t("savings.suggest", { amount: money(s.suggested) })}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    onMove({
                      kind: "transfer",
                      amountMinor: s.suggested,
                      toAccountId: target?.id ?? null,
                      note: t("savings.note", { month: monthName }),
                    })
                  }
                >
                  {t("savings.move")}
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-sm">{t("savings.allSaved")}</p>
            )}

            {s.suggested > 0 && !target && (
              <p className="mt-2 text-xs text-muted-foreground">{t("savings.noAccount")}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
