ALTER TABLE games ADD COLUMN playtime_two_weeks_minutes INTEGER CHECK (playtime_two_weeks_minutes IS NULL OR playtime_two_weeks_minutes >= 0);
ALTER TABLE games ADD COLUMN playtime_windows_minutes INTEGER CHECK (playtime_windows_minutes IS NULL OR playtime_windows_minutes >= 0);
ALTER TABLE games ADD COLUMN playtime_mac_minutes INTEGER CHECK (playtime_mac_minutes IS NULL OR playtime_mac_minutes >= 0);
ALTER TABLE games ADD COLUMN playtime_linux_minutes INTEGER CHECK (playtime_linux_minutes IS NULL OR playtime_linux_minutes >= 0);
ALTER TABLE games ADD COLUMN icon_url TEXT NOT NULL DEFAULT '';
ALTER TABLE games ADD COLUMN synced_at TEXT;
ALTER TABLE games ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
ALTER TABLE games ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));
ALTER TABLE games ADD COLUMN game_status TEXT NOT NULL DEFAULT 'notStarted'
  CHECK (game_status IN ('notStarted', 'playing', 'completed', 'backlog', 'abandoned'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_provider_external
  ON games(platform_id, platform_game_id);
