-- Marks the rows that were recorded without a rate, so the nightly reconcile keeps finding them.
--
-- Separate from 0007 because SQLite has no ADD COLUMN IF NOT EXISTS: a file that adds a column and
-- then writes to it cannot be retried after failing between the two statements. Split, each half
-- either ran or did not.
--
-- Idempotent: running it again matches the same rows and writes the same value.
UPDATE transactions SET fx_source = 'estimated' WHERE fx_estimated = 1;
