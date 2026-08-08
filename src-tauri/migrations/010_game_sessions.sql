CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  launch_source TEXT NOT NULL DEFAULT 'steam_local' CHECK (launch_source IN ('steam_local','nexus_launch','external_launch')),
  recovered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_app_started ON game_sessions(app_id, started_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_started ON game_sessions(started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_one_open_per_app ON game_sessions(app_id) WHERE ended_at IS NULL;