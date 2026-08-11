import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { currentRev, householdCurrencies } from "../../worker/db";
import { repriceToBase } from "../../worker/reprice";
import { handleSync } from "../../worker/sync";
import { accountRow, resetHousehold, testMember, txRow } from "./helpers";

/**
 * Changing the reporting currency, against a real database.
 *
 * The property that matters most here is the one that is easiest to lose: **account balances do not
 * move.** They are held in each account's own currency and are reconciled against real cards, so a
 * base change that shifted them would put the app permanently out of step with a bank statement and
 * there would be nothing to compare against to notice. What moves is the reporting roll-up.
 *
 * The second property is that running it twice does nothing the second time. Converting a row twice
 * would not fail — it would multiply by a rate again and leave a plausible figure in a ledger — so
 * idempotency here is not hygiene, it is the difference between a resumable operation and a corrupted
 * one.
 *
 * Rates are hryvnia-per-unit on 2026-08-04, the figures NBU actually published.
 */

const UAH_PER_USD = 44.7876;
const UAH_PER_EUR = 51.6423;
/** 44.7876 / 51.6423, worked out separately rather than derived by the code under test. */
const EUR_PER_USD = 0.86726579;

beforeEach(async () => {
  await resetHousehold();
  await env.DB.prepare(`DELETE FROM fx_rates`).run();
  await env.DB.prepare(`DELETE FROM app_meta WHERE key = 'reprice_from'`).run();
  await env.DB.prepare(
    `UPDATE households SET base_currency = 'UAH', enabled_currencies = '["UAH","EUR","USD"]'
      WHERE id = 'hh_default'`,
  ).run();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES ('2026-08-04', 'USD', ?, 'nbu', 'UAH')`,
    ).bind(UAH_PER_USD),
    env.DB.prepare(
      `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES ('2026-08-04', 'EUR', ?, 'nbu', 'UAH')`,
    ).bind(UAH_PER_EUR),
  ]);

  await handleSync(env.DB, testMember, {
    since: 0,
    changes: [
      { table: "accounts", row: accountRow({ id: "acc_uah", currency: "UAH" }) },
      { table: "accounts", row: accountRow({ id: "acc_eur", currency: "EUR" }) },
      { table: "accounts", row: accountRow({ id: "acc_usd", currency: "USD" }) },
    ],
  });
});

async function addTx(row: Record<string, unknown>): Promise<void> {
  await handleSync(env.DB, testMember, {
    since: 0,
    changes: [{ table: "transactions", row: txRow({ occurred_on: "2026-08-04", ...row }) }],
  });
}

async function readTx(id: string) {
  return (await env.DB.prepare(
    `SELECT amount_minor, base_amount_minor, fx_rate, fx_base, fx_source, currency
       FROM transactions WHERE id = ?`,
  )
    .bind(id)
    .first<{
      amount_minor: number;
      base_amount_minor: number;
      fx_rate: number;
      fx_base: string;
      fx_source: string | null;
      currency: string;
    }>())!;
}

describe("changing the reporting currency", () => {
  it("never touches the amount in the account's own currency", async () => {
    /*
     * The assertion this whole file exists for. `amount_minor` is what the card was actually charged;
     * a base change is a reporting decision and must not reach it.
     */
    await addTx({
      id: "tx_usd",
      account_id: "acc_usd",
      currency: "USD",
      amount_minor: 10_000,
      fx_rate: UAH_PER_USD,
      base_amount_minor: Math.round(10_000 * UAH_PER_USD),
    });

    await repriceToBase(env.DB, "EUR");

    const row = await readTx("tx_usd");
    expect(row.amount_minor).toBe(10_000);
    expect(row.currency).toBe("USD");
  });

  it("leaves opening balances alone", async () => {
    // Same reason, for the figure a household typed in from a statement when it set the account up.
    const before = await env.DB.prepare(
      `SELECT id, opening_balance_minor, currency FROM accounts ORDER BY id`,
    ).all();
    await repriceToBase(env.DB, "EUR");
    const after = await env.DB.prepare(
      `SELECT id, opening_balance_minor, currency FROM accounts ORDER BY id`,
    ).all();
    expect(after.results).toEqual(before.results);
  });

  it("re-prices a dollar transaction into euro at that date's cross rate", async () => {
    await addTx({
      id: "tx_usd",
      account_id: "acc_usd",
      currency: "USD",
      amount_minor: 10_000,
      fx_rate: UAH_PER_USD,
      base_amount_minor: Math.round(10_000 * UAH_PER_USD),
    });

    await repriceToBase(env.DB, "EUR");

    const row = await readTx("tx_usd");
    expect(row.fx_base).toBe("EUR");
    expect(row.fx_rate).toBeCloseTo(EUR_PER_USD, 5);
    expect(row.base_amount_minor).toBe(Math.round(10_000 * EUR_PER_USD));
  });

  it("prices a transaction in the new base at exactly 1", async () => {
    await addTx({
      id: "tx_eur",
      account_id: "acc_eur",
      currency: "EUR",
      amount_minor: 5_000,
      fx_rate: UAH_PER_EUR,
      base_amount_minor: Math.round(5_000 * UAH_PER_EUR),
    });

    await repriceToBase(env.DB, "EUR");

    const row = await readTx("tx_eur");
    expect(row.fx_rate).toBe(1);
    expect(row.base_amount_minor).toBe(5_000);
  });

  it("prices a transaction in the old base at the reciprocal", async () => {
    // Hryvnia stops being the base and becomes an ordinary quoted currency: 1 / 51.6423 euro each.
    await addTx({
      id: "tx_uah",
      account_id: "acc_uah",
      currency: "UAH",
      amount_minor: 100_000,
      fx_rate: 1,
      base_amount_minor: 100_000,
    });

    await repriceToBase(env.DB, "EUR");

    const row = await readTx("tx_uah");
    expect(row.fx_rate).toBeCloseTo(1 / UAH_PER_EUR, 8);
    expect(row.base_amount_minor).toBe(Math.round(100_000 / UAH_PER_EUR));
  });

  it("carries a hand-entered rate across instead of discarding it", async () => {
    /*
     * Someone typed 45.5 hryvnia per dollar because that is what their card charged, rather than the
     * reference 44.7876. That fact survives a change of reporting currency: the same rate expressed in
     * euro is 45.5 / 51.6423, which stays *above* the reference cross-rate — the bank's margin is
     * preserved. Substituting the reference rate would silently undo a correction made against a
     * statement, and the amount would still look plausible.
     */
    const manual = 45.5;
    await addTx({
      id: "tx_manual",
      account_id: "acc_usd",
      currency: "USD",
      amount_minor: 10_000,
      fx_rate: manual,
      fx_source: "manual",
      base_amount_minor: Math.round(10_000 * manual),
    });

    await repriceToBase(env.DB, "EUR");

    const row = await readTx("tx_manual");
    expect(row.fx_source).toBe("manual");
    expect(row.fx_rate).toBeCloseTo(manual / UAH_PER_EUR, 6);
    expect(row.base_amount_minor).toBe(Math.round(10_000 * (manual / UAH_PER_EUR)));
    // Still worse than the reference, which is the whole reason it was typed in.
    expect(row.fx_rate).toBeGreaterThan(EUR_PER_USD);
  });

  it("drops a hand-entered rate that has become meaningless", async () => {
    /*
     * A manual rate on a transaction whose currency *is* the new base has nothing left to correct: a
     * €100 purchase in a euro-reporting household is €100, exactly. Carrying the old figure across
     * would apply a hryvnia-era conversion to an amount that no longer needs converting.
     */
    await addTx({
      id: "tx_eur_manual",
      account_id: "acc_eur",
      currency: "EUR",
      amount_minor: 10_000,
      fx_rate: 52.4,
      fx_source: "manual",
      base_amount_minor: Math.round(10_000 * 52.4),
    });

    await repriceToBase(env.DB, "EUR");

    const row = await readTx("tx_eur_manual");
    expect(row.fx_rate).toBe(1);
    expect(row.base_amount_minor).toBe(10_000);
  });

  it("does nothing the second time", async () => {
    await addTx({
      id: "tx_usd",
      account_id: "acc_usd",
      currency: "USD",
      amount_minor: 10_000,
      fx_rate: UAH_PER_USD,
      base_amount_minor: Math.round(10_000 * UAH_PER_USD),
    });

    const first = await repriceToBase(env.DB, "EUR");
    const afterFirst = await readTx("tx_usd");

    const second = await repriceToBase(env.DB, "EUR");
    const afterSecond = await readTx("tx_usd");

    expect(first.transactions).toBe(1);
    expect(second.transactions).toBe(0);
    expect(second.remaining).toBe(0);
    // The figure, not just the count: a second conversion would multiply by the rate again.
    expect(afterSecond).toEqual(afterFirst);
  });

  it("finishes an interrupted run, using the base it was converting from", async () => {
    /*
     * The reason the old base is written to app_meta. A resumed call cannot read it from the household
     * — the first call already switched that — and without it the conversion would still find rows and
     * still produce plausible figures, which is the worst failure this operation has available.
     */
    await addTx({
      id: "tx_usd",
      account_id: "acc_usd",
      currency: "USD",
      amount_minor: 10_000,
      fx_rate: UAH_PER_USD,
      base_amount_minor: Math.round(10_000 * UAH_PER_USD),
    });

    await repriceToBase(env.DB, "EUR");
    // Simulate an interruption: the household is switched, one row was missed.
    await env.DB.prepare(`UPDATE transactions SET fx_base = 'UAH' WHERE id = 'tx_usd'`).run();
    await env.DB.prepare(
      `INSERT INTO app_meta (key, value, updated_at) VALUES ('reprice_from', 'UAH', 0)
         ON CONFLICT(key) DO UPDATE SET value = 'UAH'`,
    ).run();

    const resumed = await repriceToBase(env.DB, "EUR");
    expect(resumed.transactions).toBe(1);
    expect(resumed.remaining).toBe(0);

    const row = await readTx("tx_usd");
    expect(row.fx_rate).toBeCloseTo(EUR_PER_USD, 5);
  });

  it("switches the household and enables the new base", async () => {
    await repriceToBase(env.DB, "CHF");
    const config = await householdCurrencies(env.DB);
    expect(config.base).toBe("CHF");
    expect(config.enabled).toContain("CHF");
  });

  it("refuses a currency it cannot price or scale", async () => {
    await expect(repriceToBase(env.DB, "XYZ")).rejects.toThrow(/XYZ/);
    expect((await householdCurrencies(env.DB)).base).toBe("UAH");
  });

  it("converts the stored rate table into the new base", async () => {
    await repriceToBase(env.DB, "EUR");

    const { results } = await env.DB.prepare(
      `SELECT quote, rate, base FROM fx_rates WHERE on_date = '2026-08-04' ORDER BY quote`,
    ).all<{ quote: string; rate: number; base: string }>();

    // The euro row is gone — a rate of 1 against itself is not a quote — and hryvnia has taken its
    // place as an ordinary quoted currency.
    expect(results.map((row) => row.quote)).toEqual(["UAH", "USD"]);
    expect(results.every((row) => row.base === "EUR")).toBe(true);
    expect(results.find((row) => row.quote === "USD")!.rate).toBeCloseTo(EUR_PER_USD, 6);
    expect(results.find((row) => row.quote === "UAH")!.rate).toBeCloseTo(1 / UAH_PER_EUR, 8);
  });

  it("reports a date it could not convert rather than guessing", async () => {
    // A date with no quote for the new base cannot be expressed in it. Reported, so the household is
    // told rather than left to notice a month priced from the nearest prior rate.
    await env.DB.prepare(
      `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES ('2026-07-01', 'USD', 44, 'nbu', 'UAH')`,
    ).run();

    const result = await repriceToBase(env.DB, "EUR");
    expect(result.skippedDates).toEqual(["2026-07-01"]);
  });
});

describe("what the client learns about", () => {
  it("bumps the revision, so a mirror is told the figures changed", async () => {
    /*
     * Without this the operation is invisible to every device. Clients pull "everything since rev N",
     * so a re-priced row carrying its old revision is a row no phone will ever hear about — it would go
     * on serving the previous figures from its own mirror, indefinitely, with nothing to indicate they
     * are stale. Reloading the page would not help: the mirror survives a reload.
     */
    await addTx({
      id: "tx_usd",
      account_id: "acc_usd",
      currency: "USD",
      amount_minor: 10_000,
      fx_rate: UAH_PER_USD,
      base_amount_minor: Math.round(10_000 * UAH_PER_USD),
    });

    const before = await currentRev(env.DB);
    await repriceToBase(env.DB, "EUR");
    const after = await currentRev(env.DB);
    expect(after).toBeGreaterThan(before);

    // And the row is actually delivered by a sync from the pre-change cursor.
    const delivered = await handleSync(env.DB, testMember, { since: before, changes: [] });
    const tx = delivered.changes.find(
      (change) => change.table === "transactions" && change.row.id === "tx_usd",
    );
    expect(tx).toBeTruthy();
    expect((tx!.row as { base_amount_minor: number }).base_amount_minor).toBe(
      Math.round(10_000 * EUR_PER_USD),
    );
  });
});
