-- sayFinance initial schema.
--
-- Sync columns present on every replicated table:
--   rev         per-household monotonic counter, assigned server-side
--   updated_at  client wall clock in ms, used for last-write-wins
--   updated_by  member id that made the change
--   deleted     soft delete, so removals propagate to other devices
--
-- Money is always an INTEGER count of minor units. The only REAL in the schema is fx_rate.

CREATE TABLE IF NOT EXISTS households (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'UAH',
  created_at    INTEGER NOT NULL
);

-- Per-household monotonic revision counter. Bumped in the same batch as every write, so a
-- client can ask "everything since rev N" and get an exact, gap-free delta.
CREATE TABLE IF NOT EXISTS household_seq (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  rev          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS members (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  email        TEXT NOT NULL,           -- matched against the Access JWT email claim
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#3E63DD',
  locale       TEXT NOT NULL DEFAULT 'en',   -- en | uk | ru, per-user
  role         TEXT NOT NULL DEFAULT 'member',
  created_at   INTEGER NOT NULL,
  rev          INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique ON members(email);
CREATE INDEX IF NOT EXISTS members_household_rev ON members(household_id, rev);

CREATE TABLE IF NOT EXISTS accounts (
  id                    TEXT PRIMARY KEY,
  household_id          TEXT NOT NULL REFERENCES households(id),
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL,   -- cash|debit_card|credit_card|bank|savings|investment
  currency              TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  icon                  TEXT NOT NULL DEFAULT 'wallet',
  color                 TEXT NOT NULL DEFAULT '#6E6E76',
  exclude_from_totals   INTEGER NOT NULL DEFAULT 0,
  archived              INTEGER NOT NULL DEFAULT 0,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  rev                   INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL,
  updated_by            TEXT,
  deleted               INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS accounts_household_rev ON accounts(household_id, rev);

-- `name` is DATA, shared between both members, and deliberately NOT a translated UI string:
-- the two users may read the interface in different languages but must see one shared ledger.
CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind         TEXT NOT NULL,            -- expense | income
  name         TEXT NOT NULL,
  parent_id    TEXT,
  icon         TEXT NOT NULL DEFAULT 'tag',
  color        TEXT NOT NULL DEFAULT '#6E6E76',
  archived     INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  rev          INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS categories_household_rev ON categories(household_id, rev);

CREATE TABLE IF NOT EXISTS transactions (
  id               TEXT PRIMARY KEY,
  household_id     TEXT NOT NULL REFERENCES households(id),
  kind             TEXT NOT NULL,        -- expense | income | transfer
  occurred_on      TEXT NOT NULL,        -- 'YYYY-MM-DD' local date, not a timestamp
  account_id       TEXT NOT NULL,
  to_account_id    TEXT,                 -- transfers only
  category_id      TEXT,
  amount_minor     INTEGER NOT NULL,     -- positive magnitude; direction comes from `kind`
  currency         TEXT NOT NULL,
  to_amount_minor  INTEGER,              -- destination leg of a cross-currency transfer
  to_currency      TEXT,
  base_amount_minor INTEGER NOT NULL,    -- magnitude in household base currency
  fx_rate          REAL NOT NULL DEFAULT 1,
  fx_estimated     INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  payee            TEXT,
  tags             TEXT,                 -- JSON array
  split_parent_id  TEXT,                 -- children of a split receipt share their parent id
  receipt_key      TEXT,                 -- R2 object key
  import_hash      TEXT,                 -- content hash, makes re-importing idempotent
  rev              INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT,
  deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS transactions_household_rev ON transactions(household_id, rev);
CREATE INDEX IF NOT EXISTS transactions_household_date ON transactions(household_id, occurred_on);
CREATE INDEX IF NOT EXISTS transactions_household_account ON transactions(household_id, account_id);
CREATE INDEX IF NOT EXISTS transactions_household_category ON transactions(household_id, category_id);
-- Partial index: only importer rows carry a hash, so this stays small.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_import_hash
  ON transactions(household_id, import_hash) WHERE import_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  category_id  TEXT NOT NULL,
  period_month TEXT,                     -- 'YYYY-MM', or NULL meaning "every month"
  amount_minor INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'UAH',
  rollover     INTEGER NOT NULL DEFAULT 0,
  rev          INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS budgets_household_rev ON budgets(household_id, rev);

CREATE TABLE IF NOT EXISTS recurring (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  label        TEXT NOT NULL,
  template     TEXT NOT NULL,            -- JSON transaction template
  cadence      TEXT NOT NULL,            -- monthly | weekly | yearly
  day_of       INTEGER NOT NULL DEFAULT 1,
  next_on      TEXT NOT NULL,            -- 'YYYY-MM-DD'
  active       INTEGER NOT NULL DEFAULT 1,
  rev          INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS recurring_household_rev ON recurring(household_id, rev);

-- One-tap transactions pinned to Home. Per-member, because habits differ.
CREATE TABLE IF NOT EXISTS quick_tiles (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_id    TEXT NOT NULL,
  label        TEXT NOT NULL,
  template     TEXT NOT NULL,            -- JSON transaction template
  sort_order   INTEGER NOT NULL DEFAULT 0,
  rev          INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS quick_tiles_household_rev ON quick_tiles(household_id, rev);

-- Not household-scoped and not part of the rev stream: rates are public reference data,
-- pulled by their own endpoint. `rate` is UAH per 1 unit of `quote`.
CREATE TABLE IF NOT EXISTS fx_rates (
  on_date TEXT NOT NULL,
  quote   TEXT NOT NULL,
  rate    REAL NOT NULL,
  source  TEXT NOT NULL DEFAULT 'nbu',
  PRIMARY KEY (on_date, quote)
);
CREATE INDEX IF NOT EXISTS fx_rates_quote_date ON fx_rates(quote, on_date);

-- Record of nightly backups, so Settings can show the last successful one.
CREATE TABLE IF NOT EXISTS backups (
  key          TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  kind         TEXT NOT NULL,            -- daily | monthly
  row_count    INTEGER NOT NULL,
  bytes        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_household_created ON backups(household_id, created_at DESC);
