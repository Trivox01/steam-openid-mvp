ALTER TABLE tool_definitions
  ADD COLUMN icon_asset_id uuid REFERENCES badge_assets(id) ON DELETE RESTRICT,
  ADD COLUMN cover_asset_id uuid REFERENCES badge_assets(id) ON DELETE RESTRICT;

CREATE INDEX tool_definitions_icon_asset_idx ON tool_definitions(icon_asset_id) WHERE icon_asset_id IS NOT NULL;
CREATE INDEX tool_definitions_cover_asset_idx ON tool_definitions(cover_asset_id) WHERE cover_asset_id IS NOT NULL;

-- Legacy external image columns remain readable during rollout, but new writes use managed assets only.
