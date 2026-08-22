# Multi-platform database proposal

**Status: proposal. DO NOT APPLY.**

This file is deliberately a document, not a migration. It is not placed in
`services/auth-api/src/storage/postgres/migrations/`, so no migration runner can
pick it up. Nothing here has been executed against any environment, and no
production migration is part of Phase 1.

When a later phase decides to implement it, the first file would land as
`020_nexus_multi_platform_foundation.sql` (migrations `001`–`019` already exist,
the latest being `019_desktop_session_refresh_protocol.sql`), and it would be
applied to staging first.

The SQL below is illustrative PostgreSQL, written to match the domain contracts
in `src/domain/nexus/`. It contains no secrets and no real credentials.

## Ownership summary

| Row | Owner | Removed when |
| --- | --- | --- |
| `nexus user` (existing `users`) | itself | account deletion |
| `linked_platform_accounts` | Nexus user | unlink or account deletion |
| `provider_credentials` | linked account | unlink, revocation, account deletion |
| `canonical_games` | catalog (shared) | never by a user action |
| `platform_games` | catalog (shared) | never by a user action |
| `user_game_ownership` | linked account | unlink or account deletion |
| `platform_achievements` | catalog (shared) | never by a user action |
| `user_achievement_states` | linked account | unlink or account deletion |

## Identity: linked platform accounts

```sql
-- PROPOSAL ONLY — DO NOT APPLY
CREATE TABLE linked_platform_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('steam','xbox','playstation')),
  provider_user_id  text NOT NULL,
  display_name      text,
  avatar_url        text,
  connection_status text NOT NULL DEFAULT 'connected'
                      CHECK (connection_status IN
                        ('connected','reauth_required','revoked','disconnected','error')),
  scopes            text[] NOT NULL DEFAULT '{}',
  credential_ref    text,          -- opaque handle only, never a token
  linked_at         timestamptz NOT NULL DEFAULT now(),
  last_sync_at      timestamptz,
  last_sync_status  text CHECK (last_sync_status IN ('idle','success','partial','error')),
  revoked_at        timestamptz
);

-- One provider identity belongs to at most one Nexus account at a time.
CREATE UNIQUE INDEX linked_accounts_provider_identity_uniq
  ON linked_platform_accounts (provider, provider_user_id)
  WHERE revoked_at IS NULL;

-- One Nexus account holds at most one active link per provider.
CREATE UNIQUE INDEX linked_accounts_one_per_provider_uniq
  ON linked_platform_accounts (user_id, provider)
  WHERE revoked_at IS NULL;

CREATE INDEX linked_accounts_user_idx ON linked_platform_accounts (user_id);
```

**provider / providerUserId uniqueness semantics.** Uniqueness is partial, on
non-revoked rows only. A Steam account that was unlinked can be linked again
later, by the same user or by another one, while the historical row remains for
audit. Global uniqueness across all rows would make unlink irreversible.

**Relation to the current schema.** `users.steam_id64` stays authoritative until
step 4 of the migration path in `MULTI_PLATFORM_ACCOUNTS.md`. During the dual
window, every existing user is backfilled as exactly one `steam` row here.
Sessions (`017_persistent_desktop_sessions.sql`) need no change because they
already reference `users(id)`, not the Steam identity. RBAC tables
(`user_roles`, `user_permission_overrides`) likewise stay attached to the Nexus
user.

## Credentials

```sql
-- PROPOSAL ONLY — DO NOT APPLY
CREATE TABLE provider_credentials (
  credential_ref     text PRIMARY KEY,
  linked_account_id  uuid NOT NULL UNIQUE
                       REFERENCES linked_platform_accounts(id) ON DELETE CASCADE,
  ciphertext         bytea NOT NULL,   -- envelope-encrypted, never plaintext
  encryption_key_id  text NOT NULL,
  expires_at         timestamptz,
  refresh_expires_at timestamptz,
  last_refreshed_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

Rules: this table is written and read only by the backend credential service;
no route, projection or desktop cache may select `ciphertext`; the value is
encrypted at rest with a key referenced by `encryption_key_id`; Steam creates no
row here because Steam OpenID issues no credential.

## Catalog: canonical and platform games

```sql
-- PROPOSAL ONLY — DO NOT APPLY
CREATE TABLE canonical_games (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  title        text NOT NULL,
  release_year integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_games (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                 text NOT NULL CHECK (provider IN ('steam','xbox','playstation')),
  provider_game_id         text NOT NULL,
  title                    text NOT NULL,
  canonical_game_id        uuid REFERENCES canonical_games(id) ON DELETE SET NULL,
  canonical_mapping_method text CHECK (canonical_mapping_method IN
                             ('provider_verified','editorial_verified','user_confirmed')),
  canonical_verified_by    text,
  canonical_verified_at    timestamptz,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- A canonical link exists only together with its verified evidence.
  CONSTRAINT platform_games_mapping_evidence CHECK (
    (canonical_game_id IS NULL AND canonical_mapping_method IS NULL)
    OR (canonical_game_id IS NOT NULL AND canonical_mapping_method IS NOT NULL
        AND canonical_verified_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX platform_games_identity_uniq
  ON platform_games (provider, provider_game_id);
CREATE INDEX platform_games_canonical_idx ON platform_games (canonical_game_id);
```

**Canonical / platform relationship.** One canonical game has zero or more
platform games; a platform game has at most one canonical game. The check
constraint enforces at the database level what
`linkPlatformGameToCanonical()` enforces in the domain: no mapping without
verified evidence. `title_similarity_candidate` is intentionally absent from the
allowed methods, so a title match can never become a stored link. Deleting a
canonical game only detaches its platform rows; it never deletes provider data.

## Ownership

```sql
-- PROPOSAL ONLY — DO NOT APPLY
CREATE TABLE user_game_ownership (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_account_id uuid NOT NULL
                      REFERENCES linked_platform_accounts(id) ON DELETE CASCADE,
  platform_game_id  uuid NOT NULL REFERENCES platform_games(id) ON DELETE CASCADE,
  playtime_minutes  integer,
  playtime_known    boolean NOT NULL DEFAULT false,
  last_played_at    timestamptz,
  acquired_at       timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_sync_at      timestamptz
);

CREATE UNIQUE INDEX user_game_ownership_uniq
  ON user_game_ownership (linked_account_id, platform_game_id);
CREATE INDEX user_game_ownership_user_idx ON user_game_ownership (user_id);
```

Ownership is keyed by linked account, not by user, so the same title owned on
two providers produces two rows. `playtime_known` keeps "not supplied" distinct
from "zero minutes", which matters for providers whose playtime capability is
unverified.

## Achievements

```sql
-- PROPOSAL ONLY — DO NOT APPLY
CREATE TABLE platform_achievements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_game_id        uuid NOT NULL REFERENCES platform_games(id) ON DELETE CASCADE,
  provider                text NOT NULL CHECK (provider IN ('steam','xbox','playstation')),
  provider_achievement_id text NOT NULL,
  title                   text NOT NULL,
  description             text NOT NULL DEFAULT '',
  hidden                  boolean NOT NULL DEFAULT false,
  icon_url                text,
  locked_icon_url         text,
  global_unlock_percent   numeric(5,2),
  provider_score_kind     text CHECK (provider_score_kind IN
                            ('none','xbox_gamerscore','playstation_trophy')),
  provider_score_value    text,
  synced_at               timestamptz
);

CREATE UNIQUE INDEX platform_achievements_identity_uniq
  ON platform_achievements (platform_game_id, provider_achievement_id);

CREATE TABLE user_achievement_states (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_account_id       uuid NOT NULL
                            REFERENCES linked_platform_accounts(id) ON DELETE CASCADE,
  platform_achievement_id uuid NOT NULL
                            REFERENCES platform_achievements(id) ON DELETE CASCADE,
  unlocked                boolean NOT NULL DEFAULT false,
  unlock_state_known      boolean NOT NULL DEFAULT false,
  unlocked_at             timestamptz,
  synced_at               timestamptz
);

CREATE UNIQUE INDEX user_achievement_states_uniq
  ON user_achievement_states (linked_account_id, platform_achievement_id);
CREATE INDEX user_achievement_states_user_idx ON user_achievement_states (user_id);
```

**Achievement ownership.** The definition belongs to a platform game and is
shared between all users; the unlock fact belongs to a linked account. There is
no canonical achievement table in this proposal, because provider achievement
sets differ for the same canonical title and merging them would invent data.
`unlock_state_known` mirrors the existing Steam merge semantics: unknown is not
locked.

## Unlink behaviour

Unlinking one provider from a Nexus account:

1. revoke the provider credential when the provider supports revocation, then
   delete the `provider_credentials` row (`planDisconnect()` returns
   `revoke_then_delete`, `delete_only` or `not_applicable`);
2. delete `user_achievement_states` and `user_game_ownership` rows for that
   `linked_account_id`;
3. set `connection_status = 'disconnected'` and `revoked_at = now()` on the
   link, or delete the row when the user asked for full removal;
4. keep `canonical_games`, `platform_games` and `platform_achievements`, which
   are shared reference data and contain nothing user-specific;
5. leave the Nexus account, its roles, badges and sessions untouched.

Unlinking the last provider is allowed. The Nexus account survives with no
linked accounts, which is exactly why the account cannot be the Steam row.

## Deletion and privacy behaviour

- Account deletion cascades from `users(id)` through links, credentials,
  ownership and unlock state, so no user-scoped provider data survives.
- Shared catalog rows are retained; they describe games, not people.
- Audit and sync-log rows keep identifiers and outcomes only, never provider
  profile payloads or credential material.
- The desktop SQLite cache stores non-sensitive projections and is cleared for
  a provider on unlink; it never receives credentials.
- Provider profile fields (`display_name`, `avatar_url`) are refreshed from the
  provider and deleted with the link, so removing a connection removes the
  provider's personal data from the product.
