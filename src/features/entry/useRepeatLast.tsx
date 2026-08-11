import { useCallback } from "react";
import { useApp } from "~/app/AppContext";
import { newId, put } from "~/db/mutations";
import { useLatestTransaction } from "~/db/queries";
import { todayIso } from "~/lib/format";

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
  const { me } = useApp();
  const last = useLatestTransaction();

  return useCallback(async () => {
    if (!last) return;

    const id = newId();
    // Dated today rather than copying the original's date, and stripped of anything that
    // identified the specific original — a repeat is a new event, not a duplicate record.
    const row = {
      ...last,
      id,
      occurred_on: todayIso(),
      receipt_key: null,
      import_hash: null,
      split_parent_id: null,
    };

    // No toast. The new row surfacing in the list below is the confirmation, and the bubble it
    // replaced sat over the tab bar blocking the very next tap until it deigned to leave.
    await put("transactions", row as never, me);
  }, [last, me]);
}
