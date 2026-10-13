import type { Currency } from "@shared/currency";
import type { Minor } from "@shared/money";
import { useCallback } from "react";
import { useApp } from "~/app/AppContext";
import { fromBaseAtLatest, useLatestRates, useToBase } from "~/db/useRates";
import type { BudgetStatus } from "~/lib/budget-engine";

export interface BudgetFigures {
  /** The currency the limit was set in — what the figures below are shown in. */
  currency: Currency;
  spent: Minor;
  limit: Minor;
  /** Limit − spent, in the same currency, so the three figures always add up on screen. */
  remaining: Minor;
  projected: Minor | null;
}

/**
 * A budget's figures in the currency its limit was set in.
 *
 * The engine works in the base, because that is what spending is summed in. A €300 travel limit
 * shown as "₴9 120 / ₴13 040" would be correct and unrecognisable, so it is shown back as
 * "€210 / €300": spending converted at today's rate, the limit exactly as typed.
 */
export function useBudgetFigures(): {
  figures: (status: BudgetStatus) => BudgetFigures;
  toBase: ReturnType<typeof useToBase>;
} {
  const { baseCurrency } = useApp();
  const rates = useLatestRates(baseCurrency);
  const toBase = useToBase(baseCurrency);

  const figures = useCallback(
    (status: BudgetStatus): BudgetFigures => {
      const currency = status.budget.currency as Currency;
      if (currency === baseCurrency) {
        return {
          currency,
          spent: status.spent,
          limit: status.effectiveLimit,
          remaining: status.remaining,
          projected: status.projected,
        };
      }
      // A status only exists when the limit could be converted, so a rate is held here.
      const show = (minor: Minor) => fromBaseAtLatest(minor, currency, rates, baseCurrency) ?? minor;
      // The limit exactly as typed unless rollover changed it; converting there and back would
      // turn €300 into €299.99.
      const limit =
        status.effectiveLimit === status.baseLimit
          ? status.budget.amount_minor
          : show(status.effectiveLimit);
      const spent = show(status.spent);
      return {
        currency,
        spent,
        limit,
        remaining: limit - spent,
        projected: status.projected === null ? null : show(status.projected),
      };
    },
    [rates, baseCurrency],
  );

  return { figures, toBase };
}
