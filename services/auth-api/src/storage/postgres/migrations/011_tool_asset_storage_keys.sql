ALTER TABLE badge_assets
  DROP CONSTRAINT badge_assets_storage_key_check;

ALTER TABLE badge_assets
  ADD CONSTRAINT badge_assets_storage_key_check CHECK (
    storage_key ~ '^(?:[A-Za-z0-9_-]+/)*badges/(development|test|staging|production)/[a-f0-9-]{36}\.(png|webp)$'
    OR storage_key ~ '^(?:[A-Za-z0-9_-]+/)*tools/(development|test|staging|production)/(icons|covers)/[a-f0-9-]{36}\.(png|webp)$'
    OR storage_key ~ '^[a-f0-9-]{36}\.(png|webp)$'
  );
