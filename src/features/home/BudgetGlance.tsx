import type { Budget, Category, Transaction } from "@shared/schema";
import { useMemo } from "react";
import { useApp } from "~/app/AppContext";
import { Link } from "~/app/router";
import { useBudgetFigures } from "~/features/budgets/useBudgetFigures";
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
  const { t, locale } = useApp();

  const { figures, toBase } = useBudgetFigures();
  const statuses = useMemo(
    () => budgetStatuses(budgets, categories, transactions, monthOf(today), today, toBase),
    [budgets, categories, transactions, today, toBase],
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
        {flagged.slice(0, MAX_ROWS).map((status) => {
          const f = figures(status);
          return (
            <div key={status.budget.id}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <IconChip icon={status.category.icon} color={status.category.color} small />
                  <span className="truncate text-sm font-medium">{status.category.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <Amount minor={f.spent} currency={f.currency} tone="neutral" /> /{" "}
                  <Amount minor={f.limit} currency={f.currency} tone="muted" />
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
                      amount: formatMoney(-f.remaining, f.currency, locale),
                    })
                  : f.projected !== null &&
                      status.projected !== null &&
                      status.projected > status.effectiveLimit
                    ? t("budgets.projected", {
                        amount: formatMoney(f.projected, f.currency, locale),
                      })
                    : t("budgets.remaining", {
                        amount: formatMoney(f.remaining, f.currency, locale),
                      })}
              </div>
            </div>
          );
        })}

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
