import { isCurrency, parseEnabledCurrencies, type Currency } from "@shared/currency";
import { HOUSEHOLD_ID, type SyncedTable } from "@shared/schema";
import type { AccessIdentity } from "./auth";

/** Column lists per table, in migration order. Used to build INSERT/UPDATE statements and,
 *  more importantly, to whitelist what a client is allowed to write — a row arriving over
 *  the wire can only ever set these columns. */
export const TABLE_COLUMNS: Record<SyncedTable, readonly string[]> = {
  members: [
    "id",
    "household_id",
    "email",
    "display_name",
    "avatar_color",
    "locale",
    "default_account_id",
    "role",
    "created_at",
    "rev",
    "updated_at",
    "updated_by",
    "deleted",
  ],
  accounts: [
    "id",
    "household_id",
    "name",
    "type",
    "currency",
    "opening_balance_minor",
    "icon",
    "color",
    "exclude_from_totals",
    "archived",
    "sort_order",
    "rev",
    "updated_at",
    "updated_by",
    "deleted",
  ],
  categories: [
    "id",
    "household_id",
    "kind",
    "name",
    "parent_id",
    "icon",
    "color",
    "archived",
    "sort_order",
    "rev",
    "updated_at",
    "updated_by",
    "deleted",
  ],
  transactions: [
    "id",
    "household_id",
    "kind",
    "occurred_on",
    "account_id",
    "to_account_id",
    "category_id",
    "amount_minor",
    "currency",
    "to_amount_minor",
    "to_currency",
    "base_amount_minor",
    "fx_rate",
    "fx_estimated",
    "fx_source",
    "fx_base",
    "created_by",
    "note",
    "payee",
    "tags",
    "split_parent_id",
    "receipt_key",
    "import_hash",
    "rev",
    "updated_at",
    "updated_by",
    "deleted",
  ],
  budgets: [
    "id",
    "household_id",
    "category_id",
    "period_month",
    "amount_minor",
    "currency",
    "rollover",
    "rev",
    "updated_at",
    "updated_by",
    "deleted",
  ],
  recurring: [
    "id",
    "household_id",
    "label",
    "template",
    "cadence",
    "day_of",
    "next_on",
    "active",
    "rev",
    "updated_at",
    "updated_by",
    "deleted",
  ],
  quick_tiles: [
    "id",
    "household_id",
    "member_id",
    "label",
    "template",
    "sort_order",
    "rev",
    "updated_at",
    "updated_by",
    "deleted",
  ],
};

/**
 * Table names are interpolated into SQL below, which is only safe because they come from
 * this fixed set — never from a request. Values are always bound parameters.
 */
function assertKnownTable(table: string): asserts table is SyncedTable {
  if (!Object.prototype.hasOwnProperty.call(TABLE_COLUMNS, table)) {
    throw new Error(`Unknown table: ${table}`);
  }
}

export interface MemberRecord {
  id: string;
  household_id: string;
  email: string;
  display_name: string;
  locale: string;
  default_account_id?: string | null;
  role: string;
}

/**
 * Avatar colours, one per member.
 *
 * Ten, and chosen by a hash of the member id rather than by join order. With four colours and five
 * members the fifth person took the first person's colour, which is worse than it sounds: the avatar
 * is what tells the two of you apart at a glance in a shared list, so a collision does not look like
 * a cosmetic clash — it looks like the other person entered your transaction.
 *
 * A hash also means the colour is stable. Deriving it from a running count made it depend on who
 * signed in first, so restoring a backup in a different order could recolour everybody.
 */
const PALETTE = [
  "#3E63DD",
  "#E93D82",
  "#30A46C",
  "#F76B15",
  "#8E4EC6",
  "#0D9488",
  "#D6409F",
  "#C2410C",
  "#0284C7",
  "#65A30D",
];

/** FNV-1a. Not for security — just a stable spread of ids across the palette. */
export function avatarColorFor(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? PALETTE[0]!;
}

/**
 * Resolves the Access identity to a member row, creating one on first sight.
 *
 * Emails are deliberately not hardcoded in a migration. Cloudflare Access decides who may reach this
 * code at all; anyone who gets through is, by definition, an authorised household member.
 *
 * There is no cap on how many. There used to be one, offered as a backstop against an over-broad
 * Access policy, and it was the wrong shape of protection: it could not tell a household of six from
 * a policy matching a whole domain, so it blocked the legitimate case and merely delayed the other by
 * the time it takes to notice five strangers in the members list. The Access policy is the control —
 * see SECURITY.md, where an `Emails` selector rather than a domain match is now load-bearing rather
 * than advisory.
 */

export async function ensureMember(db: D1Database, identity: AccessIdentity): Promise<MemberRecord> {
  const existing = await db
    .prepare(
      `SELECT id, household_id, email, display_name, locale, default_account_id, role
         FROM members WHERE email = ? AND deleted = 0`,
    )
    .bind(identity.email)
    .first<MemberRecord>();

  if (existing) return existing;

  // Still counted, but only to decide the first member's role: whoever arrives first owns the
  // household, and everyone after is a member.
  const { count } = (await db
    .prepare(`SELECT COUNT(*) AS count FROM members WHERE household_id = ? AND deleted = 0`)
    .bind(HOUSEHOLD_ID)
    .first<{ count: number }>()) ?? { count: 0 };

  const now = Date.now();
  const localPart = identity.email.split("@")[0] ?? identity.email;
  const displayName = localPart.charAt(0).toUpperCase() + localPart.slice(1);
  const member: MemberRecord = {
    id: crypto.randomUUID(),
    household_id: HOUSEHOLD_ID,
    email: identity.email,
    display_name: displayName,
    locale: "en",
    role: count === 0 ? "owner" : "member",
  };

  const rev = await bumpRev(db);
  await db
    .prepare(
      `INSERT INTO members
         (id, household_id, email, display_name, avatar_color, locale, role,
          created_at, rev, updated_at, updated_by, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(
      member.id,
      member.household_id,
      member.email,
      member.display_name,
      avatarColorFor(member.id),
      member.locale,
      member.role,
      now,
      rev,
      now,
      member.id,
    )
    .run();

  return member;
}

/**
 * Allocates the next revision number for the household.
 *
 * `rev` must be strictly increasing and gap-free from a client's perspective: the sync cursor
 * is "give me everything above N", so a row written at a rev a client has already passed
 * would be invisible forever. `UPDATE ... RETURNING` makes the read and the increment one
 * atomic statement, which is what keeps two concurrent writers from sharing a rev.
 */
export async function bumpRev(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`UPDATE household_seq SET rev = rev + 1 WHERE household_id = ? RETURNING rev`)
    .bind(HOUSEHOLD_ID)
    .first<{ rev: number }>();

  if (!row) throw new Error("household_seq row is missing — was the seed migration applied?");
  return row.rev;
}

export async function currentRev(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT rev FROM household_seq WHERE household_id = ?`)
    .bind(HOUSEHOLD_ID)
    .first<{ rev: number }>();
  return row?.rev ?? 0;
}

/** Builds an idempotent whole-row upsert. Only whitelisted columns are ever written. */
export function upsertStatement(
  db: D1Database,
  table: SyncedTable,
  row: Record<string, unknown>,
): D1PreparedStatement {
  assertKnownTable(table);
  const columns = TABLE_COLUMNS[table].filter((c) => c in row);
  const placeholders = columns.map(() => "?").join(", ");
  const assignments = columns
    .filter((c) => c !== "id")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${assignments}`,
    )
    .bind(...columns.map((c) => row[c] ?? null));
}

/** Reads the stored `updated_at` for a row, or null when it does not exist yet. */
export async function existingUpdatedAt(
  db: D1Database,
  table: SyncedTable,
  id: string,
): Promise<number | null> {
  assertKnownTable(table);
  const row = await db
    .prepare(`SELECT updated_at FROM ${table} WHERE id = ? AND household_id = ?`)
    .bind(id, HOUSEHOLD_ID)
    .first<{ updated_at: number }>();
  return row?.updated_at ?? null;
}

/** Reads a full row, used to hand a conflict's winning version back to the client. */
export async function readRow(
  db: D1Database,
  table: SyncedTable,
  id: string,
): Promise<Record<string, unknown> | null> {
  assertKnownTable(table);
  return await db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND household_id = ?`)
    .bind(id, HOUSEHOLD_ID)
    .first<Record<string, unknown>>();
}

/** Rows changed since a cursor, oldest first, capped so one response cannot grow unbounded. */
export async function changesSince(
  db: D1Database,
  table: SyncedTable,
  since: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  assertKnownTable(table);
  const { results } = await db
    .prepare(
      `SELECT * FROM ${table}
        WHERE household_id = ? AND rev > ?
        ORDER BY rev ASC
        LIMIT ?`,
    )
    .bind(HOUSEHOLD_ID, since, limit)
    .all<Record<string, unknown>>();
  return results;
}

/**
 * The household's currency configuration.
 *
 * Read on every `/api/me` rather than cached, because it is one row by primary key and the cost of a
 * stale copy is a client pricing money in the wrong currency.
 */
export async function householdCurrencies(
  db: D1Database,
): Promise<{ base: Currency; enabled: Currency[] }> {
  const row = await db
    .prepare(`SELECT base_currency, enabled_currencies FROM households WHERE id = ?`)
    .bind(HOUSEHOLD_ID)
    .first<{ base_currency: string; enabled_currencies: string | null }>();

  // A missing row means the seed migration has not run. Falling back rather than throwing keeps the
  // app startable, and the schema guard is what actually reports a database in that state.
  const base = isCurrency(row?.base_currency) ? row.base_currency : "UAH";
  return { base, enabled: parseEnabledCurrencies(row?.enabled_currencies, base) };
}

/**
 * Whether the currencies still need choosing.
 *
 * True only for an installation that has never chosen and has nothing recorded. The marker lives in
 * `app_meta` rather than on the household row because it is a fact about this deployment, not about
 * the household — and because the column default cannot serve as the marker: it has to describe the
 * existing installation being upgraded, which makes "unset" indistinguishable from "chosen".
 *
 * The transaction count is the second condition, and it is the one that matters. An upgrade from an
 * older version has no marker either, and must not be asked to set up a household it already has.
 */
export async function needsCurrencySetup(db: D1Database): Promise<boolean> {
  const marker = await db
    .prepare(`SELECT value FROM app_meta WHERE key = 'currency_setup'`)
    .first<{ value: string }>();
  if (marker) return false;

  const counted = await db
    .prepare(`SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0`)
    .first<{ count: number }>();
  return (counted?.count ?? 0) === 0;
}

/**
 * Writes the household's currency configuration.
 *
 * Validated here rather than trusted from the client, because this row decides how every stored
 * amount is interpreted. An unrecognised code would not fail loudly — it would index into the
 * minor-unit table with undefined and turn amounts into NaN.
 *
 * Changing the base does **not** re-price existing transactions: `base_amount_minor` is denormalised
 * on every row, so that is a migration rather than a setting, and it lives behind its own explicit
 * operation with a backup. This function is what a first-run setup and adding a currency use.
 */
export async function setHouseholdCurrencies(
  db: D1Database,
  input: { base: unknown; enabled: unknown },
): Promise<{ base: Currency; enabled: Currency[] }> {
  if (!isCurrency(input.base)) {
    throw new Error(`Unsupported base currency: ${String(input.base)}`);
  }
  const enabled = parseEnabledCurrencies(input.enabled, input.base);

  await db.batch([
    db
      .prepare(`UPDATE households SET base_currency = ?, enabled_currencies = ? WHERE id = ?`)
      .bind(input.base, JSON.stringify(enabled), HOUSEHOLD_ID),
    // Records that the choice has been made, so first-run setup does not ask again on an
    // installation whose answer happened to match the defaults.
    db
      .prepare(
        `INSERT INTO app_meta (key, value, updated_at) VALUES ('currency_setup', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(input.base, Date.now()),
  ]);

  return { base: input.base, enabled };
}
