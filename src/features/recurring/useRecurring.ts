import { parseTemplate, type QuickTileTemplate } from "@shared/quick-tile";
import type { Recurring } from "@shared/schema";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";
import { useApp } from "~/app/AppContext";
import { db } from "~/db/dexie";
import { newId, put, remove } from "~/db/mutations";
import { rateFor } from "~/lib/fx";
import { catchUp, dueRecurring, nextOccurrence } from "~/lib/recurring";
import { todayIso } from "~/lib/format";

/**
 * Recurring schedules and the two things you can do with a due one: post it or skip it.
 *
 * Both advance the schedule, so a skipped month does not reappear tomorrow. The transaction
 * template reuses the quick-tile shape — the two are the same idea (a saved intent that becomes a
 * transaction), differing only in what triggers them.
 */
export function useRecurringList(): Recurring[] {
  return (
    useLiveQuery(async () => {
      const rows = await db.recurring.toArray();
      return rows.filter((r) => r.deleted === 0).sort((a, b) => a.next_on.localeCompare(b.next_on));
    }) ?? []
  );
}

export function useDueRecurring(): Recurring[] {
  const all = useRecurringList();
  return dueRecurring(all, todayIso());
}

export function useRecurringActions() {
  const { me, baseCurrency } = useApp();

  /** Advances the schedule past today so missed periods produce one prompt, not many. */
  const advance = useCallback(
    async (item: Recurring) => {
      const { next } = catchUp(item.next_on, item.cadence, item.day_of, todayIso());
      await put("recurring", { ...item, next_on: next } as never, me);
    },
    [me],
  );

  const post = useCallback(
    async (item: Recurring): Promise<{ transactionId: string } | null> => {
      const template = parseTemplate(item.template) as QuickTileTemplate | null;
      // A schedule whose category or account has gone is skipped rather than writing a row that
      // would fail validation on sync.
      if (!template) {
        await advance(item);
        return null;
      }

      const today = todayIso();
      const fx = await rateFor(template.currency, today, baseCurrency);
      const id = newId();

      await put(
        "transactions",
        {
          id,
          created_by: me.id,
          kind: template.kind,
          occurred_on: today,
          account_id: template.account_id,
          to_account_id: null,
          category_id: template.category_id,
          amount_minor: template.amount_minor,
          currency: template.currency,
          to_amount_minor: null,
          to_currency: null,
          base_amount_minor: Math.round(template.amount_minor * fx.rate),
          fx_rate: fx.rate,
          fx_estimated: fx.estimated ? 1 : 0,
          note: template.note ?? item.label,
          payee: null,
          tags: null,
          split_parent_id: null,
          receipt_key: null,
          import_hash: null,
        } as never,
        me,
      );

      await advance(item);
      return { transactionId: id };
    },
    [me, advance, baseCurrency],
  );

  const skip = advance;

  const undoPost = useCallback(
    async (transactionId: string, item: Recurring, previousNextOn: string) => {
      await remove("transactions", transactionId, me);
      // Roll the schedule back too, or an undone post would silently consume the period.
      await put("recurring", { ...item, next_on: previousNextOn } as never, me);
    },
    [me],
  );

  return { post, skip, undoPost, nextOccurrence };
}
