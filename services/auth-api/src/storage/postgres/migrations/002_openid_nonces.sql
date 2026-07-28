CREATE TABLE openid_nonces (
  nonce_hash char(64) PRIMARY KEY,
  auth_request_id uuid NOT NULL REFERENCES auth_transactions(auth_request_id)
    ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL
);

CREATE INDEX openid_nonces_expiry_idx ON openid_nonces (expires_at);
