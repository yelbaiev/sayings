import { useMemo } from "react";
import type { Currency } from "@shared/currency";
import type { Account, Category, Member, Transaction } from "@shared/schema";
import { useApp } from "~/app/AppContext";
import { createPressGesture } from "~/lib/press-gesture";
import { cn } from "~/lib/cn";
import { formatDateShort, formatMoney } from "~/lib/format";
import { ROW, ROW_SUB, ROW_TITLE } from "~/ui/recipes";
import { Amount, Avatar, IconChip } from "~/ui";
import { TransferIcon } from "~/ui/icons";

export interface Lookups {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  members: Map<string, Member>;
}

/**
 * One transaction, as it appears in every list.
 *
 * The author's initial is shown on every row. It looks like a small thing, but with two
 * people on one ledger it is what answers "did you already log the groceries?" without
 * asking — and stops the pair of you double-entering the weekly shop.
 */
export function TransactionRow({
  transaction: tx,
  lookups,
  onClick,
  onLongPress,
  selected,
  runningMinor,
  runningCurrency,
  showDate,
}: {
  transaction: Transaction;
  lookups: Lookups;
  onClick?: (() => void) | undefined;
  /** Long press enters bulk-selection mode with this row selected. */
  onLongPress?: (() => void) | undefined;
  selected?: boolean | undefined;
  /**
   * What the filtered account held immediately after this transaction, when the history is showing
   * one account and nothing else is narrowing the list. Undefined everywhere else — see
   * HistoryPage, which explains why it is not always shown.
   */
  runningMinor?: number | undefined;
  /** The filtered account's currency, which the balance is in. Not the row's: a transfer arriving
   *  from a hryvnia card into a dollar one is a ₴ row, but what the dollar card holds is in $. */
  runningCurrency?: Currency | undefined;
  /**
   * Leads the subtitle with the day. History groups rows under day headings and leaves it off;
   * every other list (Home's recent rows, a report's drill-down) has no heading to say when.
   */
  showDate?: boolean | undefined;
}) {
  const { t, locale } = useApp();

  const account = lookups.accounts.get(tx.account_id);
  const toAccount = tx.to_account_id ? lookups.accounts.get(tx.to_account_id) : undefined;
  const category = tx.category_id ? lookups.categories.get(tx.category_id) : undefined;
  // Attribution is the creator, permanently: fixing a typo in the other person's entry must not
  // repaint it as yours. updated_by is the fallback only for rows older than the column.
  const authorId = tx.created_by ?? tx.updated_by;
  const member = authorId ? lookups.members.get(authorId) : undefined;

  const title = tx.kind === "transfer" ? t("kind.transfer") : (category?.name ?? t("common.none"));
  // Chrome marker for transfers, emoji for categories — see src/ui/icons.tsx.
  const icon = tx.kind === "transfer" ? <TransferIcon /> : (category?.icon ?? "❓");
  const color = tx.kind === "transfer" ? "var(--transfer)" : category?.color;

  const detail =
    tx.kind === "transfer"
      ? `${account?.name ?? "?"} → ${toAccount?.name ?? "?"}`
      : [account?.name, tx.note].filter(Boolean).join(" · ");
  const subtitle = showDate
    ? [formatDateShort(tx.occurred_on, locale), detail].filter(Boolean).join(" · ")
    : detail;

  const Element = onClick ? "button" : "div";

  /*
   * One gesture object per row for the lifetime of the row, so a re-render mid-press cannot
   * lose the pending hold timer. Movement cancels it: the row also swipes horizontally, and a
   * swipe must not be read as a long press.
   */
  const press = useMemo(
    () => (onClick ? createPressGesture({ onTap: onClick, onLongPress }) : null),
    [onClick, onLongPress],
  );

  return (
    <Element
      className={cn(
        ROW,
        onClick && "hover:bg-accent active:bg-accent",
        // Selection reads as a fill, like everywhere else a chosen thing does.
        selected && "bg-secondary",
      )}
      {...(press
        ? {
            onPointerDown: () => press.down(),
            onPointerUp: () => press.up(),
            onPointerLeave: () => press.cancel(),
            onPointerCancel: () => press.cancel(),
            onPointerMove: () => press.cancel(),
            // The selection callout that used to fight this long press is suppressed app-wide now,
            // in the base layer — see src/styles/tailwind.css.
          }
        : { onClick })}
      {...(onClick ? { type: "button" as const } : {})}
    >
      <IconChip icon={icon} color={color} />

      <span className="min-w-0 flex-1">
        <span className={ROW_TITLE}>{title}</span>
        {/* `sensitive`: the note names the merchant and the account names the person. */}
        <span className={cn(ROW_SUB, "sensitive")}>
          {/* A photo is worth knowing about from the list — otherwise the only way to find out a
              receipt exists is to open every transaction. Text, not an icon, because the row already
              carries a category emoji and a second glyph beside it reads as decoration. */}
          {tx.receipt_key ? `📷 ${subtitle}` : subtitle}
        </span>
      </span>

      {/* A column with everything pushed to the right edge. The avatar is a block, so under
          plain text-right it sat at the column's left, out of line with the amount above it. */}
      <span className="flex shrink-0 flex-col items-end text-right">
        <Amount
          minor={tx.amount_minor}
          currency={tx.currency as Currency}
          tone={tx.kind}
          cents={tx.amount_minor % 100 !== 0}
          signed={tx.kind === "income"}
        />
        {member && <Avatar name={member.display_name} color={member.avatar_color} />}
        {/* The balance after this row, under the amount: smaller and muted, because it is context
            for the figure above rather than a second figure competing with it. */}
        {runningMinor !== undefined && (
          <span className="sensitive block text-xs tabular-nums text-muted-foreground">
            {/* Named for a screen reader, which would otherwise read two bare numbers on one row
                with nothing to say which is the amount and which is what was left. */}
            <span className="sr-only">{t("history.runningBalance")} </span>
            {formatMoney(runningMinor, runningCurrency ?? (tx.currency as Currency), locale)}
          </span>
        )}
      </span>
    </Element>
  );
}
