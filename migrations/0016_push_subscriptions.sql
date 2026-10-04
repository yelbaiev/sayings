-- One row per phone that has turned reminders on (Settings → Reminders).
--
-- A push subscription is a capability URL the phone's push service gave it, plus the two keys the
-- server encrypts each message with. Device state, not household data: it is not synced, not
-- exported, and not in backups — a restore clears it, and each phone turns reminders on again,
-- the same as signing in again. See docs/plans/push-reminders.md.
--
-- The endpoint is the key: one phone, one row. If a phone changes hands its row moves with it.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL REFERENCES members(id),
  p256dh       TEXT NOT NULL,             -- the phone's public key, base64url, 65 bytes uncompressed
  auth         TEXT NOT NULL,             -- the phone's auth secret, base64url, 16 bytes
  created_at   INTEGER NOT NULL,
  last_sent_at INTEGER,                   -- the daily reminder records this so it sends once a day
  failures     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_member ON push_subscriptions(member_id);
