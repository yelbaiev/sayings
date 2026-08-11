import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  householdCurrencies,
  needsCurrencySetup,
  setHouseholdCurrencies,
} from "../../worker/db";
import { quotedCurrencies } from "../../worker/fx";
import { handleSync } from "../../worker/sync";
import { accountRow, resetHousehold, testMember, txRow } from "./helpers";

/**
 * That the base currency is read from the database rather than compiled into the build.
 *
 * The whole point of the phase, and the one thing no other test could show: every existing test
 * passes with a hardcoded 'UAH' because that is what this household uses. The assertions here fail
 * if the constant comes back, because they change the stored value and expect the answer to follow.
 */

beforeEach(async () => {
  await resetHousehold();
  await env.DB.prepare(
    `UPDATE households SET base_currency = 'UAH', enabled_currencies = '["UAH","EUR","USD"]'
      WHERE id = 'hh_default'`,
  ).run();
});

async function setConfig(base: string, enabled: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE households SET base_currency = ?, enabled_currencies = ? WHERE id = 'hh_default'`,
  )
    .bind(base, enabled)
    .run();
}

describe("householdCurrencies", () => {
  it("returns what the household stored", async () => {
    await setConfig("EUR", '["EUR","CHF"]');
    expect(await householdCurrencies(env.DB)).toEqual({ base: "EUR", enabled: ["CHF", "EUR"] });
  });

  it("includes the base even when the stored list omits it", async () => {
    // A household that cannot record a transaction in the currency it reports in has no working
    // state, so this is repaired on read rather than trusted.
    await setConfig("JPY", '["USD"]');
    expect(await householdCurrencies(env.DB)).toEqual({ base: "JPY", enabled: ["JPY", "USD"] });
  });

  it("degrades to the base alone rather than throwing on unreadable JSON", async () => {
    /*
     * This sits on the path that decides whether the app starts at all. A column left malformed by
     * an older version or a hand-run statement must produce a usable configuration, not a login
     * that fails with a parse error.
     */
    await setConfig("GBP", "not json at all");
    expect(await householdCurrencies(env.DB)).toEqual({ base: "GBP", enabled: ["GBP"] });
  });

  it("drops codes it does not recognise", async () => {
    await setConfig("UAH", '["EUR","XYZ",42,null]');
    expect(await householdCurrencies(env.DB)).toEqual({ base: "UAH", enabled: ["EUR", "UAH"] });
  });

  it("falls back to hryvnia when the base itself is unrecognised", async () => {
    await setConfig("NOPE", '["EUR"]');
    expect(await householdCurrencies(env.DB)).toEqual({ base: "UAH", enabled: ["EUR", "UAH"] });
  });
});

describe("which currencies get a nightly rate", () => {
  it("asks for the enabled set, minus the base", async () => {
    await setConfig("UAH", '["UAH","EUR","USD"]');
    expect((await quotedCurrencies(env.DB)).quoted).toEqual(["EUR", "USD"]);
  });

  it("follows the base, so a euro household stops fetching euro rates", async () => {
    // The failure a compiled-in base would produce: fetching a rate for the currency everything is
    // already denominated in, and none for the one it now needs.
    await setConfig("EUR", '["EUR","UAH"]');
    expect((await quotedCurrencies(env.DB)).quoted).toEqual(["UAH"]);
  });

  it("covers a currency an account still holds after being disabled", async () => {
    // An account outlives the setting that allowed it. Dropping its rate would leave its balance
    // permanently unconvertible.
    await setConfig("UAH", '["UAH"]');
    await handleSync(env.DB, testMember, {
      since: 0,
      changes: [{ table: "accounts", row: accountRow({ id: "acc_chf", currency: "CHF" }) }],
    });
    expect((await quotedCurrencies(env.DB)).quoted).toEqual(["CHF"]);
  });

  it("covers a currency only a historical transaction used", async () => {
    await setConfig("UAH", '["UAH"]');
    await handleSync(env.DB, testMember, {
      since: 0,
      changes: [
        { table: "accounts", row: accountRow() },
        { table: "transactions", row: txRow({ id: "tx_gbp", currency: "GBP" }) },
      ],
    });
    expect((await quotedCurrencies(env.DB)).quoted).toEqual(["GBP"]);
  });

  it("asks for nothing when the household uses only its base", async () => {
    /*
     * Not a curiosity — it is the guard on the write volume. Deriving this from the supported list
     * would ask for forty-two rates a night, and turn a five-year backfill into ~84,000 writes
     * against a 100,000-a-day ceiling.
     */
    await setConfig("UAH", '["UAH"]');
    expect((await quotedCurrencies(env.DB)).quoted).toEqual([]);
  });

  it("never asks for something no source quotes", async () => {
    // The enabled list is validated on read, so a junk code cannot reach an upstream as a query.
    await setConfig("UAH", '["UAH","ZZZ"]');
    expect((await quotedCurrencies(env.DB)).quoted).toEqual([]);
  });
});

describe("setHouseholdCurrencies", () => {
  it("stores the choice and normalises the list", async () => {
    const saved = await setHouseholdCurrencies(env.DB, { base: "EUR", enabled: ["USD", "USD"] });
    expect(saved).toEqual({ base: "EUR", enabled: ["EUR", "USD"] });
    expect(await householdCurrencies(env.DB)).toEqual({ base: "EUR", enabled: ["EUR", "USD"] });
  });

  it("refuses a base it cannot price or scale", async () => {
    /*
     * Validated on the way in, not on the way out. This row decides how every stored amount is
     * interpreted, and an unrecognised code would not fail loudly — it would index into the
     * minor-unit table with undefined and turn amounts into NaN wherever they were formatted.
     */
    await expect(
      setHouseholdCurrencies(env.DB, { base: "XYZ", enabled: ["EUR"] }),
    ).rejects.toThrow(/XYZ/);
    // And left the previous configuration alone rather than half-applying.
    expect((await householdCurrencies(env.DB)).base).toBe("UAH");
  });
});

describe("first-run setup", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM app_meta WHERE key = 'currency_setup'`).run();
  });

  it("is needed on an installation with nothing recorded and no answer", async () => {
    expect(await needsCurrencySetup(env.DB)).toBe(true);
  });

  it("is not needed again once answered, even if the answer matched the defaults", async () => {
    // The reason the marker exists at all: the column default has to describe the installation being
    // upgraded, which makes "never chosen" indistinguishable from "chose exactly that".
    await setHouseholdCurrencies(env.DB, { base: "UAH", enabled: ["UAH", "EUR", "USD"] });
    expect(await needsCurrencySetup(env.DB)).toBe(false);
  });

  it("is not needed on an upgrade, which has no marker but has history", async () => {
    /*
     * The case that would be a disaster: an existing household shown a first-run screen and invited
     * to pick a base for a ledger it has already kept for years.
     */
    await handleSync(env.DB, testMember, {
      since: 0,
      changes: [
        { table: "accounts", row: accountRow() },
        { table: "transactions", row: txRow({ id: "tx_old" }) },
      ],
    });
    expect(await needsCurrencySetup(env.DB)).toBe(false);
  });
});
