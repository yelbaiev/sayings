import { z } from "zod";
import { CURRENCIES, SUPPORTED_LOCALES } from "./currency";

/**
 * One schema definition, used by client-side validation, the Worker's request validation,
 * and the CSV importer. Divergence between those three is exactly the bug class this file
 * exists to prevent.
 */

export const HOUSEHOLD_ID = "hh_default";

/** 'YYYY-MM-DD'. A local calendar date, deliberately not a timestamp: a purchase happens on
 *  a day, and storing an instant would shift it across timezones. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "not a real date");

export const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM");

const id = z.string().min(1).max(64);
const currency = z.enum(CURRENCIES);
const minor = z.number().int().safe();
const positiveMinor = minor.nonnegative();
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "expected #RRGGBB");

/** Columns every replicated table carries. See migrations/0001_init.sql. */
const syncColumns = {
  rev: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  updated_by: z.string().nullable().optional(),
  deleted: z.union([z.literal(0), z.literal(1)]),
};

export const ACCOUNT_TYPES = [
  "cash",
  "debit_card",
  "credit_card",
  "bank",
  "savings",
  "investment",
] as const;

export const memberSchema = z.object({
  id,
  household_id: id,
  email: z.string().email(),
  display_name: z.string().min(1).max(64),
  avatar_color: hexColor,
  locale: z.enum(SUPPORTED_LOCALES),
  /** Preferred starting account for new transactions. Null means "no preference". */
  default_account_id: id.nullable().optional(),
  role: z.enum(["owner", "member"]),
  created_at: z.number().int(),
  ...syncColumns,
});

export const accountSchema = z.object({
  id,
  household_id: id,
  name: z.string().min(1).max(64),
  type: z.enum(ACCOUNT_TYPES),
  currency,
  opening_balance_minor: minor,
  icon: z.string().max(16),
  color: hexColor,
  exclude_from_totals: z.union([z.literal(0), z.literal(1)]),
  archived: z.union([z.literal(0), z.literal(1)]),
  sort_order: z.number().int(),
  ...syncColumns,
});

export const categorySchema = z.object({
  id,
  household_id: id,
  kind: z.enum(["expense", "income"]),
  name: z.string().min(1).max(64),
  parent_id: id.nullable().optional(),
  icon: z.string().max(16),
  color: hexColor,
  archived: z.union([z.literal(0), z.literal(1)]),
  sort_order: z.number().int(),
  ...syncColumns,
});

export const transactionSchema = z
  .object({
    id,
    household_id: id,
    kind: z.enum(["expense", "income", "transfer"]),
    occurred_on: isoDate,
    account_id: id,
    to_account_id: id.nullable().optional(),
    category_id: id.nullable().optional(),
    amount_minor: positiveMinor,
    currency,
    to_amount_minor: positiveMinor.nullable().optional(),
    to_currency: currency.nullable().optional(),
    base_amount_minor: positiveMinor,
    fx_rate: z.number().positive().finite(),
    fx_estimated: z.union([z.literal(0), z.literal(1)]),
    /**
     * Where `fx_rate` came from: a source, the person, or nothing.
     *
     * Optional because an older client — a phone still serving a cached build weeks after the Worker
     * was updated — writes rows without it, and refusing those would lose entries. Absent is read as
     * 'auto', which is what every row written before this column existed was.
     */
    fx_source: z.enum(["auto", "manual", "estimated"]).nullable().optional(),
    /**
     * The currency `base_amount_minor` is expressed in.
     *
     * Optional for the same reason as `fx_source`: an older client does not send it, and refusing
     * those rows would lose entries. Absent means the row was priced by a build that had the base
     * compiled in.
     */
    fx_base: currency.nullable().optional(),
    /**
     * Who recorded this originally. Permanent: an edit changes updated_by (it must, for
     * last-write-wins) but never this. Optional because rows from older clients omit it — the
     * display falls back to updated_by, which is the pre-migration behaviour.
     */
    created_by: id.nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    payee: z.string().max(120).nullable().optional(),
    tags: z.string().nullable().optional(),
    split_parent_id: id.nullable().optional(),
    receipt_key: z.string().max(200).nullable().optional(),
    import_hash: z.string().max(64).nullable().optional(),
    ...syncColumns,
  })
  // These invariants are the difference between a ledger and a pile of rows, so they are
  // enforced at the schema level rather than trusted to each call site.
  .refine((tx) => tx.kind !== "transfer" || !!tx.to_account_id, {
    message: "a transfer needs a destination account",
    path: ["to_account_id"],
  })
  .refine((tx) => tx.kind === "transfer" || !tx.to_account_id, {
    message: "only transfers may set a destination account",
    path: ["to_account_id"],
  })
  .refine((tx) => tx.kind === "transfer" || !!tx.category_id, {
    message: "expenses and income need a category",
    path: ["category_id"],
  })
  .refine((tx) => tx.account_id !== tx.to_account_id, {
    message: "a transfer cannot target the same account it leaves",
    path: ["to_account_id"],
  });

export const budgetSchema = z.object({
  id,
  household_id: id,
  category_id: id,
  period_month: isoMonth.nullable().optional(),
  amount_minor: positiveMinor,
  currency,
  rollover: z.union([z.literal(0), z.literal(1)]),
  ...syncColumns,
});

export const recurringSchema = z.object({
  id,
  household_id: id,
  label: z.string().min(1).max(64),
  template: z.string(),
  cadence: z.enum(["weekly", "monthly", "yearly"]),
  day_of: z.number().int().min(1).max(31),
  next_on: isoDate,
  active: z.union([z.literal(0), z.literal(1)]),
  ...syncColumns,
});

export const quickTileSchema = z.object({
  id,
  household_id: id,
  member_id: id,
  label: z.string().min(1).max(32),
  template: z.string(),
  sort_order: z.number().int(),
  ...syncColumns,
});

/** Every table the sync protocol replicates. Order matters: parents before children, so a
 *  client applying a batch never references a row it has not yet inserted. */
export const SYNCED_TABLES = [
  "members",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "recurring",
  "quick_tiles",
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export const tableSchemas = {
  members: memberSchema,
  accounts: accountSchema,
  categories: categorySchema,
  transactions: transactionSchema,
  budgets: budgetSchema,
  recurring: recurringSchema,
  quick_tiles: quickTileSchema,
} as const;

export type Member = z.infer<typeof memberSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type Recurring = z.infer<typeof recurringSchema>;
export type QuickTile = z.infer<typeof quickTileSchema>;

export type SyncedRow =
  | Member
  | Account
  | Category
  | Transaction
  | Budget
  | Recurring
  | QuickTile;

/* ------------------------------------------------------------------ sync wire format */

export const syncChangeSchema = z.object({
  table: z.enum(SYNCED_TABLES),
  /** Whole-row upsert. Sending full state (rather than a delta) is what makes a replayed
   *  batch idempotent, so a retry after a dropped mobile connection is harmless. */
  row: z.record(z.string(), z.unknown()),
});

export const syncRequestSchema = z.object({
  since: z.number().int().nonnegative(),
  changes: z.array(syncChangeSchema).max(1000),
});

export type SyncChange = z.infer<typeof syncChangeSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export interface SyncResponse {
  rev: number;
  changes: { table: SyncedTable; row: Record<string, unknown> }[];
  /** Rows where the client's version lost the last-write-wins comparison. The client must
   *  overwrite its local copy with these rather than retrying. */
  conflicts: { table: SyncedTable; row: Record<string, unknown> }[];
  /** True when the delta was truncated and the client should sync again immediately. */
  more: boolean;
}
