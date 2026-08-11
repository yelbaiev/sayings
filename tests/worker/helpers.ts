import { env } from "cloudflare:test";
import type { MemberRecord } from "../../worker/db";

/**
 * Returns the database to its freshly-seeded state.
 *
 * Called from `beforeEach` rather than relying on the pool's storage isolation, which this
 * version does not roll back between tests. Without it every test in a file inherits the
 * previous one's rows and the suite becomes order-dependent — which is how a passing test
 * suite stops meaning anything.
 *
 * Seeded reference data (households, categories, fx_rates) is left in place; the sequence is
 * reset to 1 to match a fresh install, where the seed rows sit at rev 1.
 */
export async function resetHousehold(): Promise<void> {
  await env.DB.batch([
    // Auth tables first: they hold foreign keys into members, and deleting members underneath
    // them is a constraint failure that reads as a flake in whichever test runs second.
    env.DB.prepare(`DELETE FROM credentials`),
    env.DB.prepare(`DELETE FROM auth_sessions`),
    env.DB.prepare(`DELETE FROM invites`),
    env.DB.prepare(`DELETE FROM auth_challenges`),
    env.DB.prepare(`DELETE FROM transactions`),
    env.DB.prepare(`DELETE FROM accounts`),
    env.DB.prepare(`DELETE FROM budgets`),
    env.DB.prepare(`DELETE FROM recurring`),
    env.DB.prepare(`DELETE FROM quick_tiles`),
    env.DB.prepare(`DELETE FROM members`),
    env.DB.prepare(`DELETE FROM backups`),
    env.DB.prepare(`UPDATE categories SET rev = 1, deleted = 0, archived = 0`),
    env.DB.prepare(`UPDATE household_seq SET rev = 1 WHERE household_id = 'hh_default'`),
  ]);
}

export const testMember: MemberRecord = {
  id: "mem_test",
  household_id: "hh_default",
  email: "test@example.com",
  display_name: "Test",
  locale: "en",
  role: "owner",
};

export const otherMember: MemberRecord = {
  ...testMember,
  id: "mem_other",
  email: "other@example.com",
  display_name: "Other",
  role: "member",
};

/**
 * A valid transaction row, with overrides for whatever the test is actually about.
 *
 * `base_amount_minor` follows `amount_minor` unless overridden explicitly. Hardcoding it
 * independently made every fixture with a custom amount internally inconsistent — the
 * transaction said one thing and its base-currency figure said another, which quietly broke
 * any test that summed base amounts.
 */
export function txRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const amount = (overrides.amount_minor as number | undefined) ?? 124_000;
  return {
    id: crypto.randomUUID(),
    household_id: "hh_default",
    kind: "expense",
    occurred_on: "2026-08-05",
    account_id: "acc_mono",
    category_id: "cat_groceries",
    currency: "UAH",
    fx_rate: 1,
    fx_estimated: 0,
    rev: 0,
    updated_at: 1_780_000_000_000,
    deleted: 0,
    ...overrides,
    amount_minor: amount,
    base_amount_minor: (overrides.base_amount_minor as number | undefined) ?? amount,
  };
}

export function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "acc_mono",
    household_id: "hh_default",
    name: "Mono",
    type: "debit_card",
    currency: "UAH",
    opening_balance_minor: 0,
    icon: "💳",
    color: "#3E63DD",
    exclude_from_totals: 0,
    archived: 0,
    sort_order: 1,
    rev: 0,
    updated_at: 1_780_000_000_000,
    deleted: 0,
    ...overrides,
  };
}
