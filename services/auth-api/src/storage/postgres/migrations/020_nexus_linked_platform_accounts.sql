-- Phase 2A - Nexus linked platform accounts (Steam transitional persistence).
--
-- ADDITIVE ONLY. users.steam_id64 REMAINS the authoritative login identity in
-- this phase. Nothing here alters users, desktop_sessions, RBAC, or any
-- existing constraint, and authentication is NOT resolved through this table
-- yet. Flipping identity resolution is a later phase.
--
-- Scope guard: only the account-link table is created here. No
-- provider_credentials (Steam OpenID issues no provider tokens, so the
-- credential store is deferred until a token-based provider needs it), no
-- canonical/platform game catalog, and no achievement tables.

CREATE TABLE IF NOT EXISTS linked_platform_accounts (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          text NOT NULL
                      CHECK (provider IN ('steam', 'xbox', 'playstation')),
  provider_user_id  text NOT NULL
                      CHECK (char_length(provider_user_id) BETWEEN 1 AND 128),
  display_name      text,
  avatar_url        text,
  connection_status text NOT NULL DEFAULT 'connected'
                      CHECK (connection_status IN (
                        'connected', 'reauth_required', 'revoked',
                        'disconnected', 'error'
                      )),
  scopes            text[] NOT NULL DEFAULT '{}',
  linked_at         timestamptz NOT NULL DEFAULT now(),
  last_sync_at      timestamptz,
  last_sync_status  text
                      CHECK (last_sync_status IN (
                        'idle', 'success', 'partial', 'error'
                      )),
  revoked_at        timestamptz,
  -- "revoked_at IS NULL" is the single definition of an active link. A terminal
  -- status always carries revoked_at and a row carrying revoked_at is always in
  -- a terminal status, so ending a link reliably frees both partial unique
  -- slots below and the two columns can never disagree.
  CONSTRAINT linked_platform_accounts_revocation_consistency CHECK (
    (connection_status IN ('revoked', 'disconnected')) = (revoked_at IS NOT NULL)
  )
);

-- One provider identity belongs to at most one Nexus account at a time.
-- Partial, so unlinking frees the identity instead of making it permanently
-- unusable, while revoked rows remain for audit.
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_provider_identity_uniq
  ON linked_platform_accounts (provider, provider_user_id)
  WHERE revoked_at IS NULL;

-- One Nexus account holds at most one active link per provider (V1 rule).
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_one_per_provider_uniq
  ON linked_platform_accounts (user_id, provider)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS linked_accounts_user_idx
  ON linked_platform_accounts (user_id);

-- Backfill: exactly one active Steam link per existing Nexus user.
--
-- Deterministic: the primary key is derived from the owning user id, so a
-- replay of this migration produces the same row identity instead of a second
-- link. Combined with the NOT EXISTS guard and ON CONFLICT DO NOTHING, the
-- statement is safe to run again on a partially migrated database.
--
-- Never reassigns a user: user_id comes from the users row that already owns
-- the Steam identity, and users.steam_id64 stays untouched and authoritative.
-- steam_id64 is char(17) and therefore blank-padded, so it is trimmed for the
-- text provider_user_id column exactly like the existing user queries do.
--
-- Profile fields are copied only from real Steam-provider data already stored
-- on the user row (steam_nickname / avatar_url, written by the Steam profile
-- enrichment path). Both stay NULL when the user was never enriched; no value
-- is invented, and users.display_name is deliberately NOT used because it is a
-- Nexus-level name rather than a provider one.
--
-- linked_at uses the user's created_at: the earliest defensible moment the
-- Steam identity was bound to this Nexus account. last_sync_at and
-- last_sync_status stay NULL because no provider sync has run through this
-- table yet, and revoked_at stays NULL so every backfilled row is active.
INSERT INTO linked_platform_accounts (
  id, user_id, provider, provider_user_id,
  display_name, avatar_url, connection_status, scopes,
  linked_at, last_sync_at, last_sync_status, revoked_at
)
SELECT
  (md5('nexus:linked-platform-account:steam:' || u.id::text))::uuid,
  u.id,
  'steam',
  trim(u.steam_id64),
  u.steam_nickname,
  u.avatar_url,
  'connected',
  '{}'::text[],
  u.created_at,
  NULL,
  NULL,
  NULL
FROM users u
WHERE trim(u.steam_id64) ~ '^[0-9]{17}$'
  AND NOT EXISTS (
    SELECT 1 FROM linked_platform_accounts existing
    WHERE existing.user_id = u.id
      AND existing.provider = 'steam'
      AND existing.revoked_at IS NULL
  )
ON CONFLICT DO NOTHING;
