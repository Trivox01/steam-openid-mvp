-- Persist the refresh protocol each desktop session was issued under.
-- Protocol classification cannot be derived from a deployment or migration
-- timestamp: a zero-downtime rollout applies migrations while the previous
-- backend is still serving traffic, so legacy sessions can still be created
-- after 018 was applied. The classification therefore lives on the session row.
--   1 = legacy refresh protocol (no operation identity)
--   2 = operation-identity refresh protocol
-- DEFAULT 1 is deliberate and is the compatibility guarantee:
--   * every session that existed before this migration becomes legacy;
--   * an older backend that does not know the column keeps inserting rows
--     successfully and those rows are classified legacy;
--   * a rollback to that older backend remains writable against this schema.
ALTER TABLE desktop_sessions
  ADD COLUMN IF NOT EXISTS refresh_protocol_version smallint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'desktop_sessions_refresh_protocol_version_check'
      AND conrelid = 'desktop_sessions'::regclass
  ) THEN
    ALTER TABLE desktop_sessions
      ADD CONSTRAINT desktop_sessions_refresh_protocol_version_check
      CHECK (refresh_protocol_version IN (1, 2));
  END IF;
END $$;
