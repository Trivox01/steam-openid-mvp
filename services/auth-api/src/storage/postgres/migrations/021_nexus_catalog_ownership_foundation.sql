-- Nexus multi-platform catalog foundation (Phase 3A).
-- Additive only: no current Steam runtime reads or writes these tables yet.
-- UUID identifiers are supplied by backend code so no pgcrypto extension is required.

CREATE TABLE IF NOT EXISTS canonical_games (
  id           uuid PRIMARY KEY,
  slug         text NOT NULL UNIQUE
                 CHECK (char_length(trim(slug)) BETWEEN 1 AND 160),
  title        text NOT NULL
                 CHECK (char_length(trim(title)) BETWEEN 1 AND 300),
  release_year integer CHECK (release_year BETWEEN 1900 AND 2100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_games (
  id                       uuid PRIMARY KEY,
  provider                 text NOT NULL
                             CHECK (provider IN ('steam','xbox','playstation')),
  provider_game_id         text NOT NULL
                             CHECK (char_length(provider_game_id) BETWEEN 1 AND 128),
  title                    text NOT NULL
                             CHECK (char_length(trim(title)) BETWEEN 1 AND 300),
  canonical_game_id        uuid REFERENCES canonical_games(id) ON DELETE RESTRICT,
  canonical_mapping_method text CHECK (canonical_mapping_method IN
                             ('provider_verified','editorial_verified')),
  canonical_verified_by    text,
  canonical_verified_at    timestamptz,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_games_mapping_evidence CHECK (
    (
      canonical_game_id IS NULL
      AND canonical_mapping_method IS NULL
      AND canonical_verified_by IS NULL
      AND canonical_verified_at IS NULL
    )
    OR (
      canonical_game_id IS NOT NULL
      AND canonical_mapping_method IS NOT NULL
      AND canonical_verified_by IS NOT NULL
      AND char_length(trim(canonical_verified_by)) > 0
      AND canonical_verified_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_games_identity_uniq
  ON platform_games (provider, provider_game_id);
CREATE INDEX IF NOT EXISTS platform_games_canonical_idx
  ON platform_games (canonical_game_id);

-- Per-user hints never mutate shared catalog truth directly.
CREATE TABLE IF NOT EXISTS user_canonical_mapping_suggestions (
  id                         uuid PRIMARY KEY,
  platform_game_id           uuid NOT NULL
                               REFERENCES platform_games(id) ON DELETE CASCADE,
  proposed_canonical_game_id uuid NOT NULL
                               REFERENCES canonical_games(id) ON DELETE CASCADE,
  method                     text NOT NULL CHECK (method IN
                               ('user_confirmed','title_similarity_candidate')),
  suggested_by_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                     text NOT NULL DEFAULT 'pending'
                               CHECK (status IN
                                 ('pending','accepted_as_verified','rejected')),
  suggested_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mapping_suggestions_game_idx
  ON user_canonical_mapping_suggestions (platform_game_id);
CREATE INDEX IF NOT EXISTS mapping_suggestions_user_idx
  ON user_canonical_mapping_suggestions (suggested_by_user_id);

CREATE TABLE IF NOT EXISTS user_game_ownership (
  id                uuid PRIMARY KEY,
  linked_account_id uuid NOT NULL
                      REFERENCES linked_platform_accounts(id) ON DELETE CASCADE,
  platform_game_id  uuid NOT NULL REFERENCES platform_games(id) ON DELETE CASCADE,
  playtime_minutes  integer CHECK (playtime_minutes IS NULL OR playtime_minutes >= 0),
  playtime_known    boolean NOT NULL DEFAULT false,
  last_played_at    timestamptz,
  acquired_at       timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_sync_at      timestamptz,
  CONSTRAINT user_game_ownership_playtime_truth CHECK (
    playtime_known OR playtime_minutes IS NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_game_ownership_uniq
  ON user_game_ownership (linked_account_id, platform_game_id);
CREATE INDEX IF NOT EXISTS user_game_ownership_game_idx
  ON user_game_ownership (platform_game_id);
CREATE INDEX IF NOT EXISTS user_game_ownership_link_idx
  ON user_game_ownership (linked_account_id);

-- Normalization deliberately omits provider from ownership rows. PostgreSQL
-- therefore enforces that the linked account and platform game belong to the
-- same provider rather than trusting application code to keep them aligned.
CREATE OR REPLACE FUNCTION nexus_enforce_ownership_provider_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_provider text;
  game_provider text;
BEGIN
  SELECT provider INTO account_provider
  FROM linked_platform_accounts
  WHERE id = NEW.linked_account_id;

  SELECT provider INTO game_provider
  FROM platform_games
  WHERE id = NEW.platform_game_id;

  -- Missing parents are handled by the foreign keys themselves.
  IF account_provider IS NULL OR game_provider IS NULL THEN
    RETURN NEW;
  END IF;

  IF account_provider <> game_provider THEN
    RAISE EXCEPTION 'user_game_ownership_provider_mismatch'
      USING ERRCODE = '23514',
            CONSTRAINT = 'user_game_ownership_provider_match';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS user_game_ownership_provider_match
  ON user_game_ownership;
CREATE TRIGGER user_game_ownership_provider_match
BEFORE INSERT OR UPDATE OF linked_account_id, platform_game_id
ON user_game_ownership
FOR EACH ROW
EXECUTE FUNCTION nexus_enforce_ownership_provider_match();
