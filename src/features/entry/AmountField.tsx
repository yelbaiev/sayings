import { useEffect, useState } from "react";
import type { Currency } from "@shared/currency";
import { useApp } from "~/app/AppContext";
import { cn } from "~/lib/cn";
import {
  EMPTY_EXPRESSION,
  evaluate,
  formatExpression,
  fromMinor,
  isEmpty,
  type Expression,
} from "~/lib/calc";
import { Keypad } from "./Keypad";

/**
 * An amount, typed on the app's own keypad, for the forms that are not the entry sheet.
 *
 * Six fields used to take money through a plain text input while the entry sheet had a calculator:
 * a budget limit, an opening balance, a recurring amount, a quick tile, a split line, and the
 * second leg of a cross-currency transfer. Every one of them is a place where arithmetic is the
 * natural way to say the number — a budget is "500 a week times four", an opening balance is read
 * off a statement, a split is "the rest" — and every one of them offered the OS keyboard instead.
 *
 * **The pad opens beneath the field rather than in the sheet's footer.** The entry sheet mounts it
 * in the footer because it is amount-first: the pad is up from the moment the sheet opens and never
 * moves. These are forms with one amount among several fields, so a footer pad would have to know
 * which field it was editing, and every one of these sheets would have to grow that plumbing.
 * Inline, the pad belongs to the field it is under, and the sheet scrolls as it always did.
 */

/*
 * Which field has the pad, app-wide.
 *
 * A split sheet holds one of these per line, and two pads open at once is a form that has lost
 * track of what it is doing. A module-level subscription rather than lifted state keeps the
 * component a drop-in: six call sites would otherwise each have to hold an "open field" id.
 */
let openField: symbol | null = null;
const listeners = new Set<() => void>();

function claim(id: symbol): void {
  openField = id;
  for (const notify of listeners) notify();
}

function release(id: symbol): void {
  if (openField === id) openField = null;
  for (const notify of listeners) notify();
}

export function AmountField({
  valueMinor,
  currency,
  onChange,
  label,
  autoFocus = false,
}: {
  /** The amount in minor units. Null for an empty field, which shows nothing rather than a zero. */
  valueMinor: number | null;
  currency: Currency;
  onChange: (minor: number | null) => void;
  /** The accessible name. These fields sit inside a `Field` whose visible label is its own. */
  label: string;
  /** Opens the pad on mount, for the sheets whose amount is the first thing asked for. */
  autoFocus?: boolean;
}) {
  const { locale } = useApp();
  const [id] = useState(() => Symbol("amount-field"));
  const [open, setOpen] = useState(autoFocus);
  const [, forceRender] = useState(0);

  /*
   * What is being typed, kept only while the pad is open.
   *
   * It has to be state rather than a derivation, because "45," and "45" are the same number and
   * two different states of the keypad — deriving from `valueMinor` would swallow the separator
   * the moment it was pressed, which is the exact bug the calculator display exists to fix.
   *
   * Closed, the field derives instead. That way a value moved from outside — a split line filled
   * with "the rest", a currency switched above it — simply appears, with no effect syncing two
   * copies of the same fact and no render cascade to reason about.
   */
  const [typing, setTyping] = useState<Expression>(EMPTY_EXPRESSION);

  useEffect(() => {
    const notify = () => forceRender((n) => n + 1);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
      release(id);
    };
  }, [id]);

  useEffect(() => {
    if (autoFocus) claim(id);
  }, [autoFocus, id]);

  // Another field taking the pad closes this one, without either knowing about the other. Derived,
  // not synced: `open` may sit stale at true, and nothing reads it except through here.
  const isOpen = open && openField === id;

  const settled = valueMinor === null ? EMPTY_EXPRESSION : fromMinor(valueMinor, currency);
  const expression = isOpen ? typing : settled;

  const apply = (next: Expression) => {
    setTyping(next);
    onChange(isEmpty(next) ? null : evaluate(next, currency));
  };

  return (
    <div>
      <button
        type="button"
        data-slot="amount-field"
        className={cn(
          "flex min-h-11 w-full items-center rounded-md border px-3 py-2 text-left",
          "text-[17px] font-semibold tabular-nums",
          isOpen ? "border-primary bg-secondary" : "border-input bg-background",
        )}
        onClick={() => {
          // Seeded here rather than in an effect: opening is an event, and this is the one moment
          // the typed expression has to catch up with the value.
          setTyping(settled);
          claim(id);
          setOpen(true);
        }}
        aria-expanded={isOpen}
        aria-label={label}
      >
        {/* Empty while the pad is open and nothing is keyed, for the same reason the entry sheet
            is: a zero in an active field is a value the field does not have. */}
        <span className="sensitive truncate">
          {isEmpty(expression) && isOpen ? "" : formatExpression(expression, currency, locale)}
        </span>
      </button>

      {isOpen && (
        <div className="mt-1 overflow-hidden rounded-lg border border-border">
          <Keypad expression={expression} currency={currency} onChange={apply} />
        </div>
      )}
    </div>
  );
}
