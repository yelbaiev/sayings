-- A small key/value store for facts about the installation itself, as opposed to the household's
-- data. Currently just the result of the nightly release check.
--
-- Not household-scoped: this is per-deployment, and a deployment holds exactly one household.
-- Not synced either — clients read it through /api/version rather than through the sync protocol,
-- because it is not the household's data and has no business in the local mirror or in an export.
CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL
);
