ALTER TABLE games ADD COLUMN tracked INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0, 1));
ALTER TABLE games ADD COLUMN last_opened_at TEXT;
CREATE INDEX IF NOT EXISTS idx_games_name_nocase ON games(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_games_tracked ON games(tracked, last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_recent ON games(last_played_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_synced ON games(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_hidden ON games(hidden);
CREATE INDEX IF NOT EXISTS idx_games_achievement_progress ON games(achievements_total, completion_percentage);
