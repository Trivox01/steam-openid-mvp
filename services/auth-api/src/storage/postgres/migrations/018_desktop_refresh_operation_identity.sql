-- Bind a rotated predecessor to one opaque refresh operation. Only the hash is
-- retained, allowing the same replacement to be recovered across processes
-- without storing either raw credential or raw operation identity.
ALTER TABLE desktop_sessions
  ADD COLUMN IF NOT EXISTS refresh_operation_hash char(64),
  ADD COLUMN IF NOT EXISTS refresh_operation_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'desktop_sessions_refresh_operation_check'
      AND conrelid = 'desktop_sessions'::regclass
  ) THEN
    ALTER TABLE desktop_sessions
      ADD CONSTRAINT desktop_sessions_refresh_operation_check
      CHECK (
        (refresh_operation_hash IS NULL AND refresh_operation_expires_at IS NULL)
        OR
        (refresh_operation_hash ~ '^[0-9a-f]{64}$'
          AND refresh_operation_expires_at IS NOT NULL)
      );
  END IF;
END $$;
