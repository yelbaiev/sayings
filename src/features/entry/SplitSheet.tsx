import type { Currency } from "@shared/currency";
import { minorToMajor, parseMajorToMinor, type Minor } from "@shared/money";
import type { Category } from "@shared/schema";
import { useMemo, useState } from "react";
import { useApp } from "~/app/AppContext";
import { formatMoney } from "~/lib/format";
import { Amount, IconChip, Sheet, chipClasses } from "~/ui";
import { Button } from "~/ui/Button";
import { cn } from "~/lib/cn";
import { CARD, HINT } from "~/ui/recipes";

export interface SplitLine {
  categoryId: string;
  amountMinor: Minor;
}

/**
 * Splits one amount across several categories — a supermarket trip that was partly groceries and
 * partly pet food.
 *
 * The total is fixed by the parent transaction and the lines must sum to it exactly. That is the
 * whole point: a split that does not reconcile is a quiet way to lose money from a report, so the
 * remainder is always on screen and saving is blocked until it reaches zero.
 *
 * The last line auto-fills with the remainder, so the common two-way split needs one amount typed
 * rather than two that have to agree.
 */
export function SplitSheet({
  totalMinor,
  currency,
  kind,
  initial,
  categories,
  onClose,
  onConfirm,
}: {
  totalMinor: Minor;
  currency: Currency;
  kind: "expense" | "income";
  initial?: SplitLine[] | undefined;
  /** Passed in so the first-line default is not computed against an unresolved query. */
  categories: Category[];
  onClose: () => void;
  onConfirm: (lines: SplitLine[]) => void;
}) {
  const { t, locale } = useApp();

  const [lines, setLines] = useState<{ categoryId: string; text: string }[]>(() =>
    initial?.length
      ? initial.map((l) => ({
          categoryId: l.categoryId,
          text: String(minorToMajor(l.amountMinor, currency)),
        }))
      : [
          { categoryId: categories[0]?.id ?? "", text: String(minorToMajor(totalMinor, currency)) },
          { categoryId: "", text: "" },
        ],
  );

  const parsed = useMemo(
    () =>
      lines.map((line) => {
        if (!line.text.trim()) return { ...line, minor: 0 };
        try {
          return { ...line, minor: parseMajorToMinor(line.text, currency) };
        } catch {
          return { ...line, minor: 0 };
        }
      }),
    [lines, currency],
  );

  const assigned = parsed.reduce((sum, line) => sum + line.minor, 0);
  const remainder = totalMinor - assigned;
  const usable = parsed.filter((line) => line.minor > 0 && line.categoryId);
  const canConfirm = remainder === 0 && usable.length >= 2;

  const update = (index: number, patch: Partial<{ categoryId: string; text: string }>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <Sheet title={t("entry.splitTitle")} onClose={onClose}>
      <p className={cn(HINT, "mt-0")}>{t("entry.splitHint")}</p>

      <div className={cn(CARD, "mb-3 flex items-center justify-between gap-3")}>
        <span className="text-xs text-muted-foreground">{t("entry.amount")}</span>
        <Amount minor={totalMinor} currency={currency} tone={kind} cents />
      </div>

      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div key={index} className={cn(CARD, "flex flex-col gap-2")}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {t("entry.splitLine", { n: index + 1 })}
              </span>
              {lines.length > 2 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                >
                  {t("common.delete")}
                </Button>
              )}
            </div>

            <select
              value={line.categoryId}
              onChange={(event) => update(index, { categoryId: event.target.value })}
              aria-label={t("entry.category")}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={line.text}
                onChange={(event) => update(index, { text: event.target.value })}
                placeholder="0"
                className="min-w-0 flex-1"
                aria-label={t("entry.amount")}
              />
              {/* Fills this line with whatever is unassigned — the common case is one typed
                  amount and "the rest". */}
              {remainder !== 0 && (
                <button
                  type="button"
                  className={chipClasses()}
                  onClick={() =>
                    // Scaled by the currency, not /100: filling "the rest" on a yen split would
                    // otherwise write a hundredth of it.
                    update(index, {
                      text: String(minorToMajor(parsed[index]!.minor + remainder, currency)),
                    })
                  }
                >
                  {formatMoney(remainder, currency, locale)}
                </button>
              )}
              {line.categoryId && (
                <IconChip
                  icon={categories.find((c) => c.id === line.categoryId)?.icon ?? "🏷️"}
                  color={categories.find((c) => c.id === line.categoryId)?.color}
                  small
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <Button
        block
        layoutClassName="mt-2"
        onClick={() => setLines((c) => [...c, { categoryId: "", text: "" }])}
      >
        {t("entry.splitAdd")}
      </Button>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {remainder < 0
            ? t("entry.splitOver", { amount: formatMoney(-remainder, currency, locale) })
            : t("entry.splitRemaining", { amount: formatMoney(remainder, currency, locale) })}
        </span>
        {remainder !== 0 && <span className="text-xs text-destructive">●</span>}
      </div>

      <Button
        variant="primary"
        block
        layoutClassName="mt-3"
        disabled={!canConfirm}
        onClick={() =>
          onConfirm(usable.map((l) => ({ categoryId: l.categoryId, amountMinor: l.minor })))
        }
      >
        {t("common.save")}
      </Button>
    </Sheet>
  );
}
