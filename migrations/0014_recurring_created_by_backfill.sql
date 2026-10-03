-- Existing schedules go to whoever last touched them — in practice the person who posts or skips
-- them each period, which is the person they belong to.
--
-- Separate from 0013 for the same reason 0012 is separate from 0011: SQLite has no
-- ADD COLUMN IF NOT EXISTS, so adding and writing in one file cannot be retried. Idempotent.
UPDATE recurring SET created_by = updated_by WHERE created_by IS NULL;
