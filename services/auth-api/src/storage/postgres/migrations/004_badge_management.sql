CREATE TABLE badge_assets (
  id uuid PRIMARY KEY,
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-f0-9-]{36}\.(png|webp)$'),
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  width integer NOT NULL CHECK (width BETWEEN 16 AND 2048),
  height integer NOT NULL CHECK (height BETWEEN 16 AND 2048),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE badge_definitions (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (char_length(description) <= 500),
  category text NOT NULL CHECK (category IN ('staff','community','achievement','event','legacy','special')),
  rarity text NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary','exclusive')),
  icon_asset_id uuid REFERENCES badge_assets(id) ON DELETE RESTRICT,
  priority integer NOT NULL DEFAULT 0 CHECK (priority >= 0 AND priority <= 10000),
  is_active boolean NOT NULL DEFAULT true,
  is_visible boolean NOT NULL DEFAULT true,
  grant_mode text NOT NULL CHECK (grant_mode IN ('manual','automatic')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX badge_definitions_active_idx
  ON badge_definitions(is_active, priority DESC) WHERE archived_at IS NULL;
CREATE INDEX badge_definitions_category_idx
  ON badge_definitions(category) WHERE archived_at IS NULL;
CREATE INDEX badge_definitions_rarity_idx
  ON badge_definitions(rarity) WHERE archived_at IS NULL;
CREATE INDEX badge_definitions_updated_idx
  ON badge_definitions(updated_at DESC);
CREATE INDEX badge_assets_available_idx
  ON badge_assets(created_at DESC) WHERE deleted_at IS NULL;
