-- Who originally recorded a transaction — permanent, unlike updated_by.
--
-- Attribution used to ride on updated_by, which is sync bookkeeping: it *must* change on every
-- edit for last-write-wins to work. The consequence was reported plainly: Лена records a
-- transaction, Сергей fixes a typo in it, and the row silently becomes his — in the list initials
-- and in the per-member report both. created_by is set once at creation and never touched again.
ALTER TABLE transactions ADD COLUMN created_by TEXT;
