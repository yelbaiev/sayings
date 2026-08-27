import { minorUnitScale, type Currency, type Locale } from "@shared/currency";
import { MoneyError, parseMajorToMinor, type Minor } from "@shared/money";
import { formatTypedNumber, withCurrency } from "~/lib/format";

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
 *
 * **Terms are kept as typed text, not as a running total.** That is the whole shape of this
 * module and it is what lets the display show `120 + 45,50` rather than `165`. Storing a
 * number instead — which this did — loses two things that turn out to matter: the working
 * (there is no way to check a receipt you cannot see), and the difference between `45`,
 * `45,` and `45,0`, which are the same quantity and three different states of typing.
 */

export type Operator = "+" | "-" | "*" | "/";

/** Typographic operators, not the ASCII the keys send. Shared so the pad and the display agree. */
export const OPERATOR_GLYPHS: Record<Operator, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

export interface Expression {
  /**
   * Terms already committed by pressing an operator, exactly as they were typed:
   * `["120", "45.50"]`. Text, not minor units — see the module note.
   */
  terms: string[];
  /**
   * The operator that ended each committed term, so `operators.length === terms.length` always
   * holds and the last entry is the one still pending a right-hand side.
   */
  operators: Operator[];
  /** Digits typed so far for the term in progress, e.g. "45" or "45.5" or "45.". */
  current: string;
  /**
   * True when `current` is a *result* rather than something typed.
   *
   * Set by `=`, and it changes what the next key means: on a calculator a digit after a total
   * starts a new number, it does not extend the total. Without this, "120 + 30 = 5" read as 1505 —
   * a number nobody typed, in a field that is about to become a transaction.
   */
  settled?: boolean;
}

export const EMPTY_EXPRESSION: Expression = { terms: [], operators: [], current: "" };

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

/** One term's text in minor units. Anything unparseable contributes nothing rather than throwing. */
function termValue(text: string, currency: Currency): Minor {
  if (text === "" || text === "." || text === "-") return 0;
  try {
    return parseMajorToMinor(text, currency);
  } catch (error) {
    if (!(error instanceof MoneyError)) throw error;
    return 0;
  }
}

/** Current value of the expression in minor units, treating an empty trailing term as zero. */
export function evaluate(expression: Expression, currency: Currency): Minor {
  const { terms, operators, current } = expression;
  if (terms.length === 0) return termValue(current, currency);

  let total = termValue(terms[0]!, currency);
  for (let i = 1; i < terms.length; i++) {
    total = applyOperator(total, operators[i - 1]!, termValue(terms[i]!, currency), currency);
  }

  // A term not started yet is a pause, not a zero: "120 +" is worth 120, not 120 + 0. It reads the
  // same for every operator, which is why "120 ÷" is 120 rather than a division by nothing.
  if (current === "" || current === ".") return total;
  return applyOperator(total, operators[terms.length - 1]!, termValue(current, currency), currency);
}

/** True once there is a non-zero amount, which is what arms the save button. */
export function hasAmount(expression: Expression, currency: Currency): boolean {
  return evaluate(expression, currency) > 0;
}

export function pressDigit(expression: Expression, digit: string, currency: Currency): Expression {
  const digits = minorUnitDigitsOf(currency);
  // A digit after `=` starts over rather than extending the result. Starting from the empty
  // expression rather than editing this one is also what drops `settled` — leaving it set made
  // every subsequent digit start over too, so "= 5 3" kept only the 3.
  const base = expression.settled ? EMPTY_EXPRESSION : expression;
  const { current } = base;

  // Refuse more fraction digits than the currency has. Typing them would round away
  // silently, which looks like the app ignoring input.
  const dot = current.indexOf(".");
  if (dot !== -1 && current.length - dot - 1 >= digits) return expression;

  // Guard against absurd lengths, and against a leading run of zeros.
  if (current.replace(/[.]/g, "").length >= 12) return expression;
  if (current === "0" && digit === "0") return expression;
  if (current === "0" && digit !== "0") return { ...base, current: digit };

  return { ...base, current: current + digit };
}

export function pressDecimal(expression: Expression, currency: Currency): Expression {
  // A currency with no minor unit has nothing to put after the point, and every digit that
  // followed would be refused — a key that does nothing is worse than a key that does nothing
  // *visible*, so it does nothing at all.
  if (minorUnitDigitsOf(currency) === 0) return expression;
  if (expression.settled) return { ...EMPTY_EXPRESSION, current: "0." };
  if (expression.current.includes(".")) return expression;
  return { ...expression, current: (expression.current || "0") + "." };
}

/**
 * Commits the current term and stores the operator.
 *
 * Pressing an operator twice replaces it rather than starting a new term, so a mistyped
 * operator costs one more press instead of a full clear.
 *
 * After `=`, the operator carries the result forward as the left-hand side — "120+30=" then "+5"
 * is 155, the way it is on every calculator.
 */
export function pressOperator(expression: Expression, operator: Operator): Expression {
  const { terms, operators, current } = expression;

  if (current === "") {
    if (operators.length === 0) return expression;
    return { ...expression, operators: [...operators.slice(0, -1), operator] };
  }

  // Built fresh rather than spread, so `settled` is dropped: the result is now a committed term.
  return { terms: [...terms, current], operators: [...operators, operator], current: "" };
}

/**
 * Backspace. Deletes a digit from the current term; once that is empty, steps back out of
 * the pending operator so a whole expression can be unwound without clearing it.
 */
export function pressBackspace(expression: Expression): Expression {
  const { terms, operators, current } = expression;

  if (current !== "") {
    // Editing a result turns it back into a typed number — otherwise the next digit would
    // discard whatever was left of it.
    if (expression.settled) return { ...EMPTY_EXPRESSION, current: current.slice(0, -1) };
    return { ...expression, current: current.slice(0, -1) };
  }

  if (operators.length === 0) return expression;

  // Removing the operator must hand the term it committed back as the editable one. Simply
  // dropping the operator would leave that term unreachable, so "120+" then backspace would
  // silently become 0 — losing an amount the user had already typed.
  return {
    terms: terms.slice(0, -1),
    operators: operators.slice(0, -1),
    current: terms[terms.length - 1] ?? "",
  };
}

export type ExpressionToken =
  | { kind: "term"; text: string }
  | { kind: "operator"; operator: Operator };

/**
 * The expression as typed, in order, for showing the working rather than only the answer.
 *
 * Splitting a receipt used to be blind: entering 120+45+90 showed a total of 255 under a "165 +"
 * that had already swallowed the first two terms, so there was no way to check what had been
 * typed. Every term comes back out as its own text — trailing separator, trailing zeros and all —
 * because the display's job is to echo the keys, not to normalise them.
 *
 * Returns tokens rather than a string: formatting numbers is the caller's job, and it depends on a
 * locale this module knows nothing about.
 */
export function expressionTokens(expression: Expression): ExpressionToken[] {
  const { terms, operators, current } = expression;
  const tokens: ExpressionToken[] = [];

  for (const [index, term] of terms.entries()) {
    tokens.push({ kind: "term", text: term });
    tokens.push({ kind: "operator", operator: operators[index]! });
  }
  if (current !== "") tokens.push({ kind: "term", text: current });

  return tokens;
}

/**
 * The whole expression, formatted for the amount display.
 *
 * Two readings, deliberately different:
 *
 * - A plain amount — nothing but digits, or the result `=` just produced — is money, so it gets the
 *   currency symbol: `₴1 240,50`.
 * - An expression in progress is arithmetic, so it gets none: `120 + 45,5`. The symbol has nowhere
 *   honest to sit while a term is still missing (`120 + ₴` reads as a typo), and for the seconds
 *   it takes to add up a receipt the account row below already says which currency this is.
 *
 * The result appears only when `=` is pressed. Until then the display echoes the keys — which is
 * what makes a mistyped term visible, and what the running-total display could never show.
 */
export function formatExpression(
  expression: Expression,
  currency: Currency,
  locale: Locale,
): string {
  const tokens = expressionTokens(expression);

  if (expression.operators.length === 0) {
    const first = tokens[0];
    const text = first?.kind === "term" ? first.text : "";
    return withCurrency(formatTypedNumber(text || "0", locale), currency, locale);
  }

  return tokens
    .map((token) =>
      token.kind === "term"
        ? formatTypedNumber(token.text, locale)
        : OPERATOR_GLYPHS[token.operator],
    )
    .join(" ");
}

/** True when nothing has been keyed at all — not a zero, an absence. */
export function isEmpty(expression: Expression): boolean {
  return expression.terms.length === 0 && expression.current === "";
}

/**
 * True when a partial expression is showing, so the UI can hint that a term is pending —
 * otherwise `120+` looks identical to `120`.
 */
export function isPartial(expression: Expression): boolean {
  return expression.operators.length > 0;
}

/** Builds an expression from an existing amount, for editing a saved transaction. */
export function fromMinor(amountMinor: Minor, currency: Currency): Expression {
  const digits = minorUnitDigitsOf(currency);
  const scale = minorUnitScale(currency);
  const major = Math.abs(amountMinor) / scale;
  const text =
    amountMinor % scale === 0 ? String(Math.abs(amountMinor) / scale) : major.toFixed(digits);
  return { ...EMPTY_EXPRESSION, current: text };
}

function minorUnitDigitsOf(currency: Currency): number {
  return Math.round(Math.log10(minorUnitScale(currency)));
}

/**
 * Settles the pending operation, the way `=` does on a calculator.
 *
 * This is the only key that collapses the working into the answer. Everything up to it shows the
 * expression as typed, so `=` is what the display is waiting for rather than a formality — and
 * pressing it on a plain number, out of habit, still changes nothing.
 */
export function pressEquals(expression: Expression, currency: Currency): Expression {
  if (expression.operators.length === 0) return expression;
  const total = evaluate(expression, currency);
  return {
    terms: [],
    operators: [],
    current: majorString(total, currency),
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
