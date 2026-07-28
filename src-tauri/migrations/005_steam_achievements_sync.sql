ALTER TABLE achievements ADD COLUMN locked_icon_url TEXT NOT NULL DEFAULT '';
ALTER TABLE achievements ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE achievements ADD COLUMN global_unlock_percent REAL
  CHECK (global_unlock_percent IS NULL OR global_unlock_percent BETWEEN 0 AND 100);
ALTER TABLE achievements ADD COLUMN synced_at TEXT;
ALTER TABLE achievements ADD COLUMN unlock_state_known INTEGER NOT NULL DEFAULT 1
  CHECK (unlock_state_known IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_game_source_external
  ON achievements(game_id, source, platform_achievement_id);

CREATE INDEX IF NOT EXISTS idx_achievements_source_synced
  ON achievements(source, synced_at);

ALTER TABLE games ADD COLUMN achievements_synced_at TEXT;
ALTER TABLE games ADD COLUMN achievements_sync_status TEXT NOT NULL DEFAULT 'idle'
  CHECK (achievements_sync_status IN ('idle', 'success', 'partial', 'unsupported', 'error'));
ALTER TABLE games ADD COLUMN achievements_sync_error TEXT;
