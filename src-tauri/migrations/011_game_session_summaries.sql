CREATE TABLE IF NOT EXISTS game_session_baselines (
  session_id TEXT PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  game_id TEXT,
  game_name TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  background_url TEXT,
  unlocked_count INTEGER,
  total_count INTEGER,
  completion_percentage REAL,
  achievements_synced_at TEXT,
  captured_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  game_id TEXT,
  game_name TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  background_url TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  before_unlocked INTEGER,
  before_total INTEGER,
  before_completion REAL,
  after_unlocked INTEGER,
  after_total INTEGER,
  after_completion REAL,
  progress_delta INTEGER,
  source TEXT NOT NULL CHECK (source IN ('session_monitor','steam_unlock_time')),
  recovered INTEGER NOT NULL DEFAULT 0,
  generated_at INTEGER NOT NULL,
  seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS game_session_summary_achievements (
  session_id TEXT NOT NULL REFERENCES game_session_summaries(session_id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  unlocked_at TEXT NOT NULL,
  rarity_percentage REAL,
  PRIMARY KEY (session_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_game_session_summaries_unseen
  ON game_session_summaries(seen_at, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_session_summaries_app
  ON game_session_summaries(app_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_session_summary_achievements_session
  ON game_session_summary_achievements(session_id);
