ALTER TABLE badge_assets
  DROP CONSTRAINT badge_assets_storage_key_check;

ALTER TABLE badge_assets
  ADD CONSTRAINT badge_assets_storage_key_check CHECK (
    storage_key ~ '^(?:[A-Za-z0-9_-]+/)*badges/(development|test|staging|production)/[a-f0-9-]{36}\.(png|webp)$'
    OR storage_key ~ '^[a-f0-9-]{36}\.(png|webp)$'
  );

CREATE TABLE badge_asset_cleanup_jobs (
  id uuid PRIMARY KEY,
  asset_id uuid REFERENCES badge_assets(id) ON DELETE SET NULL,
  storage_key text NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'metadata_rollback',
    'icon_replaced',
    'asset_deleted'
  )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX badge_asset_cleanup_jobs_pending_key_idx
  ON badge_asset_cleanup_jobs(storage_key)
  WHERE completed_at IS NULL;
