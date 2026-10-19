-- OrventYield verification registry. No raw phone numbers or IPs are stored: only HMAC hashes.

-- One user = one card, enforced by the database, atomically.
CREATE TABLE IF NOT EXISTS cards (
  phone_hash   TEXT PRIMARY KEY,
  owner        TEXT NOT NULL UNIQUE,
  activated_at INTEGER NOT NULL
);

-- A short-lived OTP session (10 minutes). The OTP itself lives with the provider (Twilio Verify), never here.
CREATE TABLE IF NOT EXISTS otp_sessions (
  nonce      TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  owner      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0
);

-- Sliding-window rate-limit events (kind: start_ip | start_phone | check_phone | sms_global).
CREATE TABLE IF NOT EXISTS events (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key  TEXT NOT NULL,
  at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_lookup ON events (kind, key, at);
