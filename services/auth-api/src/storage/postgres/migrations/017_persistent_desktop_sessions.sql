-- Persistent desktop sessions. Raw credentials and access tokens are never
-- stored: token_hash is SHA-256 over a high-entropy, server-authenticated
-- credential. Rotation lineage supports replay detection and a short
-- idempotency window for a lost refresh response.
CREATE TABLE desktop_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  token_family_id uuid NOT NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  session_epoch_at_issue integer NOT NULL CHECK (session_epoch_at_issue >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_at timestamptz,
  replacement_session_id uuid REFERENCES desktop_sessions(id),
  CHECK (expires_at > created_at),
  CHECK ((rotated_at IS NULL AND replacement_session_id IS NULL) OR
         (rotated_at IS NOT NULL AND replacement_session_id IS NOT NULL))
);

CREATE INDEX desktop_sessions_user_active_idx
  ON desktop_sessions(user_id, created_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX desktop_sessions_family_idx
  ON desktop_sessions(token_family_id, generation);
CREATE INDEX desktop_sessions_cleanup_idx
  ON desktop_sessions(expires_at, revoked_at);
