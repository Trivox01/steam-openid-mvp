-- Session revocation foundation.
--
-- Sessions are stateless HMAC tokens, so there is nothing to delete on logout or
-- suspension. Instead every user carries a monotonic epoch that is embedded in the
-- signed claims; bumping it makes every previously issued token fail validation.
-- No bearer token is ever stored.
--
-- Written to be idempotent so a partially applied or re-run migration is safe.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;

-- The constraint is added only when absent. Dropping and re-adding would also be
-- re-runnable, but it would take ACCESS EXCLUSIVE and re-validate every row on a
-- constraint that is already proven valid, so an existing one is left untouched.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_session_epoch_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_session_epoch_check
      CHECK (session_epoch >= 0);
  END IF;
END $$;
