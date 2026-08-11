-- Currency configuration for the household.
--
-- `households.base_currency` has existed since 0001 with a default of 'UAH', but no client has ever
-- read it — the base was a module constant compiled into the bundle. This migration adds the second
-- half of the setting, and is what makes that column start mattering.
--
-- `enabled_currencies` is the set a household actually transacts in: what the account editor offers,
-- and what the nightly rate fetch bothers to fetch. A JSON array rather than a join table, because it
-- is a short list read as a whole, never queried across, and belongs to the row that already holds
-- the base.
--
-- The default describes the installation being upgraded — hryvnia base, with euro and dollar accounts
-- — so an existing database needs no data migration. A fresh install replaces it during first-run
-- setup, which is the only case where the default would be wrong.
--
-- One statement, deliberately. SQLite has no ADD COLUMN IF NOT EXISTS, so a file that adds two
-- columns cannot be retried after failing between them; a file that adds one either ran or did not.

ALTER TABLE households ADD COLUMN enabled_currencies TEXT NOT NULL DEFAULT '["UAH","EUR","USD"]';
