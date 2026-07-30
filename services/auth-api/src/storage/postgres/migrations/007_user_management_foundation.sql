ALTER TABLE users ADD COLUMN display_name text;
ALTER TABLE users ADD COLUMN steam_nickname text;
ALTER TABLE users ADD COLUMN avatar_url text;
ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'active'
  CHECK (account_status IN ('active'));

CREATE INDEX users_created_at_idx ON users(created_at DESC);
CREATE INDEX users_authenticated_at_idx ON users(authenticated_at DESC);
CREATE INDEX users_account_status_idx ON users(account_status);
