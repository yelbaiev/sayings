import type { Currency } from "@shared/currency";
import { useApp } from "~/app/AppContext";
import {
  pressBackspace,
  pressDecimal,
  pressDigit,
  pressEquals,
  pressOperator,
  type Expression,
} from "~/lib/calc";

/**
 * The custom numeric pad.
 *
 * Not the OS keyboard, deliberately: that costs ~300ms of slide-in animation, gives cramped
 * number-row keys, and reflows the layout so the fields below would be pushed off screen.
 *
 * **Digits ascend from the top row**, phone-dialer order rather than calculator order. This app had
 * it the other way — 7-8-9 on top, as a desk calculator does — on the reasoning that a calculator is
 * what people have in their fingers for arithmetic. That was wrong for this context: the thing being
 * used here is a phone, every keypad on it counts downward from 1, and the pad this replaced was
 * measurably slower to hit because the eye kept starting at the wrong corner.
 *
 * Operators are a column down the left, `=` a tall key on the right. Arithmetic used to live in a row
 * that appeared only after an operator had been pressed, which meant × and − were invisible until you
 * already knew they existed.
 *
 * There is no save key. Saving is a button above the pad that is present whether or not the pad is
 * open, because two ways to commit — one of which appears and disappears — is two things to learn and
 * one of them is always missing.
 */
export function Keypad({
  expression,
  currency,
  onChange,
}: {
  expression: Expression;
  currency: Currency;
  onChange: (expression: Expression) => void;
}) {
  const { t, locale } = useApp();

  /*
   * The locale's own decimal separator — "," for ru/uk, "." for en. Hardcoding either would
   * print a character the user does not type on paper, and the amount display above the pad is
   * already formatted with Intl, so the two would visibly disagree.
   */
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";

  const key = (
    label: string,
    onClick: () => void,
    options: { ariaLabel?: string | undefined; className?: string | undefined } = {},
  ) => (
    <button
      key={label}
      type="button"
      className={options.className ? `keypad__key ${options.className}` : "keypad__key"}
      onClick={onClick}
      aria-label={options.ariaLabel ?? label}
    >
      {label}
    </button>
  );

  const digit = (value: string) =>
    key(value, () => onChange(pressDigit(expression, value, currency)));

  const operator = (label: string, op: "+" | "-" | "*", ariaLabel: string) =>
    key(label, () => onChange(pressOperator(expression, op, currency)), {
      ariaLabel,
      className: "keypad__key--op",
    });

  return (
    <div className="keypad">
      {/* Column order matters to the grid's auto-flow: each row is operator, three digits, and on
          the first row the equals key, which spans the rest. */}
      {operator("+", "+", t("entry.add"))}
      {digit("1")}
      {digit("2")}
      {digit("3")}
      <button
        type="button"
        className="keypad__key keypad__key--equals"
        onClick={() => onChange(pressEquals(expression, currency))}
        aria-label={t("entry.equals")}
      >
        =
      </button>

      {operator("−", "-", t("entry.subtract"))}
      {digit("4")}
      {digit("5")}
      {digit("6")}

      {operator("×", "*", t("entry.multiply"))}
      {digit("7")}
      {digit("8")}
      {digit("9")}

      {key("÷", () => onChange(pressOperator(expression, "/", currency)), {
        ariaLabel: t("entry.divide"),
        className: "keypad__key--op",
      })}
      {key(decimal, () => onChange(pressDecimal(expression)), { ariaLabel: t("entry.decimal") })}
      {digit("0")}
      {key("⌫", () => onChange(pressBackspace(expression, currency)), {
        ariaLabel: t("common.back"),
      })}
    </div>
  );
}
