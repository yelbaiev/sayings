import type { Budget, Category, Transaction } from "@shared/schema";
import { useMemo } from "react";
import { useApp } from "~/app/AppContext";
import { Link } from "~/app/router";
import { budgetStatuses } from "~/lib/budget-engine";
import { formatMoney, monthOf } from "~/lib/format";
import { cn } from "~/lib/cn";
import { Amount, IconChip, Progress } from "~/ui";
import { CARD, SECTION_TITLE } from "~/ui/recipes";

/** At or past this share of a limit, a budget is worth a line on Home. */
const NEAR = 0.8;
const MAX_ROWS = 4;

/**
 * This month's budgets, from Home — only the ones that need a look.
 *
 * Budgets lived three taps deep in Settings, so the one moment they matter — glancing at the phone
 * before spending — they were invisible. Home shows the limits that are close, over, or on pace to
 * go over; the rest collapse into one "on track" line. Nothing at all when no budget is set: an
 * empty section would be an advert, not information.
 */
export function BudgetGlance({
  budgets,
  categories,
  transactions,
  today,
}: {
  budgets: Budget[];
  categories: Category[];
  transactions: Transaction[];
  today: string;
}) {
  const { t, locale, baseCurrency } = useApp();

  const statuses = useMemo(
    () => budgetStatuses(budgets, categories, transactions, monthOf(today), today),
    [budgets, categories, transactions, today],
  );

  if (statuses.length === 0) return null;

  // Already sorted worst-first by the engine.
  const flagged = statuses.filter(
    (s) => s.ratio >= NEAR || (s.projected !== null && s.projected > s.effectiveLimit),
  );

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={SECTION_TITLE}>{t("budgets.title")}</h2>
        <Link to="/budgets" className="text-xs underline-offset-2 hover:underline">
          {t("home.budgetsAll")}
        </Link>
      </div>

      <div className={cn(CARD, "flex flex-col gap-3")}>
        {flagged.slice(0, MAX_ROWS).map((status) => (
          <div key={status.budget.id}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <IconChip icon={status.category.icon} color={status.category.color} small />
                <span className="truncate text-sm font-medium">{status.category.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                <Amount minor={status.spent} currency={baseCurrency} tone="neutral" /> /{" "}
                <Amount minor={status.effectiveLimit} currency={baseCurrency} tone="muted" />
              </span>
            </div>
            <div className="mt-1.5">
              <Progress ratio={status.ratio} />
            </div>
            <div
              className={cn(
                "sensitive mt-1 text-xs",
                status.remaining < 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {status.remaining < 0
                ? t("budgets.over", {
                    amount: formatMoney(-status.remaining, baseCurrency, locale),
                  })
                : status.projected !== null && status.projected > status.effectiveLimit
                  ? t("budgets.projected", {
                      amount: formatMoney(status.projected, baseCurrency, locale),
                    })
                  : t("budgets.remaining", {
                      amount: formatMoney(status.remaining, baseCurrency, locale),
                    })}
            </div>
          </div>
        ))}

        {flagged.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("home.budgetsOnTrack", { count: statuses.length })}
          </div>
        ) : (
          statuses.length > Math.min(flagged.length, MAX_ROWS) && (
            <div className="text-xs text-muted-foreground">
              {t("home.budgetsMore", {
                count: statuses.length - Math.min(flagged.length, MAX_ROWS),
              })}
            </div>
          )
        )}
      </div>
    </section>
  );
}
