import type { Transaction } from "@shared/schema";
import { describe, expect, it } from "vitest";
import { matchesFilters } from "~/db/queries";

/**
 * The History filters that are not plain equality on one column.
 */

const tx = (patch: Partial<Transaction>) =>
  ({ kind: "expense", occurred_on: "2026-09-01", account_id: "a", ...patch }) as Transaction;

describe("matchesFilters", () => {
  it("filters a member by who entered the row, not who last edited it", () => {
    // Lena entered it, Serhii fixed a typo. The member filter, like the avatar, says Lena.
    const row = tx({ created_by: "lena", updated_by: "serhii" });
    expect(matchesFilters(row, { memberId: "lena" })).toBe(true);
    expect(matchesFilters(row, { memberId: "serhii" })).toBe(false);
  });

  it("falls back to updated_by for rows older than created_by", () => {
    expect(matchesFilters(tx({ updated_by: "serhii" }), { memberId: "serhii" })).toBe(true);
  });

  it("narrows to one whole side for 'All income' / 'All expenses'", () => {
    expect(matchesFilters(tx({ kind: "income" }), { kind: "income" })).toBe(true);
    expect(matchesFilters(tx({ kind: "expense" }), { kind: "income" })).toBe(false);
    expect(matchesFilters(tx({ kind: "transfer" }), { kind: "expense" })).toBe(false);
  });
});
