import { useCallback } from "react";
import { useApp } from "~/app/AppContext";
import { newId, put } from "~/db/mutations";
import { useLatestTransaction } from "~/db/queries";
import type { Currency } from "@shared/currency";
import { todayIso } from "~/lib/format";
import { pricingFor } from "~/lib/fx";
import { haptic } from "~/lib/haptics";

/**
 * Repeat-last, bound to a long press on the add button.
 *
 * Roughly a third of a household's transactions are the same thing again — the same coffee,
 * the same metro fare, the same weekly shop. For those, opening the sheet at all is wasted
 * motion.
 */

export function useLastTransaction() {
  return useLatestTransaction();
}

export function useRepeatLast(): () => Promise<void> {
  const { me, baseCurrency } = useApp();
  const last = useLatestTransaction();

  return useCallback(async () => {
    if (!last) return;

    const id = newId();
    const today = todayIso();
    // Dated today rather than copying the original's date, and stripped of anything that
    // identified the specific original — a repeat is a new event, not a duplicate record.
    const row = {
      ...last,
      id,
      occurred_on: today,
      receipt_key: null,
      import_hash: null,
      split_parent_id: null,
      // Yours, and at today's rate: a repeat is your new entry, not a copy of the other person's.
      created_by: me.id,
      ...(await pricingFor(last.amount_minor, last.currency as Currency, today, baseCurrency)),
    };

    // No toast. The new row surfacing in the list below is the confirmation, and the bubble it
    // replaced sat over the tab bar blocking the very next tap until it deigned to leave.
    await put("transactions", row as never, me);
    haptic("confirm");
  }, [last, me, baseCurrency]);
}
