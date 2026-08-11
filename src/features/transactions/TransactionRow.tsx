import { useMemo } from "react";
import type { Currency } from "@shared/currency";
import type { Account, Category, Member, Transaction } from "@shared/schema";
import { useApp } from "~/app/AppContext";
import { createPressGesture } from "~/lib/press-gesture";
import { cn } from "~/lib/cn";
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
}: {
  transaction: Transaction;
  lookups: Lookups;
  onClick?: (() => void) | undefined;
  /** Long press enters bulk-selection mode with this row selected. */
  onLongPress?: (() => void) | undefined;
  selected?: boolean | undefined;
}) {
  const { t } = useApp();

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

  const subtitle =
    tx.kind === "transfer"
      ? `${account?.name ?? "?"} → ${toAccount?.name ?? "?"}`
      : [account?.name, tx.note].filter(Boolean).join(" · ");

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
            // iOS Safari does not fire contextmenu for touch, so the long press has to
            // suppress the text-selection callout itself.
            style: {
              WebkitTouchCallout: "none" as const,
              userSelect: "none" as const,
            },
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

      <span className="shrink-0 text-right">
        <Amount
          minor={tx.amount_minor}
          currency={tx.currency as Currency}
          tone={tx.kind}
          cents={tx.amount_minor % 100 !== 0}
          signed={tx.kind === "income"}
        />
        {member && <Avatar name={member.display_name} color={member.avatar_color} />}
      </span>
    </Element>
  );
}
