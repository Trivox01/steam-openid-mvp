CREATE TABLE auth_transactions (
  auth_request_id uuid PRIMARY KEY,
  poll_secret_hash char(64) NOT NULL,
  device_id_hash char(64) NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'verified', 'cancelled', 'expired', 'consumed', 'failed')
  ),
  return_to text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  steam_id text,
  response_nonce_hash char(64),
  failure_code text,
  verified_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE INDEX auth_transactions_cleanup_idx
  ON auth_transactions (status, created_at);

CREATE INDEX auth_transactions_expiry_idx
  ON auth_transactions (expires_at)
  WHERE status = 'pending';
