import type { Currency } from "@shared/currency";
import { useApp } from "~/app/AppContext";
import { useEffect, useRef } from "react";
import {
  OPERATOR_GLYPHS,
  pressBackspace,
  pressClear,
  pressDecimal,
  pressDigit,
  pressEquals,
  pressOperator,
  type Expression,
} from "~/lib/calc";
import { decimalSeparator } from "~/lib/format";
import { flash } from "~/lib/press-flash";

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
 * Keys fire on pointer *down* and flash as they fire. A pad that waits for the finger to lift
 * before doing anything reads as slow at the speed an amount is actually typed, and one that does
 * nothing visible until the number above changes reads as a dropped press.
 *
 * The flash is all the feedback there is: iOS has no route to a haptic from a web page — no
 * Vibration API in WebKit, and Core Haptics is native-only — and the hidden-switch trick that
 * plays the system tap on some builds did nothing on the phone this app is used from. It was
 * tried, it was measured, and it came out. See CHANGELOG 1.0.2 through 1.0.6.
 *
 * There is no save key. Saving is a button above the pad that is present whether or not the pad is
 * open, because two ways to commit — one of which appears and disappears — is two things to learn and
 * one of them is always missing.
 */
/*
 * The pad's own flash, louder than the app-wide one: a key inverts to the primary colour where a
 * row or a button only takes a tint. A 56px target pressed without being looked at can carry that,
 * and a full-width list row cannot. The `data-press-flash="off"` on the pad below is what keeps the
 * general listener from adding its animation on top of this one — two animations, one `transform`.
 */
const FLASH_CLASS = "keypad__key--flash";

/** How long ⌫ must be held to clear rather than delete. Matches the add button's own threshold. */
const CLEAR_HOLD_MS = 550;

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

  /* The locale's own separator, from the same helper the amount display uses — the two sit one
     above the other, so a disagreement would be visible. */
  const decimal = decimalSeparator(locale);

  /*
   * The held backspace.
   *
   * Kept as a bare timer rather than routed through `createPressGesture`, whose whole shape is
   * "a tap fires on release, a hold fires instead of it". Backspace is the other shape: it deletes
   * on the way down like every other key, and holding it *adds* a clear. Bending the shared
   * machine to do both would put its one invariant back in play for the add button.
   */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  // A pad can be unmounted mid-hold — the sheet closes, the field collapses — and a timer that
  // outlives it would clear an expression nobody is looking at any more.
  useEffect(() => cancelHold, []);

  const key = (
    label: string,
    act: () => void,
    options: { ariaLabel?: string | undefined; className?: string | undefined } = {},
  ) => (
    <button
      key={label}
      type="button"
      className={options.className ? `keypad__key ${options.className}` : "keypad__key"}
      /*
       * Down, not up. Waiting for the lift costs the length of the press — a tenth of a second
       * that is invisible on one key and obvious across "1 2 4 0 , 5 0" — and a press that slides
       * a few pixels off the key never produces a click at all, which is how a fast run of digits
       * loses one.
       */
      onPointerDown={(event) => {
        flash(event.currentTarget, FLASH_CLASS);
        act();
      }}
      /*
       * The keyboard's own path. A click from Enter or Space carries no pointer behind it and
       * reports `detail: 0`; a click that follows a real press reports 1 and is dropped here,
       * because that key already fired on the way down.
       */
      onClick={(event) => {
        if (event.detail !== 0) return;
        flash(event.currentTarget, FLASH_CLASS);
        act();
      }}
      onAnimationEnd={(event) => event.currentTarget.classList.remove(FLASH_CLASS)}
      aria-label={options.ariaLabel ?? label}
    >
      {label}
    </button>
  );

  const digit = (value: string) =>
    key(value, () => onChange(pressDigit(expression, value, currency)));

  const operator = (op: "+" | "-" | "*", ariaLabel: string) =>
    key(OPERATOR_GLYPHS[op], () => onChange(pressOperator(expression, op)), {
      ariaLabel,
      className: "keypad__key--op",
    });

  return (
    <div className="keypad" data-press-flash="off">
      {/* Column order matters to the grid's auto-flow: each row is operator, three digits, and on
          the first row the equals key, which spans the rest. */}
      {operator("+", t("entry.add"))}
      {digit("1")}
      {digit("2")}
      {digit("3")}
      {key("=", () => onChange(pressEquals(expression, currency)), {
        ariaLabel: t("entry.equals"),
        className: "keypad__key--equals",
      })}

      {operator("-", t("entry.subtract"))}
      {digit("4")}
      {digit("5")}
      {digit("6")}

      {operator("*", t("entry.multiply"))}
      {digit("7")}
      {digit("8")}
      {digit("9")}

      {key(OPERATOR_GLYPHS["/"], () => onChange(pressOperator(expression, "/")), {
        ariaLabel: t("entry.divide"),
        className: "keypad__key--op",
      })}
      {key(decimal, () => onChange(pressDecimal(expression, currency)), {
        ariaLabel: t("entry.decimal"),
      })}
      {digit("0")}
      <button
        key="⌫"
        type="button"
        className="keypad__key"
        /*
         * Deletes on the way down like every other key, and starts the clock. Held past the
         * threshold it wipes the whole amount — which used to cost one press per digit, and on a
         * mistyped six-figure sum that is a lot of presses to correct one.
         */
        onPointerDown={(event) => {
          flash(event.currentTarget, FLASH_CLASS);
          onChange(pressBackspace(expression));
          cancelHold();
          holdTimer.current = setTimeout(() => {
            onChange(pressClear());
          }, CLEAR_HOLD_MS);
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onClick={(event) => {
          if (event.detail !== 0) return;
          flash(event.currentTarget, FLASH_CLASS);
          onChange(pressBackspace(expression));
        }}
        onAnimationEnd={(event) => event.currentTarget.classList.remove(FLASH_CLASS)}
        aria-label={t("common.back")}
      >
        ⌫
      </button>
    </div>
  );
}
