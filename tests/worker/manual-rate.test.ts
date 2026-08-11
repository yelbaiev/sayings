import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { reconcileEstimatedRates } from "../../worker/fx";
import { handleSync } from "../../worker/sync";
import { accountRow, resetHousehold, testMember, txRow } from "./helpers";

/**
 * That a hand-entered rate survives the nightly reconcile.
 *
 * This is the regression that would otherwise be invisible. `reconcileEstimatedRates` re-prices rows
 * recorded without a rate, which is right — losing an entry to a missing rate would be far worse than
 * an approximate figure. But for a household ledger the rate that matters is the one the bank actually
 * used, and a person who typed it in has stated a fact, not a placeholder. Re-pricing that from a
 * central bank's reference rate produces no error and no log line: the number simply drifts back
 * overnight, and the only way to notice is to have written down what it was.
 *
 * So the assertion is deliberately dull — nothing changed — and it is the most valuable one here.
 */

/** A euro purchase whose rate the person corrected to match their statement. */
const MANUAL_RATE = 52.4;
const AMOUNT_MINOR = 10_000; // €100.00

beforeEach(async () => {
  await resetHousehold();
  await env.DB.prepare(`DELETE FROM fx_rates`).run();
  await handleSync(env.DB, testMember, {
    since: 0,
    changes: [{ table: "accounts", row: accountRow({ id: "acc_eur", currency: "EUR" }) }],
  });
});

async function seedRate(onDate: string, quote: string, rate: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO fx_rates (on_date, quote, rate, source, base) VALUES (?, ?, ?, 'nbu', 'UAH')`,
  )
    .bind(onDate, quote, rate)
    .run();
}

async function saveTx(overrides: Record<string, unknown>): Promise<void> {
  await handleSync(env.DB, testMember, {
    since: 0,
    changes: [
      {
        table: "transactions",
        row: txRow({
          id: "tx_eur",
          account_id: "acc_eur",
          currency: "EUR",
          amount_minor: AMOUNT_MINOR,
          occurred_on: "2026-08-04",
          ...overrides,
        }),
      },
    ],
  });
}

async function read(): Promise<{ base_amount_minor: number; fx_rate: number; fx_source: string }> {
  return (await env.DB.prepare(
    `SELECT base_amount_minor, fx_rate, fx_source FROM transactions WHERE id = 'tx_eur'`,
  ).first())!;
}

describe("reconcileEstimatedRates", () => {
  it("leaves a manual rate exactly as it was", async () => {
    await saveTx({
      fx_rate: MANUAL_RATE,
      fx_estimated: 1,
      fx_source: "manual",
      base_amount_minor: Math.round(AMOUNT_MINOR * MANUAL_RATE),
    });
    // A published rate arrives that disagrees with the bank's.
    await seedRate("2026-08-04", "EUR", 51.6423);

    const fixed = await reconcileEstimatedRates(env.DB);
    const row = await read();

    expect(fixed).toBe(0);
    expect(row.fx_rate).toBe(MANUAL_RATE);
    expect(row.base_amount_minor).toBe(Math.round(AMOUNT_MINOR * MANUAL_RATE));
    expect(row.fx_source).toBe("manual");
  });

  it("still repairs one recorded with no rate at all", async () => {
    // The job's actual purpose, and the reason it cannot simply be switched off.
    await saveTx({
      fx_rate: 1,
      fx_estimated: 1,
      fx_source: "estimated",
      base_amount_minor: AMOUNT_MINOR,
    });
    await seedRate("2026-08-04", "EUR", 51.6423);

    expect(await reconcileEstimatedRates(env.DB)).toBe(1);
    const row = await read();
    expect(row.fx_rate).toBeCloseTo(51.6423, 4);
    expect(row.base_amount_minor).toBe(Math.round(AMOUNT_MINOR * 51.6423));
    expect(row.fx_source).toBe("auto");
  });

  it("repairs a row from an older client, which sets the flag but not the column", async () => {
    /*
     * Every installation is self-hosted and updates when its owner feels like it, so a phone can serve
     * a cached build for weeks after the Worker is new. Those rows carry `fx_estimated = 1` and no
     * `fx_source`, and must still be repaired rather than mistaken for deliberate corrections.
     */
    await saveTx({ fx_rate: 1, fx_estimated: 1, base_amount_minor: AMOUNT_MINOR });
    await env.DB.prepare(`UPDATE transactions SET fx_source = 'auto' WHERE id = 'tx_eur'`).run();
    await seedRate("2026-08-04", "EUR", 51.6423);

    expect(await reconcileEstimatedRates(env.DB)).toBe(1);
    expect((await read()).fx_rate).toBeCloseTo(51.6423, 4);
  });

  it("uses the nearest prior rate, because the source may not publish that day", async () => {
    await saveTx({
      fx_rate: 1,
      fx_estimated: 1,
      fx_source: "estimated",
      base_amount_minor: AMOUNT_MINOR,
    });
    // Friday's rate for a Sunday transaction: the applicable rate genuinely is Friday's.
    await seedRate("2026-08-01", "EUR", 51.0);

    expect(await reconcileEstimatedRates(env.DB)).toBe(1);
    expect((await read()).fx_rate).toBeCloseTo(51.0, 4);
  });

  it("leaves a row alone while no rate exists for it yet", async () => {
    await saveTx({
      fx_rate: 1,
      fx_estimated: 1,
      fx_source: "estimated",
      base_amount_minor: AMOUNT_MINOR,
    });

    expect(await reconcileEstimatedRates(env.DB)).toBe(0);
    expect((await read()).fx_source).toBe("estimated");
  });
});
