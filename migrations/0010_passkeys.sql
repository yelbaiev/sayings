-- Passkey authentication: the owner claims a fresh deployment, members join by invite link.
--
-- This replaces the *requirement* for Cloudflare Access with an option: the Worker accepts either
-- an Access JWT (as before) or a session cookie issued against a passkey. Access could never be
-- provisioned by the Deploy to Cloudflare button, so every self-hoster paid a manual Zero Trust
-- walkthrough; passkeys need nothing but the browser.
--
-- Four tables, all additive, all idempotent:
--   credentials     — WebAuthn public keys, one row per registered passkey
--   auth_sessions   — server-side sessions; the cookie holds a random token, the row its SHA-256.
--                     Hashed so a database read-out cannot be replayed as a login.
--   invites         — one-time joining tokens the owner hands out; hashed for the same reason
--   auth_challenges — short-lived WebAuthn challenges, deleted on use

CREATE TABLE IF NOT EXISTS credentials (
  id         TEXT PRIMARY KEY,            -- credential id, base64url, as the authenticator minted it
  member_id  TEXT NOT NULL REFERENCES members(id),
  public_key TEXT NOT NULL,               -- COSE public key, base64url
  counter    INTEGER NOT NULL DEFAULT 0,  -- signature counter, for clone detection
  transports TEXT,                        -- JSON array hint for the browser's picker
  label      TEXT,                        -- "iPhone", set at registration time
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_member ON credentials(member_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_member ON auth_sessions(member_id);

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  kind       TEXT NOT NULL,               -- 'claim' | 'login' | 'invite' | 'add-key'
  invite_hash TEXT,                       -- set for kind='invite'
  member_id  TEXT,                        -- set for kind='add-key'
  created_at INTEGER NOT NULL
);
