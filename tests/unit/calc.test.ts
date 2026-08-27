import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_EXPRESSION,
  evaluate,
  expressionTokens,
  formatExpression,
  hasAmount,
  isPartial,
  pressBackspace,
  pressEquals,
  pressDecimal,
  pressDigit,
  pressOperator,
  type Expression,
} from "~/lib/calc";
import type { Currency } from "@shared/currency";

/** Types a sequence of keys, so tests read like actual use. */
function type(keys: string, currency: Currency = "UAH"): Expression {
  let expression = EMPTY_EXPRESSION;
  for (const key of keys) {
    if (key >= "0" && key <= "9") expression = pressDigit(expression, key, currency);
    else if (key === ".") expression = pressDecimal(expression, currency);
    else if (key === "+" || key === "-" || key === "*" || key === "/") {
      expression = pressOperator(expression, key);
    } else if (key === "=") {
      expression = pressEquals(expression, currency);
    } else if (key === "<") expression = pressBackspace(expression);
  }
  return expression;
}

describe("plain amounts", () => {
  it("types digits into minor units", () => {
    expect(evaluate(type("1240"), "UAH")).toBe(124_000);
    expect(evaluate(type("8"), "UAH")).toBe(800);
  });

  it("handles a decimal point", () => {
    expect(evaluate(type("1240.50"), "UAH")).toBe(124_050);
    expect(evaluate(type("0.05"), "UAH")).toBe(5);
  });

  it("treats an empty expression as zero and refuses to save it", () => {
    expect(evaluate(EMPTY_EXPRESSION, "UAH")).toBe(0);
    expect(hasAmount(EMPTY_EXPRESSION, "UAH")).toBe(false);
    expect(hasAmount(type("0"), "UAH")).toBe(false);
    expect(hasAmount(type("1"), "UAH")).toBe(true);
  });

  it("ignores a second decimal point and keeps typing fraction digits", () => {
    // "12.3" then a stray "." then "4" lands on 12.34 rather than throwing the 4 away.
    expect(evaluate(type("12.3.4"), "UAH")).toBe(1234);
  });

  it("refuses more fraction digits than the currency has", () => {
    // Accepting them would round silently, which reads as the app dropping keypresses.
    expect(evaluate(type("1.239"), "UAH")).toBe(123);
  });

  it("collapses a leading zero rather than building 0007", () => {
    expect(evaluate(type("007"), "UAH")).toBe(700);
  });

});

describe("inline arithmetic", () => {
  it("adds a split receipt left to right", () => {
    // The reason this exists: one supermarket trip, three category lines.
    expect(evaluate(type("120+45+90"), "UAH")).toBe(25_500);
  });

  it("subtracts", () => {
    expect(evaluate(type("100-30"), "UAH")).toBe(7000);
  });

  it("multiplies a quantity without inflating the scale", () => {
    // "6 × 45" must be ₴270, not ₴27 000 — the multiplier is a count, not money.
    expect(evaluate(type("6*45"), "UAH")).toBe(27_000);
    expect(evaluate(type("2*3"), "UAH")).toBe(600);
  });

  it("evaluates strictly left to right, with no operator precedence", () => {
    // Deliberate: a running receipt tally is what someone at a till expects, not algebra.
    expect(evaluate(type("100+50*2"), "UAH")).toBe(30_000);
  });

  it("shows the running total before the next term is typed", () => {
    expect(evaluate(type("120+"), "UAH")).toBe(12_000);
    expect(isPartial(type("120+"))).toBe(true);
    expect(isPartial(type("120"))).toBe(false);
  });

  it("replaces a mistyped operator instead of starting a new term", () => {
    expect(evaluate(type("120+-45"), "UAH")).toBe(7500);
  });

  it("ignores an operator pressed before any digits", () => {
    expect(evaluate(type("+"), "UAH")).toBe(0);
  });
});

describe("backspace", () => {
  it("removes one digit at a time", () => {
    expect(evaluate(type("1240<"), "UAH")).toBe(12_400);
    expect(evaluate(type("1240<<"), "UAH")).toBe(1200);
  });

  it("hands the committed term back when the operator is removed", () => {
    // Regression: clearing the operator without restoring the accumulated value made "120+"
    // then backspace collapse to 0, silently discarding an amount already typed.
    expect(isPartial(type("120+<"))).toBe(false);
    expect(evaluate(type("120+<"), "UAH")).toBe(12_000);
    // And the restored term is editable, not frozen.
    expect(evaluate(type("120+<<"), "UAH")).toBe(1200);
    expect(evaluate(type("120+<5"), "UAH")).toBe(120_500);
  });

  it("does nothing on an empty expression", () => {
    expect(pressBackspace(EMPTY_EXPRESSION)).toEqual(EMPTY_EXPRESSION);
  });
});

describe("security", () => {
  it("never evaluates user input as code", () => {
    // The whole reason this module is hand-written. A regression to eval/new Function here
    // would be a code-execution path fed directly by keypad input.
    const source = readFileSync(new URL("../../src/lib/calc.ts", import.meta.url), "utf8");
    // Comments are stripped first: the module's own documentation explains why eval and
    // new Function are avoided, and matching that prose would be a false positive.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/new\s+Function/);
    expect(code).not.toMatch(/setTimeout\s*\(\s*["'`]/);
  });

  it("is unfazed by junk in the current term", () => {
    const hostile: Expression = {
      terms: [],
      operators: [],
      current: "1+1); process.exit(",
    };
    // Unparseable, so it contributes nothing — no throw, no execution.
    expect(evaluate(hostile, "UAH")).toBe(0);
  });

  it("caps the length of a typed amount", () => {
    let expression = EMPTY_EXPRESSION;
    for (let i = 0; i < 40; i++) expression = pressDigit(expression, "9", "UAH");
    expect(Number.isSafeInteger(evaluate(expression, "UAH"))).toBe(true);
  });
});

describe("the expression as typed", () => {
  /** The tokens, flattened to something readable, so a failure names the keys that produced it. */
  const shown = (keys: string, currency: Currency = "UAH") =>
    expressionTokens(type(keys, currency))
      .map((token) => (token.kind === "term" ? token.text : token.operator))
      .join(" ");

  it("has one term before an operator is pressed", () => {
    expect(shown("120")).toBe("120");
    expect(shown("")).toBe("");
  });

  it("keeps every term, not a running total", () => {
    /*
     * The regression this file exists to prevent. The old shape kept only an accumulator, so
     * "120+45+90" showed "165 + 90" — two of the three numbers typed were gone from the screen,
     * which is exactly what makes a mistyped receipt line impossible to spot.
     */
    expect(shown("120+45+90")).toBe("120 + 45 + 90");
    expect(shown("120*3")).toBe("120 * 3");
  });

  it("shows a term still waiting for its right-hand side", () => {
    expect(shown("120+")).toBe("120 +");
    expect(isPartial(type("120+"))).toBe(true);
  });

  it("keeps a half-typed fraction exactly as keyed", () => {
    // Every one of these is a distinct display, and the parsed value cannot tell them apart.
    expect(shown("45.")).toBe("45.");
    expect(shown("45.0")).toBe("45.0");
    expect(shown("45.04")).toBe("45.04");
  });

  it("collapses to a single term once = is pressed", () => {
    expect(shown("120+45=")).toBe("165");
    expect(isPartial(type("120+45="))).toBe(false);
  });
});

describe("formatExpression", () => {
  it("shows a plain amount with its currency symbol", () => {
    // ru groups with a space and puts the symbol last; the figure itself is what was typed.
    expect(formatExpression(type("1240.50"), "UAH", "ru")).toMatch(/^1\u00a0240,50\s*₴$/u);
    expect(formatExpression(EMPTY_EXPRESSION, "UAH", "ru")).toMatch(/^0\s*₴$/u);
  });

  it("echoes each keystroke after the separator", () => {
    /*
     * The bug, stated as four assertions: these four states drew as "45", "45,", "45" and "45,40"
     * when the display rendered the parsed value, so the two middle keypresses did nothing
     * visible and the last one seemed to jump.
     */
    expect(formatExpression(type("45"), "UAH", "ru")).toMatch(/^45\s*₴$/u);
    expect(formatExpression(type("45."), "UAH", "ru")).toMatch(/^45,\s*₴$/u);
    expect(formatExpression(type("45.4"), "UAH", "ru")).toMatch(/^45,4\s*₴$/u);
    expect(formatExpression(type("45.40"), "UAH", "ru")).toMatch(/^45,40\s*₴$/u);
    expect(formatExpression(type("45.0"), "UAH", "ru")).toMatch(/^45,0\s*₴$/u);
  });

  it("shows the working, with typographic operators and no symbol", () => {
    // No currency symbol mid-expression: it has nowhere honest to sit while a term is missing,
    // and "120 + ₴" reads as a typo rather than as an amount.
    expect(formatExpression(type("120+45"), "UAH", "ru")).toBe("120 + 45");
    expect(formatExpression(type("120+"), "UAH", "ru")).toBe("120 +");
    expect(formatExpression(type("120-45"), "UAH", "ru")).toBe("120 − 45");
    expect(formatExpression(type("6*45"), "UAH", "ru")).toBe("6 × 45");
    expect(formatExpression(type("120/3"), "UAH", "ru")).toBe("120 ÷ 3");
  });

  it("shows the result, with the symbol back, only after =", () => {
    expect(formatExpression(type("120+45"), "UAH", "ru")).toBe("120 + 45");
    expect(formatExpression(type("120+45="), "UAH", "ru")).toMatch(/^165\s*₴$/u);
  });

  it("puts the symbol where the locale puts it", () => {
    expect(formatExpression(type("1240"), "USD", "en")).toBe("$1,240");
  });
});

describe("division", () => {
  it("splits an amount by a count", () => {
    // The reason it exists: a bill of 120 shared three ways, typed the way it is said aloud.
    expect(evaluate(type("120/3", "UAH"), "UAH")).toBe(4_000);
    expect(evaluate(type("100/4", "UAH"), "UAH")).toBe(2_500);
  });

  it("rounds to the currency's own precision", () => {
    // 100 / 3 is 33.333…, and a hryvnia has kopiyky. Half away from zero, like everything here.
    expect(evaluate(type("100/3", "UAH"), "UAH")).toBe(3_333);
    // The yen has no minor unit, so the same division lands on a whole number.
    expect(evaluate(type("100/3", "JPY"), "JPY")).toBe(33);
  });

  it("treats a missing divisor as a half-typed expression, not an error", () => {
    /*
     * "120 ÷" with nothing after it is someone mid-thought. Returning Infinity — or throwing — would
     * turn a pause into a broken amount field, and every other operator here reads an empty
     * right-hand term the same way.
     */
    expect(evaluate(type("120/", "UAH"), "UAH")).toBe(12_000);
    expect(evaluate(type("120/0", "UAH"), "UAH")).toBe(12_000);
  });
});

describe("equals", () => {
  it("leaves a settled amount exactly as it was", () => {
    // Pressing = out of habit must not change the number that is about to be saved.
    expect(evaluate(type("120+30=", "UAH"), "UAH")).toBe(evaluate(type("120+30", "UAH"), "UAH"));
  });

  it("commits, so the next digit starts a new amount", () => {
    /*
     * The difference = actually makes. Without it, a digit typed after a total extends the previous
     * right-hand term: "120+30" then "5" becomes 120+305. After =, it starts over.
     */
    expect(evaluate(type("120+30=5", "UAH"), "UAH")).toBe(500);
    // Without it, the 5 extends the right-hand term: 120 + 305.
    expect(evaluate(type("120+305", "UAH"), "UAH")).toBe(42_500);
  });

  it("does nothing when there is nothing pending", () => {
    expect(evaluate(type("120=", "UAH"), "UAH")).toBe(12_000);
    expect(evaluate(type("=", "UAH"), "UAH")).toBe(0);
  });
});

describe("after equals", () => {
  it("keeps every digit of the number typed next", () => {
    /*
     * `settled` used to survive the first digit, so it reset the term again on the second: "=53"
     * kept only the 3. Typing a fresh amount straight after a total is common enough — one total,
     * then the next receipt — that it looked like the pad dropping keypresses.
     */
    expect(evaluate(type("120+30=53"), "UAH")).toBe(5300);
    expect(evaluate(type("120+30=1.25"), "UAH")).toBe(125);
  });

  it("carries the result forward when an operator comes next", () => {
    // The calculator reading: the total becomes the left-hand side.
    expect(evaluate(type("120+30=+5"), "UAH")).toBe(15_500);
  });

  it("edits the result rather than discarding it on backspace", () => {
    expect(evaluate(type("120+30=<"), "UAH")).toBe(1500);
    // And what is left is a typed number again, so the next digit extends it.
    expect(evaluate(type("120+30=<7"), "UAH")).toBe(15_700);
  });
});

describe("currencies without a minor unit", () => {
  it("ignores the decimal key entirely", () => {
    // A yen has no fraction, so every digit after a point would be refused. A key that appears
    // to work and then swallows the next three presses is worse than one that does nothing.
    expect(type("100.5", "JPY").current).toBe("1005");
    expect(evaluate(type("100.5", "JPY"), "JPY")).toBe(1005);
  });
});
