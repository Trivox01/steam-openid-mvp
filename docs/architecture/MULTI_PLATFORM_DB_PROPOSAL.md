# Multi-platform database proposal

**Status: mixed. One table is applied; everything else is still a proposal.**

| section | state |
| --- | --- |
| `linked_platform_accounts` | **APPLIED** in Phase 2A as `020_nexus_linked_platform_accounts.sql` |
| `provider_credentials` | **DEFERRED** — proposal only, until the first token-based provider |
| `canonical_games`, `platform_games`, `user_canonical_mapping_suggestions` | proposal only. **DO NOT APPLY.** |
| `user_game_ownership`, `platform_achievements`, `user_achievement_states` | proposal only. **DO NOT APPLY.** |

Every SQL block below that is still a proposal is marked
`-- PROPOSAL ONLY — DO NOT APPLY` and is deliberately kept in this document
rather than in `services/auth-api/src/storage/postgres/migrations/`, so no
migration runner can pick it up. The only executed migration from this document
is migration 020, which was applied to a local/ephemeral test database by the
integration test suite. **No production migration or deploy is part of Phase
2A.**

The SQL below is PostgreSQL, written to match the domain contracts in
`src/domain/nexus/` and `services/auth-api/src/nexus/`. It contains no secrets
and no real credentials.

## Ownership summary

| Row | Owner | Removed when |
| --- | --- | --- |
| `nexus user` (existing `users`) | itself | account deletion |
| `linked_platform_accounts` | Nexus user | unlink or account deletion |
| `provider_credentials` | linked account | unlink, revocation, account deletion |
| `canonical_games` | catalog (shared) | never by a user action |
| `platform_games` | catalog (shared) | never by a user action |
| `user_canonical_mapping_suggestions` | suggesting user | account deletion |
| `user_game_ownership` | linked account | unlink or account deletion |
| `platform_achievements` | catalog (shared) | never by a user action |
| `user_achievement_states` | linked account | unlink or account deletion |

## Identity: linked platform accounts — APPLIED (migration 020)

This is the table as actually created by
`services/auth-api/src/storage/postgres/migrations/020_nexus_linked_platform_accounts.sql`.
It matches the Phase 1 proposal, with two deliberate differences: the primary
key has no `gen_random_uuid()` default (ids are supplied by the application, and
by the deterministic backfill, so the `pgcrypto` extension is not required), and
the constraint is named after the table.

```sql
CREATE TABLE IF NOT EXISTS linked_platform_accounts (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('steam', 'xbox', 'playstation')),
  provider_user_id  text NOT NULL,
  display_name      text,
  avatar_url        text,
  connection_status text NOT NULL DEFAULT 'connected'
                      CHECK (connection_status IN
                        ('connected', 'reauth_required', 'revoked', 'disconnected', 'error')),
  scopes            text[] NOT NULL DEFAULT '{}'::text[],
  linked_at         timestamptz NOT NULL DEFAULT now(),
  last_sync_at      timestamptz,
  last_sync_status  text CHECK (last_sync_status IN ('idle', 'success', 'partial', 'error')),
  revoked_at        timestamptz,
  CONSTRAINT linked_platform_accounts_revocation_consistency CHECK (
    (connection_status IN ('revoked', 'disconnected')) = (revoked_at IS NOT NULL)
  )
);

-- One provider identity belongs to at most one Nexus account at a time.
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_provider_identity_uniq
  ON linked_platform_accounts (provider, provider_user_id)
  WHERE revoked_at IS NULL;

-- One Nexus account holds at most one active link per provider (V1 rule).
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_one_per_provider_uniq
  ON linked_platform_accounts (user_id, provider)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS linked_accounts_user_idx
  ON linked_platform_accounts (user_id);
```

There is deliberately **no credential column here**, and none is added by this
migration. The integration test asserts the exact column list and fails if a
credential-shaped column ever appears.

**provider / provider_user_id uniqueness semantics.** `revoked_at IS NULL` is
the single source of truth for "active", and the CHECK constraint guarantees a
`revoked`/`disconnected` status always comes with `revoked_at` set — and,
equally, that an active row can never carry a `revoked_at`. The partial unique
indexes therefore free the slot reliably on unlink, while historical rows remain
for audit. Re-linking creates a new row with a new id; it never resurrects a
revoked row. Global uniqueness across all rows would make unlink irreversible,
which is why the indexes are partial. The PostgreSQL integration test proves all
of this at the database level: duplicate active rows are rejected with `23505`,
inconsistent status/`revoked_at` pairs with `23514`, and an unknown provider
with `23514`.

**Relation to the current schema.** `users.steam_id64` stays authoritative until
step 4 of the migration path in `MULTI_PLATFORM_ACCOUNTS.md`; Phase 2A is step
2, and Phase 2B (the identity-resolution flip) is step 3 and is **not** part of
this phase. During the dual window, every existing user is backfilled as exactly
one `steam` row here. Sessions (`017_persistent_desktop_sessions.sql`) need no
change because they already reference `users(id)`, not the Steam identity. RBAC
tables (`user_roles`, `user_permission_overrides`) likewise stay attached to the
Nexus user, and migration 020 does not touch them.

## Backfill of existing Steam users (migration 020)

```sql
INSERT INTO linked_platform_accounts
  (id, user_id, provider, provider_user_id, display_name, avatar_url,
   connection_status, scopes, linked_at)
SELECT
  (md5('nexus:linked-platform-account:steam:' || u.id::text))::uuid,
  u.id, 'steam', trim(u.steam_id64), u.steam_nickname, u.avatar_url,
  'connected', '{}'::text[], u.created_at
FROM users u
WHERE trim(u.steam_id64) ~ '^[0-9]{17}$'
  AND NOT EXISTS (
    SELECT 1 FROM linked_platform_accounts existing
    WHERE existing.user_id = u.id
      AND existing.provider = 'steam'
      AND existing.revoked_at IS NULL
  )
ON CONFLICT DO NOTHING;
```

Backfill behaviour, exactly as implemented:

- **Deterministic.** The primary key is derived from the owning Nexus user, so a
  replay computes the same id instead of minting a second link. Nothing depends
  on `gen_random_uuid()` or on row order.
- **Exactly one active Steam link per user.** The `NOT EXISTS` guard skips any
  user that already has an active Steam link, and `ON CONFLICT DO NOTHING`
  absorbs any remaining collision against the partial unique indexes. Running
  the statement twice produces no second row.
- **Only valid identities.** `trim(u.steam_id64) ~ '^[0-9]{17}$'` filters out
  anything that is not a well-formed SteamID64. `users.steam_id64` is `char(17)`
  and therefore blank-padded, so the stored `provider_user_id` is trimmed — the
  link stores the identity, not the padding.
- **No invented values.** `display_name` and `avatar_url` are copied from
  `users.steam_nickname` / `users.avatar_url` when present and left `NULL`
  otherwise. `last_sync_at` and `last_sync_status` stay `NULL` because no sync
  has run against the link. `scopes` is the empty array: Steam OpenID grants
  none.
- **`linked_at` is honest.** It is set to `users.created_at`, the moment the
  Steam identity actually became known to the product, rather than the time the
  migration happened to run.
- **No user reassignment, no rewriting.** The statement only ever inserts into
  the new table. It contains no `UPDATE users`, no `DELETE FROM users`, no
  `ALTER TABLE users` and no `DROP`, so `users.steam_id64` is preserved
  byte-for-byte and sessions and RBAC are untouched. The integration test
  snapshots every user row before and after and asserts equality.

## Credentials — DEFERRED

Not implemented in Phase 2A and not created by migration 020. Steam OpenID 2.0
is an identity assertion and issues no access or refresh token, so a Steam link
has no credential to store. This table lands in the phase that introduces the
first token-based provider, together with that provider's real key-management,
expiry and revocation requirements.

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

The relationship between a linked account and its credential exists exactly
once, here, enforced by this `UNIQUE` foreign key. The accounts table
deliberately has no credential column of its own — and the applied table proves
it — so there is no duplicated reference to keep in sync. Rules: this table is
written and read only by the backend credential service; no route, projection or
desktop cache may select `ciphertext`; the value is encrypted at rest with a key
referenced by `encryption_key_id`; `credential_ref` and `encryption_key_id` are
backend-only locators and never appear in a desktop-facing projection; Steam
creates no row here because Steam OpenID issues no credential.

Deferring the table does not weaken the boundary: the backend-only module
ownership, the allowlisted public projection and the credential scanners all
remain in force, so the boundary is already in place when the store arrives.

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
                             ('provider_verified','editorial_verified')),
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

-- Per-user suggestions live OUTSIDE the shared catalog. They can never set
-- platform_games.canonical_game_id; promotion happens only by creating a
-- verified mapping through the editorial/provider flow.
CREATE TABLE user_canonical_mapping_suggestions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_game_id           uuid NOT NULL REFERENCES platform_games(id) ON DELETE CASCADE,
  proposed_canonical_game_id uuid NOT NULL REFERENCES canonical_games(id) ON DELETE CASCADE,
  method                     text NOT NULL CHECK (method IN
                               ('user_confirmed','title_similarity_candidate')),
  suggested_by_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                     text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','accepted_as_verified','rejected')),
  suggested_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mapping_suggestions_game_idx
  ON user_canonical_mapping_suggestions (platform_game_id);
```

**Internal ids vs provider keys.** Every table uses an opaque internal `uuid`
primary key. The unique *provider identity* of a game is
`(provider, provider_game_id)`, enforced by `platform_games_identity_uniq`. The
legacy Steam strings (`steam:<appId>`, `steam:<appId>:<apiName>`) are
compatibility keys only: they let the existing runtime be bridged without
re-keying, and they are never database primary keys here.

**Canonical / platform relationship.** One canonical game has zero or more
platform games; a platform game has at most one canonical game. The check
constraint enforces at the database level what
`linkPlatformGameToCanonical()` enforces in the domain: no mapping without
verified evidence. `user_confirmed` and `title_similarity_candidate` are
intentionally absent from `canonical_mapping_method`, so a user confirmation or
a title match can never become a stored shared link; both exist only in the
suggestions table. Deleting a canonical game only detaches its platform rows;
it never deletes provider data.

**Provider normalization.** `platform_games` is the only table that stores a
provider for a game. Ownership and achievement tables deliberately have no
provider column; the provider is always derived through
`platform_game_id → platform_games.provider`.

## Ownership

```sql
-- PROPOSAL ONLY — DO NOT APPLY
CREATE TABLE user_game_ownership (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE INDEX user_game_ownership_game_idx ON user_game_ownership (platform_game_id);
```

The owning Nexus user is derived through `linked_account_id` →
`linked_platform_accounts.user_id`, and the provider is derived through
`platform_game_id` → `platform_games.provider`. The normalized design was chosen
over redundant columns plus composite foreign keys: with no separate per-row
user or provider column, a cross-user or cross-provider ownership row is
structurally impossible and there is nothing to keep in sync on re-link.
Per-user library queries join through the link table, which is indexed on
`user_id` — that index now exists, created by migration 020.

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
```

**Achievement ownership.** The definition belongs to a platform game and is
shared between all users; the unlock fact belongs to a linked account, with the
Nexus user derived through the link exactly like ownership. There is no
canonical achievement table in this proposal, because provider achievement sets
differ for the same canonical title and merging them would invent data.
`unlock_state_known` mirrors the existing Steam merge semantics: unknown is not
locked, and the completion truth contract in the domain (exact only when every
state is known) applies to any read model built on these tables.

**Provider normalization.** `platform_achievements` has no provider column: the
provider identity of an achievement is `platform_achievements → platform_games
→ provider`. Because `platform_game_id` is already provider-scoped and unique
per provider, the identity index `(platform_game_id, provider_achievement_id)`
is sufficient — and an impossible state such as an Xbox achievement row
pointing at a Steam platform game while claiming `provider = 'xbox'` is
unrepresentable.

## Unlink behaviour

Unlinking one provider from a Nexus account:

1. revoke the provider credential when the provider supports revocation, then
   delete the `provider_credentials` row (`planDisconnect()` returns
   `revoke_then_delete`, `delete_only` or `not_applicable`). For Steam this step
   is `not_applicable` and there is no credential row to remove;
2. delete `user_achievement_states` and `user_game_ownership` rows for that
   `linked_account_id`;
3. in one transaction, set `connection_status = 'disconnected'` (or
   `'revoked'`) and `revoked_at = now()` on the link — the CHECK constraint
   requires both together — or delete the row when the user asked for full
   removal. The partial unique indexes immediately free the slot;
4. keep `canonical_games`, `platform_games` and `platform_achievements`, which
   are shared reference data and contain nothing user-specific;
5. leave the Nexus account, its roles, badges, sessions and its past mapping
   suggestions untouched.

Unlinking the last provider is allowed. The Nexus account survives with no
linked accounts, which is exactly why the account cannot be the Steam row.

Note for Phase 2A: no unlink route exists yet. While `users.steam_id64` is still
the login authority, revoking a Steam link would be re-created on the next login
by the dual-write. Unlink becomes meaningful once identity resolution moves to
the link table in Phase 2B.

## Deletion and privacy behaviour

- Account deletion cascades from `users(id)` through links, credentials,
  ownership, unlock state and mapping suggestions, so no user-scoped provider
  data survives. The applied `ON DELETE CASCADE` on
  `linked_platform_accounts.user_id` already guarantees this for links.
- Shared catalog rows are retained; they describe games, not people.
- Audit and sync-log rows keep identifiers and outcomes only, never provider
  profile payloads or credential material. The Phase 2A dual-write log records
  the event, the provider and a sanitised error code — never a Steam ID, user
  id or link id.
- The desktop SQLite cache stores non-sensitive projections and is cleared for
  a provider on unlink; it never receives credentials or credential locators.
- Provider profile fields (`display_name`, `avatar_url`) are refreshed from the
  provider and deleted with the link, so removing a connection removes the
  provider's personal data from the product.
