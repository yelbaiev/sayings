import { minorUnitScale, type Currency } from "@shared/currency";
import { MoneyError, parseMajorToMinor, type Minor } from "@shared/money";

/**
 * The keypad's inline arithmetic: `120+45+90`.
 *
 * Written by hand rather than with `eval`, `new Function`, or an expression-parser
 * dependency. Those are all banned here — `no-eval` and `no-new-func` are lint errors — and
 * for a four-function calculator over user input the risk is not worth any convenience.
 *
 * Evaluation is strictly left to right with no operator precedence, because that is how
 * someone adding up a receipt expects a running tally to behave. `100+50*2` gives 300, not
 * 200; multiplication exists only for quantities ("6 × 45"), and mixing it with addition in
 * one expression is not a real use case at a checkout.
 */

export type Operator = "+" | "-" | "*" | "/";

export interface Expression {
  /** Digits typed so far for the current term, e.g. "45" or "45.5". */
  current: string;
  /** Terms already committed by pressing an operator, in minor units. */
  accumulated: Minor | null;
  pendingOperator: Operator | null;
  /**
   * True when `current` is a *result* rather than something typed.
   *
   * Set by `=`, and it changes what the next digit means: on a calculator a digit after a total
   * starts a new number, it does not extend the total. Without this, "120 + 30 = 5" read as 1505 —
   * a number nobody typed, in a field that is about to become a transaction.
   */
  settled?: boolean;
}

export const EMPTY_EXPRESSION: Expression = {
  current: "",
  accumulated: null,
  pendingOperator: null,
};

function applyOperator(left: Minor, operator: Operator, right: Minor, currency: Currency): Minor {
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*": {
      // A multiplier is a count, not money, so scale back down after multiplying two
      // minor-unit values — otherwise "2 × 3.00" would give 600.00 rather than 6.00.
      const scale = minorUnitScale(currency);
      const product = (left * right) / scale;
      return Math.sign(product) * Math.round(Math.abs(product));
    }
    case "/": {
      /*
       * Splitting a bill: the divisor is a count, so the scaling is the mirror of multiplication.
       *
       * Dividing by zero returns the left side unchanged rather than Infinity. "120 ÷" with nothing
       * after it is a half-typed expression, not an error to report — the same reading every other
       * operator here gives an empty right-hand term.
       */
      if (right === 0) return left;
      const scale = minorUnitScale(currency);
      const quotient = (left * scale) / right;
      return Math.sign(quotient) * Math.round(Math.abs(quotient));
    }
  }
}

/** Current value of the expression in minor units, treating an empty term as zero. */
export function evaluate(expression: Expression, currency: Currency): Minor {
  const { current, accumulated, pendingOperator } = expression;

  let currentMinor = 0;
  if (current !== "" && current !== ".") {
    try {
      currentMinor = parseMajorToMinor(current, currency);
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      currentMinor = 0;
    }
  }

  if (accumulated === null || pendingOperator === null) return currentMinor;
  if (current === "") return accumulated;
  return applyOperator(accumulated, pendingOperator, currentMinor, currency);
}

/** True once there is a non-zero amount, which is what arms the save button. */
export function hasAmount(expression: Expression, currency: Currency): boolean {
  return evaluate(expression, currency) > 0;
}

export function pressDigit(expression: Expression, digit: string, currency: Currency): Expression {
  const digits = minorUnitDigitsOf(currency);
  // A digit after `=` starts over rather than extending the result.
  const { current } = expression.settled ? { current: "" } : expression;

  // Refuse more fraction digits than the currency has. Typing them would round away
  // silently, which looks like the app ignoring input.
  const dot = current.indexOf(".");
  if (dot !== -1 && current.length - dot - 1 >= digits) return expression;

  // Guard against absurd lengths, and against a leading run of zeros.
  if (current.replace(/[.]/g, "").length >= 12) return expression;
  if (current === "0" && digit === "0") return expression;
  if (current === "0" && digit !== "0") return { ...expression, current: digit };

  return { ...expression, current: current + digit };
}

export function pressDecimal(expression: Expression): Expression {
  if (expression.settled) return { ...EMPTY_EXPRESSION, current: "0." };
  if (expression.current.includes(".")) return expression;
  return { ...expression, current: (expression.current || "0") + "." };
}

/**
 * Commits the current term and stores the operator.
 *
 * Pressing an operator twice replaces it rather than starting a new term, so a mistyped
 * operator costs one more press instead of a full clear.
 */
export function pressOperator(
  expression: Expression,
  operator: Operator,
  currency: Currency,
): Expression {
  if (expression.current === "" && expression.accumulated !== null) {
    return { ...expression, pendingOperator: operator };
  }
  if (expression.current === "") return expression;

  return {
    current: "",
    accumulated: evaluate(expression, currency),
    pendingOperator: operator,
  };
}

/**
 * Backspace. Deletes a digit from the current term; once that is empty, steps back out of
 * the pending operator so a whole expression can be unwound without clearing it.
 */
export function pressBackspace(expression: Expression, currency: Currency): Expression {
  if (expression.current !== "") {
    return { ...expression, current: expression.current.slice(0, -1) };
  }

  // Removing the operator must hand the committed term back as the editable one. Simply
  // clearing `pendingOperator` would leave the accumulated value unreachable, so "120+" then
  // backspace would silently become 0 — losing an amount the user had already typed.
  if (expression.pendingOperator !== null) {
    return expression.accumulated === null
      ? EMPTY_EXPRESSION
      : fromMinor(expression.accumulated, currency);
  }

  if (expression.accumulated !== null) {
    return EMPTY_EXPRESSION;
  }
  return expression;
}

/** What the amount display should show while typing. */
export function displayValue(expression: Expression, currency: Currency): Minor {
  return evaluate(expression, currency);
}

export interface ExpressionTerms {
  /** The running total so far, or null when nothing has been committed with an operator. */
  left: Minor | null;
  operator: Operator | null;
  /** The term being typed. Null while it is empty, so "120 +" reads correctly. */
  right: Minor | null;
}

/**
 * The parts of a part-typed expression, for showing the working rather than only the answer.
 *
 * Splitting a receipt used to be blind: entering 120+45 showed a total of 165 and a lone "+"
 * glyph, so there was no way to check what had been typed. The expression itself is not kept —
 * only a running total, an operator and the current term — which is exactly what a calculator's
 * upper line shows, and enough to see what is happening.
 *
 * Returns numbers rather than a string: formatting money is the caller's job, and it depends on a
 * locale this module knows nothing about.
 */
export function expressionTerms(expression: Expression, currency: Currency): ExpressionTerms {
  const { current, accumulated, pendingOperator } = expression;
  if (accumulated === null || pendingOperator === null) {
    return { left: null, operator: null, right: null };
  }

  const typed = current === "" || current === ".";
  return {
    left: accumulated,
    operator: pendingOperator,
    // Reuses evaluate's own parsing by asking it for a term on its own, so a half-typed "45." or a
    // value the currency cannot represent behaves identically in both places.
    right: typed ? null : evaluate({ current, accumulated: null, pendingOperator: null }, currency),
  };
}

/**
 * True when a partial expression is showing, so the UI can hint that a term is pending —
 * otherwise `120+` looks identical to `120`.
 */
export function isPartial(expression: Expression): boolean {
  return expression.pendingOperator !== null;
}

/** Builds an expression from an existing amount, for editing a saved transaction. */
export function fromMinor(amountMinor: Minor, currency: Currency): Expression {
  const digits = minorUnitDigitsOf(currency);
  const scale = minorUnitScale(currency);
  const major = Math.abs(amountMinor) / scale;
  const text = amountMinor % scale === 0 ? String(Math.abs(amountMinor) / scale) : major.toFixed(digits);
  return { ...EMPTY_EXPRESSION, current: text };
}

function minorUnitDigitsOf(currency: Currency): number {
  return Math.round(Math.log10(minorUnitScale(currency)));
}

/**
 * Settles the pending operation, the way `=` does on a calculator.
 *
 * The amount was already shown as the running total, so this changes nothing on screen for a
 * complete expression — which is the point: pressing `=` out of habit must not alter the number. What
 * it does is *commit*, so the next digit starts a new term instead of extending the old right-hand
 * one, and the working line stops claiming an operation is still pending.
 */
export function pressEquals(expression: Expression, currency: Currency): Expression {
  if (expression.pendingOperator === null) return expression;
  const total = evaluate(expression, currency);
  return {
    current: majorString(total, currency),
    accumulated: null,
    pendingOperator: null,
    settled: true,
  };
}

/** Minor units back to the digit string the current term holds. */
function majorString(minor: Minor, currency: Currency): string {
  const digits = minorUnitDigitsOf(currency);
  if (digits === 0) return String(minor);
  const text = (minor / minorUnitScale(currency)).toFixed(digits);
  // Trailing zeros would make the next backspace delete a digit nobody typed.
  return text.replace(/\.?0+$/, "");
}
