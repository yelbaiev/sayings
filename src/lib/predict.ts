import type { Transaction } from "@shared/schema";

/**
 * Entry-screen prediction: which account a new transaction starts on, and whether the other
 * person may have already logged it. Pure functions over the local rows.
 *
 * Category *ranking* used to live here too, feeding the six quick tiles. It retired with the
 * tiles: the picker sheet shows every category in seeded order, because a grid whose tiles
 * hold still is what lets a finger learn where they are.
 */

/**
 * Finds a transaction the other person may have already logged.
 *
 * Two people sharing one ledger routinely both log the weekly shop. Catching it costs one
 * tap; missing it silently inflates the month. A false positive must never block the save,
 * so this only ever produces a warning.
 */
export interface DuplicateCandidate {
  transaction: Transaction;
  memberId: string;
}

export function findLikelyDuplicate(
  transactions: Transaction[],
  candidate: {
    categoryId: string | null;
    amountMinor: number;
    occurredOn: string;
    authorId: string;
  },
  now = Date.now(),
): DuplicateCandidate | null {
  const SIX_HOURS = 6 * 3_600_000;
  const TOLERANCE = 0.02;

  for (const tx of transactions) {
    // Only the *other* person's entries. Logging the same amount twice yourself is usually
    // deliberate — two coffees, two metro rides.
    if (tx.updated_by === candidate.authorId) continue;
    if (tx.category_id !== candidate.categoryId) continue;
    if (tx.occurred_on !== candidate.occurredOn) continue;
    if (now - tx.updated_at > SIX_HOURS) continue;

    const delta = Math.abs(tx.amount_minor - candidate.amountMinor);
    const allowed = Math.max(candidate.amountMinor * TOLERANCE, 1);
    if (delta <= allowed) return { transaction: tx, memberId: tx.updated_by ?? "" };
  }

  return null;
}

/* -------------------------------------------------------------- account resolution */

export interface AccountResolution {
  /** The account whose transactions the user is currently looking at, if any. */
  contextAccountId?: string | null | undefined;
  categoryId: string | null;
  /** Device memory of the last account used per category. */
  lastByCategory?: Record<string, string> | undefined;
  /** The member's chosen default. */
  defaultAccountId?: string | null | undefined;
  transactions: Transaction[];
  /** Ids that may actually be selected — archived accounts are not offered. */
  availableIds: readonly string[];
}

/**
 * Decides which account a new transaction should start on.
 *
 * The order is most-specific-signal first, and each step matters:
 *
 *  1. **Context.** Adding from an account's own transaction list is an explicit statement of
 *     intent — stronger than any guess, so it wins outright.
 *  2. **This device's memory for the category.** The most recent deliberate pairing: groceries on
 *     the card, money for parents from cash.
 *  3. **History for the category**, for a device that has no memory yet but a synced ledger that
 *     does.
 *  4. **The member's default**, which is a preference rather than evidence, so it yields to both.
 *  5. Most recently used overall, then simply the first available.
 *
 * Every candidate is checked against `availableIds`, so a deleted or archived account can never
 * be preselected.
 */
export function resolveAccountId(input: AccountResolution): string | null {
  const available = new Set(input.availableIds);
  const usable = (id: string | null | undefined): string | null =>
    id && available.has(id) ? id : null;

  const fromContext = usable(input.contextAccountId);
  if (fromContext) return fromContext;

  const remembered = input.categoryId
    ? usable(input.lastByCategory?.[input.categoryId])
    : null;
  if (remembered) return remembered;

  const fromHistory = usable(
    predictAccountForCategory(input.transactions, input.categoryId),
  );
  if (fromHistory) return fromHistory;

  const fromDefault = usable(input.defaultAccountId);
  if (fromDefault) return fromDefault;

  const mostRecent = usable(mostRecentlyUsedAccount(input.transactions));
  if (mostRecent) return mostRecent;

  return input.availableIds[0] ?? null;
}

/** Most recent account for one category, ignoring the overall fallback. */
function predictAccountForCategory(
  transactions: Transaction[],
  categoryId: string | null,
): string | null {
  if (!categoryId) return null;
  let best: Transaction | null = null;
  for (const tx of transactions) {
    if (tx.category_id !== categoryId) continue;
    if (!best || tx.occurred_on > best.occurred_on || tx.updated_at > best.updated_at) best = tx;
  }
  return best?.account_id ?? null;
}

function mostRecentlyUsedAccount(transactions: Transaction[]): string | null {
  let latest: Transaction | null = null;
  for (const tx of transactions) {
    if (!latest || tx.updated_at > latest.updated_at) latest = tx;
  }
  return latest?.account_id ?? null;
}
