CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  cover_url TEXT,
  playtime_minutes INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  unlocked_at TEXT,
  rarity_percentage REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
