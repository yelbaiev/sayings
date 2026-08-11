import type { Account, Category } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { IconChip, Sheet } from "~/ui";
import { cn } from "~/lib/cn";
import { ROW, ROW_SUB, ROW_TITLE } from "~/ui/recipes";

/**
 * The account and category pickers, as sheets of their own.
 *
 * This is the structural decision the entry form rests on. The pickers used to expand *inside* the
 * form, which meant the form had two heights — and the taller one did not fit above the keypad, so
 * fields ended up below the fold with nothing to say they were there. People saved transactions
 * having never seen the date or the note.
 *
 * A picker in its own sheet cannot do that. The form is then a fixed list of rows whose height does
 * not depend on what anyone has tapped, so "the keypad hides nothing" stops being something to check
 * on each screen size and becomes a property of the layout.
 *
 * It also lifts a limit that was never a design choice: the inline grid showed seven categories
 * because that is what fitted. A sheet shows all of them, with a search, and still costs one tap to
 * open and one to choose.
 */

export function CategorySheet({
  categories,
  selectedId,
  onSelect,
  onClose,
}: {
  /**
   * Already filtered to the transaction's kind, in seeded order — deliberately never re-ranked
   * by usage. Every category is on this sheet, so choosing one fast is a matter of the finger
   * knowing where it lives, and that only works if it lives in the same place tomorrow.
   */
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter((category) => category.name.toLowerCase().includes(needle));
  }, [categories, query]);

  return (
    <Sheet title={t("entry.chooseCategory")} onClose={onClose} bodyClassName="flex flex-col">
      {/*
        Search first, and always — not behind an icon. With sixty categories the list is longer than a
        screen, and a field you have to reveal is one most people never learn is there.
      */}
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("entry.searchCategories")}
        aria-label={t("entry.searchCategories")}
      />

      <div className="mt-3 grid grid-cols-4 gap-2">
        {shown.map((category) => (
          <button
            key={category.id}
            type="button"
            className={cn(
              "flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-lg border p-1.5 text-center",
              category.id === selectedId
                ? "border-primary bg-secondary"
                : "border-border bg-card hover:bg-accent active:bg-accent",
            )}
            aria-pressed={category.id === selectedId}
            onClick={() => {
              onSelect(category.id);
              onClose();
            }}
          >
            <span className="text-2xl" aria-hidden>
              {category.icon}
            </span>
            <span className="w-full truncate text-xs leading-tight">{category.name}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="mt-2 text-xs text-muted-foreground">{t("entry.noCategories")}</p>}
    </Sheet>
  );
}

export function AccountSheet({
  title,
  accounts,
  selectedId,
  baseCurrency,
  onSelect,
  onClose,
}: {
  title: string;
  accounts: Account[];
  selectedId: string | null;
  baseCurrency: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="overflow-hidden rounded-lg border border-border">
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            className={cn(ROW, "hover:bg-accent active:bg-accent")}
            aria-pressed={account.id === selectedId}
            onClick={() => {
              onSelect(account.id);
              onClose();
            }}
          >
            <IconChip icon={account.icon} color={account.color} />
            <span className="min-w-0 flex-1">
              <span className={ROW_TITLE}>{account.name}</span>
              {/* Only when it differs from what totals roll up to: on the common account the code
                  would be noise repeated down the whole list. */}
              {account.currency !== baseCurrency && (
                <span className={ROW_SUB}>{account.currency}</span>
              )}
            </span>
            {account.id === selectedId && (
              <span className="shrink-0 font-bold text-primary" aria-hidden>
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
