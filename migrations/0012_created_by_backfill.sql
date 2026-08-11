-- Existing rows get their best available guess: whoever last touched them. For most rows that is
-- also the creator; for the mis-attributed minority there is no record of the truth left to
-- recover — updated_by was the only authorship column that ever existed.
--
-- Separate from 0011 because SQLite has no ADD COLUMN IF NOT EXISTS: a file that adds a column and
-- then writes to it cannot be retried after failing between the two statements. Idempotent — the
-- WHERE clause makes a re-run a no-op.
UPDATE transactions SET created_by = updated_by WHERE created_by IS NULL;
