import { accountDelta, type Minor } from "@shared/money";
import type { Account, Category, Member, QuickTile, Transaction } from "@shared/schema";
import { useLiveQuery } from "dexie-react-hooks";
import { useApp } from "~/app/AppContext";
import { localizedCategoryName } from "~/i18n/categories";
import { db } from "./dexie";

/**
 * Read layer. Every query runs against the local mirror, never the network — which is why
 * there are no loading states anywhere in this app.
 *
 * Reads deliberately filter `deleted` in code rather than relying on an index-only query:
 * soft-deleted rows must stay in the store so their removal can propagate to the other
 * device, but must never be visible to the UI.
 */

const alive = <T extends { deleted: 0 | 1 }>(rows: T[]): T[] => rows.filter((r) => r.deleted === 0);

export function useAccounts(includeArchived = false): Account[] {
  return (
    useLiveQuery(async () => {
      const rows = alive(await db.accounts.toArray());
      return rows
        .filter((a) => includeArchived || a.archived === 0)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    }, [includeArchived]) ?? []
  );
}

export function useAccount(id: string | null): Account | undefined {
  return useLiveQuery(async () => (id ? db.accounts.get(id) : undefined), [id]);
}

export function useCategories(kind?: "expense" | "income", includeArchived = false): Category[] {
  // The seeded categories follow the interface language; renamed and user-created ones are
  // shown as stored. Localized here, at the single door every consumer walks through — rows,
  // pickers, reports, exports — rather than at thirty render sites.
  const { locale } = useApp();
  return (
    useLiveQuery(async () => {
      const rows = alive(await db.categories.toArray());
      return rows
        .filter((c) => (!kind || c.kind === kind) && (includeArchived || c.archived === 0))
        .map((c) => ({ ...c, name: localizedCategoryName(c.id, c.name, locale) }))
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    }, [kind, includeArchived, locale]) ?? []
  );
}

export function useMembers(): Member[] {
  return useLiveQuery(async () => alive(await db.members.toArray())) ?? [];
}

/** Lookup maps, so a list of 200 rows doesn't do 200 table reads. */
export function useLookups(): {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  members: Map<string, Member>;
} {
  const accounts = useAccounts(true);
  const categories = useCategories(undefined, true);
  const members = useMembers();

  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    categories: new Map(categories.map((c) => [c.id, c])),
    members: new Map(members.map((m) => [m.id, m])),
  };
}

export function useQuickTiles(memberId: string): QuickTile[] {
  return (
    useLiveQuery(async () => {
      const rows = alive(await db.quick_tiles.toArray());
      return rows.filter((q) => q.member_id === memberId).sort((a, b) => a.sort_order - b.sort_order);
    }, [memberId]) ?? []
  );
}

/* ---------------------------------------------------------------------- transactions */

export interface TransactionFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  memberId?: string;
  kind?: Transaction["kind"];
  /** Matched against note and payee, case-insensitively. */
  search?: string;
}

export function matchesFilters(tx: Transaction, filters: TransactionFilters): boolean {
  if (filters.from && tx.occurred_on < filters.from) return false;
  if (filters.to && tx.occurred_on > filters.to) return false;
  if (filters.kind && tx.kind !== filters.kind) return false;
  if (filters.categoryId && tx.category_id !== filters.categoryId) return false;
  if (filters.memberId && tx.updated_by !== filters.memberId) return false;

  // An account filter must include transfers *into* that account, or the account's own
  // statement would be missing half its movements.
  if (filters.accountId && tx.account_id !== filters.accountId) {
    if (tx.to_account_id !== filters.accountId) return false;
  }

  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = `${tx.note ?? ""} ${tx.payee ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

/** Newest first, which is the order every list in the app wants. */
export function useTransactions(filters: TransactionFilters = {}): Transaction[] {
  const key = JSON.stringify(filters);
  return (
    useLiveQuery(async () => {
      const rows = alive(await db.transactions.toArray());
      return rows
        .filter((tx) => matchesFilters(tx, filters))
        .sort(
          (a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.updated_at - a.updated_at,
        );
    }, [key]) ?? []
  );
}

export function useTransactionCount(): number {
  return useLiveQuery(async () => alive(await db.transactions.toArray()).length) ?? 0;
}

/**
 * The most recent *real* transaction.
 *
 * Excludes accounts left out of totals, which is where imported summary history lives. Without
 * that filter, repeat-last would offer to repeat a Saldo monthly total onto an archived account,
 * and a new quick tile would prefill from one.
 */
export function useLatestTransaction(): Transaction | undefined {
  return useLiveQuery(async () => {
    const excluded = new Set(
      (await db.accounts.toArray())
        .filter((a) => a.exclude_from_totals === 1)
        .map((a) => a.id),
    );
    const rows = alive(await db.transactions.toArray()).filter(
      (tx) => !excluded.has(tx.account_id),
    );
    return rows.sort((a, b) => b.updated_at - a.updated_at)[0];
  });
}

/* -------------------------------------------------------------------------- balances */

export interface AccountBalance {
  account: Account;
  /** In the account's own currency. */
  native: Minor;
  /** Converted to the household base currency for totals. */
  base: Minor;
}

/**
 * Current balance per account.
 *
 * Derived by summing rather than stored, because a stored balance is a second source of
 * truth that drifts the moment a sync arrives out of order. Summing ~35k rows in memory is
 * a few milliseconds and always correct.
 *
 * The base-currency figure uses each transaction's *own* snapshotted rate, so historical
 * balances do not shift when today's rate moves.
 */
export function computeBalances(
  accounts: Account[],
  transactions: Transaction[],
): AccountBalance[] {
  const native = new Map<string, Minor>();
  for (const account of accounts) native.set(account.id, account.opening_balance_minor);

  for (const tx of transactions) {
    for (const id of [tx.account_id, tx.to_account_id]) {
      if (!id || !native.has(id)) continue;
      const delta = accountDelta(
        {
          kind: tx.kind,
          accountId: tx.account_id,
          amountMinor: tx.amount_minor,
          toAccountId: tx.to_account_id ?? null,
          toAmountMinor: tx.to_amount_minor ?? null,
        },
        id,
      );
      native.set(id, (native.get(id) ?? 0) + delta);
    }
  }

  return accounts.map((account) => {
    const amount = native.get(account.id) ?? 0;
    return {
      account,
      native: amount,
      // Balances are a *current* figure, so today's rate is the right one — unlike a
      // historical report, which must use each transaction's own snapshot.
      base: amount,
    };
  });
}

/**
 * One account's current balance, or null when nothing is selected.
 *
 * Separate from `useBalances` because the caller — the history filter — needs a single figure and
 * only while a card is chosen. Summing every transaction in the household to get it would put a
 * full-table scan behind a dropdown on the one page that already reads 35k rows. Both legs of a
 * transfer are indexed, so this touches only the rows that name this account.
 *
 * The figure ignores the page's filters, deliberately: a balance is what the card holds now, not
 * what the visible slice of history adds up to. The rows come back with it because the same read
 * answers the running-balance column — see src/lib/running-balance.ts — and reading them twice
 * would double the cost of the page's heaviest query.
 */
export interface AccountLedger extends AccountBalance {
  /** Every alive transaction naming this account, in no particular order. */
  rows: Transaction[];
}

export function useAccountLedger(accountId: string | undefined): AccountLedger | null {
  const accounts = useAccounts(true);
  const account = accountId ? accounts.find((a) => a.id === accountId) : undefined;

  const rows =
    useLiveQuery(async () => {
      if (!accountId) return [];
      // Two indexed reads rather than one scan. A transfer names the account on one side or the
      // other, never both, so concatenating cannot double-count it.
      const [out, incoming] = await Promise.all([
        db.transactions.where("account_id").equals(accountId).toArray(),
        db.transactions.where("to_account_id").equals(accountId).toArray(),
      ]);
      return alive([...out, ...incoming]);
    }, [accountId]) ?? [];

  if (!account) return null;
  // One account in, one balance out: `computeBalances` skips every leg naming an account it was
  // not given, which is exactly the arithmetic wanted here.
  const balance = computeBalances([account], rows)[0];
  return balance ? { ...balance, rows } : null;
}

export function useBalances(): AccountBalance[] {
  const accounts = useAccounts(true);
  const transactions = useTransactions();
  return computeBalances(accounts, transactions);
}

/** Whether an account can be hard-deleted, or only archived. */
export function useAccountHasTransactions(accountId: string): boolean {
  return (
    useLiveQuery(async () => {
      const rows = alive(await db.transactions.toArray());
      return rows.some((tx) => tx.account_id === accountId || tx.to_account_id === accountId);
    }, [accountId]) ?? false
  );
}

export function useCategoryTransactionCount(categoryId: string): number {
  return (
    useLiveQuery(async () => {
      const rows = alive(await db.transactions.toArray());
      return rows.filter((tx) => tx.category_id === categoryId).length;
    }, [categoryId]) ?? 0
  );
}

