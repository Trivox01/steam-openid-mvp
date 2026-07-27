PRAGMA foreign_keys = OFF;

ALTER TABLE games RENAME TO games_legacy;
ALTER TABLE achievements RENAME TO achievements_legacy;
ALTER TABLE profiles RENAME TO profiles_legacy;

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL,
  platform_game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cover_url TEXT NOT NULL DEFAULT '',
  background_url TEXT NOT NULL DEFAULT '',
  playtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (playtime_minutes >= 0),
  achievements_unlocked INTEGER NOT NULL DEFAULT 0 CHECK (achievements_unlocked >= 0),
  achievements_total INTEGER NOT NULL DEFAULT 0 CHECK (achievements_total >= 0),
  completion_percentage REAL NOT NULL DEFAULT 0 CHECK (completion_percentage BETWEEN 0 AND 100),
  last_played_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_id, platform_game_id)
);

CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  platform_achievement_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  is_unlocked INTEGER NOT NULL DEFAULT 0 CHECK (is_unlocked IN (0, 1)),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  rarity_percentage REAL NOT NULL DEFAULT 0 CHECK (rarity_percentage BETWEEN 0 AND 100),
  unlocked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE(game_id, platform_achievement_id)
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  game_id TEXT,
  achievement_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  progress REAL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
  FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE SET NULL
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sync_metadata (
  platform_id TEXT PRIMARY KEY,
  last_sync_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'idle',
  error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profile (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  active_platform TEXT NOT NULL DEFAULT 'steam',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO games (id, platform_id, platform_game_id, name, cover_url, playtime_minutes, last_played_at)
SELECT id, platform, app_id, name, COALESCE(cover_url, ''), playtime_minutes, last_played_at FROM games_legacy;

INSERT INTO achievements (id, game_id, platform_achievement_id, name, description, icon_url, is_unlocked, rarity_percentage, unlocked_at)
SELECT id, game_id, id, title, COALESCE(description, ''), COALESCE(icon_url, ''), CASE WHEN unlocked_at IS NULL THEN 0 ELSE 1 END, rarity_percentage, unlocked_at
FROM achievements_legacy;

INSERT INTO profile (id, display_name, avatar_url, active_platform, updated_at)
SELECT id, display_name, COALESCE(avatar_url, ''), platform, COALESCE(last_synced_at, CURRENT_TIMESTAMP) FROM profiles_legacy;

DROP TABLE achievements_legacy;
DROP TABLE games_legacy;
DROP TABLE profiles_legacy;

CREATE INDEX idx_games_last_played ON games(last_played_at DESC);
CREATE INDEX idx_achievements_game_id ON achievements(game_id);
CREATE INDEX idx_activities_game_id ON activities(game_id);
CREATE INDEX idx_activities_occurred_at ON activities(occurred_at DESC);

PRAGMA foreign_keys = ON;
