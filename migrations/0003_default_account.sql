-- A per-member default account.
--
-- On `members` rather than in device preferences because it belongs to the person, not the phone:
-- his card and her card are different answers, and each should follow them across devices.
-- Nullable, so "no default" stays distinct from "the first account in the list".
ALTER TABLE members ADD COLUMN default_account_id TEXT;
