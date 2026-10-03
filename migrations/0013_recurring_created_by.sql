-- Who set up a recurring payment. Each schedule is shown only to its owner.
--
-- A recurring payment is one person's habit — their salary, their subscription — and the other
-- person seeing it in their list (and being prompted to post it) was reported as noise. Same
-- reasoning as transactions.created_by in 0011: set once at creation, never touched again, so it
-- does not ride on updated_by, which is sync bookkeeping.
ALTER TABLE recurring ADD COLUMN created_by TEXT;
