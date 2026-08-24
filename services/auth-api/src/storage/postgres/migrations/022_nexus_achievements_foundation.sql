-- Nexus achievements foundation (Phase 3B/3D). Additive and backend-owned.
-- Provider is derived through platform_games; state ownership is derived through
-- linked_platform_accounts. No provider credentials or desktop data are stored.

CREATE TABLE IF NOT EXISTS platform_achievements (
  id                      uuid PRIMARY KEY,
  platform_game_id        uuid NOT NULL REFERENCES platform_games(id) ON DELETE CASCADE,
  provider_achievement_id text NOT NULL CHECK (char_length(provider_achievement_id) BETWEEN 1 AND 256),
  title                   text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 500),
  description             text NOT NULL DEFAULT '',
  hidden                  boolean NOT NULL DEFAULT false,
  icon_url                text,
  locked_icon_url         text,
  global_unlock_percent   numeric(5,2) CHECK (global_unlock_percent BETWEEN 0 AND 100),
  provider_score_kind     text NOT NULL DEFAULT 'none' CHECK (provider_score_kind IN ('none','xbox_gamerscore','playstation_trophy')),
  provider_score_value    integer CHECK (provider_score_value IS NULL OR provider_score_value >= 0),
  provider_score_grade    text CHECK (provider_score_grade IN ('bronze','silver','gold','platinum')),
  synced_at               timestamptz,
  CONSTRAINT platform_achievements_provider_score_shape CHECK (
    (provider_score_kind = 'none' AND provider_score_value IS NULL AND provider_score_grade IS NULL)
    OR (provider_score_kind = 'xbox_gamerscore' AND provider_score_value IS NOT NULL AND provider_score_grade IS NULL)
    OR (provider_score_kind = 'playstation_trophy' AND provider_score_value IS NULL AND provider_score_grade IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_achievements_identity_uniq
  ON platform_achievements (platform_game_id, provider_achievement_id);
CREATE INDEX IF NOT EXISTS platform_achievements_game_idx ON platform_achievements (platform_game_id);

CREATE TABLE IF NOT EXISTS user_achievement_states (
  id                      uuid PRIMARY KEY,
  linked_account_id       uuid NOT NULL REFERENCES linked_platform_accounts(id) ON DELETE CASCADE,
  platform_achievement_id uuid NOT NULL REFERENCES platform_achievements(id) ON DELETE CASCADE,
  unlocked                boolean NOT NULL DEFAULT false,
  unlock_state_known      boolean NOT NULL DEFAULT false,
  unlocked_at             timestamptz,
  synced_at               timestamptz,
  CONSTRAINT user_achievement_states_truth CHECK (
    unlock_state_known OR (unlocked = false AND unlocked_at IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS user_achievement_states_uniq
  ON user_achievement_states (linked_account_id, platform_achievement_id);
CREATE INDEX IF NOT EXISTS user_achievement_states_link_idx ON user_achievement_states (linked_account_id);

-- A state may only point at an achievement whose game is owned by an account
-- for the same provider. The provider remains normalized, never duplicated.
CREATE OR REPLACE FUNCTION nexus_enforce_achievement_state_provider_match()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_provider text; achievement_provider text;
BEGIN
  SELECT provider INTO account_provider FROM linked_platform_accounts WHERE id = NEW.linked_account_id;
  SELECT game.provider INTO achievement_provider
  FROM platform_achievements achievement JOIN platform_games game ON game.id = achievement.platform_game_id
  WHERE achievement.id = NEW.platform_achievement_id;
  IF account_provider IS NOT NULL AND achievement_provider IS NOT NULL AND account_provider <> achievement_provider THEN
    RAISE EXCEPTION 'user_achievement_states_provider_mismatch' USING ERRCODE = '23514', CONSTRAINT = 'user_achievement_states_provider_match';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_achievement_states_provider_match ON user_achievement_states;
CREATE TRIGGER user_achievement_states_provider_match BEFORE INSERT OR UPDATE OF linked_account_id, platform_achievement_id
ON user_achievement_states FOR EACH ROW EXECUTE FUNCTION nexus_enforce_achievement_state_provider_match();
