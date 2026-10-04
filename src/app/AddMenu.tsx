import type { Currency } from "@shared/currency";
import type { TxKind } from "@shared/money";
import type { Transaction } from "@shared/schema";
import { Popover } from "radix-ui";
import type { ReactNode } from "react";
import { useApp } from "~/app/AppContext";
import { useCategories } from "~/db/queries";
import { cn } from "~/lib/cn";
import { formatMoney } from "~/lib/format";
import { RefreshIcon, TransferIcon } from "~/ui/icons";

/**
 * The + button's quick actions, opened by holding it.
 *
 * Asked for because iPhone shows no long-press menu on a home-screen web app's icon (the manifest
 * shortcuts only appear on Android and desktop), so the menu lives on the app's own + instead.
 * Tapping + still opens a new entry; holding used to repeat the last transaction outright, and that
 * moved in here as the first item (decided 2026-10-04) — one more tap, in exchange for being
 * visible and naming what it will repeat. The Home screen's repeat tile is unchanged.
 */
export function AddMenu({
  open,
  onOpenChange,
  lastTransaction,
  onPick,
  onRepeat,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastTransaction: Transaction | null | undefined;
  onPick: (kind: TxKind) => void;
  onRepeat: () => void;
  /** The + button, which the menu is anchored to. */
  children: ReactNode;
}) {
  const { t, locale } = useApp();
  const categories = useCategories(undefined, true);
  const lastCategory = lastTransaction?.category_id
    ? categories.find((c) => c.id === lastTransaction.category_id)
    : undefined;
  const lastName =
    lastTransaction?.kind === "transfer" ? t("kind.transfer") : (lastCategory?.name ?? null);

  const choose = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={12}
          collisionPadding={12}
          role="menu"
          aria-label={t("nav.add")}
          className={cn(
            "z-50 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          {lastTransaction && (
            <>
              <MenuItem onSelect={choose(onRepeat)} icon={<RefreshIcon size={18} />}>
                <span className="min-w-0 flex-1 truncate">
                  {t("entry.repeatLast")}
                  {lastName && <span className="text-muted-foreground"> · {lastName}</span>}
                </span>
                <span className="sensitive shrink-0 tabular-nums text-muted-foreground">
                  {formatMoney(lastTransaction.amount_minor, lastTransaction.currency as Currency, locale)}
                </span>
              </MenuItem>
              <div className="my-1 h-px bg-border" role="separator" />
            </>
          )}
          <MenuItem onSelect={choose(() => onPick("expense"))} icon={<Sign tone="expense">−</Sign>}>
            {t("kind.expense")}
          </MenuItem>
          <MenuItem onSelect={choose(() => onPick("income"))} icon={<Sign tone="income">+</Sign>}>
            {t("kind.income")}
          </MenuItem>
          <MenuItem
            onSelect={choose(() => onPick("transfer"))}
            icon={
              <span className="text-transfer">
                <TransferIcon size={18} />
              </span>
            }
          >
            {t("kind.transfer")}
          </MenuItem>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MenuItem({
  onSelect,
  icon,
  children,
}: {
  onSelect: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] hover:bg-accent active:bg-accent"
    >
      <span className="grid w-5 shrink-0 place-items-center" aria-hidden>
        {icon}
      </span>
      {children}
    </button>
  );
}

function Sign({ tone, children }: { tone: "expense" | "income"; children: ReactNode }) {
  return (
    <span className={cn("text-lg font-semibold leading-none", tone === "expense" ? "text-expense" : "text-income")}>
      {children}
    </span>
  );
}
