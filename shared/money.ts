import { minorUnitDigits, minorUnitScale, type Currency } from "./currency";

/**
 * The single place money arithmetic is allowed to happen.
 *
 * Two rules the whole codebase depends on:
 *
 *  1. Amounts are integer minor units (kopiyky / cents). Never a float. Floats silently
 *     corrupt years of data — 0.1 + 0.2 !== 0.3 — and there is no way to notice until a
 *     reconciliation fails.
 *
 *  2. Stored amounts are always positive magnitudes. Direction is derived from the
 *     transaction's `kind`, by {@link signedMinor}. Storing signed amounts *and* a kind
 *     field means every call site has to remember which one is authoritative, and one of
 *     them eventually double-negates.
 */

export type TxKind = "expense" | "income" | "transfer";

/** A branded integer, so a float can't be passed where minor units are expected. */
export type Minor = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertMinor(value: number, label = "amount"): Minor {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} is outside the safe integer range: ${value}`);
  }
  return value;
}

export function assertPositiveMinor(value: number, label = "amount"): Minor {
  assertMinor(value, label);
  if (value < 0) {
    throw new MoneyError(`${label} must be a positive magnitude, got ${value}`);
  }
  return value;
}

/**
 * Direction of a transaction in cashflow terms: expenses reduce, income increases.
 *
 * Transfers return 0 deliberately. A transfer moves money between the household's own
 * accounts, so it is neither income nor expense — counting it as either double-counts and is
 * the classic way a budget report ends up wrong. Account balances handle transfers
 * separately, via {@link accountDelta}.
 */
export function signedMinor(kind: TxKind, amountMinor: Minor): Minor {
  assertPositiveMinor(amountMinor);
  switch (kind) {
    case "expense":
      return -amountMinor;
    case "income":
      return amountMinor;
    case "transfer":
      return 0;
  }
}

export interface AccountLegs {
  kind: TxKind;
  accountId: string;
  amountMinor: Minor;
  toAccountId?: string | null;
  /** Destination leg for transfers. Cross-currency transfers set this explicitly. */
  toAmountMinor?: Minor | null;
}

/**
 * How a transaction changes one specific account's balance.
 *
 * A transfer's two legs are stored explicitly rather than derived from an FX rate, so a
 * UAH -> EUR move leaves both balances exactly right with no rounding drift.
 */
export function accountDelta(tx: AccountLegs, accountId: string): Minor {
  let delta = 0;

  if (tx.accountId === accountId) {
    // The source leg leaves this account for expenses and transfers, and arrives for income.
    delta += tx.kind === "income" ? tx.amountMinor : -tx.amountMinor;
  }

  if (tx.kind === "transfer" && tx.toAccountId === accountId) {
    // Falls back to the source amount for same-currency transfers, where the destination
    // leg is redundant and may be left unset.
    delta += tx.toAmountMinor ?? tx.amountMinor;
  }

  return delta;
}

/** Sums minor-unit amounts, asserting each is an integer so a stray float can't slip in. */
export function sumMinor(values: readonly number[]): Minor {
  let total = 0;
  for (const value of values) total += assertMinor(value);
  return total;
}

/**
 * Converts an amount to base currency at a given rate, rounding half-away-from-zero.
 *
 * This is the one place a float legitimately meets money, so it is also the only place
 * rounding happens. `Math.round` alone rounds -0.5 to 0 (half-up, not half-away-from-zero),
 * which biases negative amounts; the magnitude is rounded and the sign reapplied instead.
 */
export function convertMinor(
  amountMinor: Minor,
  rate: number,
  from: Currency,
  to: Currency,
): Minor {
  assertMinor(amountMinor);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MoneyError(`FX rate must be a positive finite number, got ${rate}`);
  }
  if (from === to) return amountMinor;

  const scaled = (amountMinor * rate * minorUnitScale(to)) / minorUnitScale(from);
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

/**
 * Parses user input in major units ("1 240,50", "1240.5", "-8.29") into minor units.
 *
 * Uses decimal string arithmetic on BigInt rather than `Number(x) * 100`, because that
 * multiplication is exactly the drift this module exists to prevent: `1.15 * 100` is
 * `114.99999999999999` and `1.005 * 100` is `100.49999999999999`, so a float path rounds
 * some inputs to the wrong kopiyka. No float is involved at any point here.
 */
export function parseMajorToMinor(input: string, currency: Currency): Minor {
  // \s covers ordinary and no-break spaces; the class adds thin and narrow no-break,
  // all of which appear as group separators in Ukrainian number formatting.
  const normalised = input.replace(/[\s\u00a0\u2009\u202f]/g, "").replace(",", ".");

  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalised)) {
    throw new MoneyError(`Cannot parse "${input}" as an amount`);
  }
  const negative = normalised.startsWith("-");
  const unsigned = negative ? normalised.slice(1) : normalised;
  const [intPart = "0", fracPart = ""] = unsigned.split(".");

  const digits = minorUnitDigits(currency);
  const scale = BigInt(minorUnitScale(currency));

  // Keep the significant fraction digits; the next one decides rounding.
  const kept = fracPart.slice(0, digits).padEnd(digits, "0");
  const nextDigit = fracPart[digits];
  const roundUp = nextDigit !== undefined && Number(nextDigit) >= 5;

  let total = BigInt(intPart || "0") * scale + BigInt(kept || "0");
  if (roundUp) total += 1n; // half away from zero — the sign is applied afterwards
  if (negative) total = -total;

  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`Amount "${input}" is outside the safe integer range`);
  }
  return Number(total);
}

/** Minor units back to a plain major-unit number, for formatting only. */
export function minorToMajor(amountMinor: Minor, currency: Currency): number {
  assertMinor(amountMinor);
  return amountMinor / minorUnitScale(currency);
}
