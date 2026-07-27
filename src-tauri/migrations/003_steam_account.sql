CREATE TABLE IF NOT EXISTS steam_profile (
  steam_id TEXT PRIMARY KEY,
  persona_name TEXT NOT NULL,
  profile_url TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  avatar_medium_url TEXT NOT NULL DEFAULT '',
  avatar_full_url TEXT NOT NULL DEFAULT '',
  persona_state INTEGER,
  last_logoff INTEGER,
  visibility_state INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
