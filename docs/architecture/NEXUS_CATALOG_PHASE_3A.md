# Nexus Catalog Foundation — Phase 3A

Status: **implementation branch — not deployed, not migrated in staging/production**.

Base after Phase 2B merge: `feature/steam-openid-mvp`.

## Purpose

Phase 3A turns the approved multi-platform catalog/ownership model into additive backend persistence without changing the current Steam desktop library runtime. It is a bridge toward the future backend-only Steam adapter and unified multi-platform library, not the adapter itself.

## Scope

Implemented on this branch:

- migration `021_nexus_catalog_ownership_foundation.sql`;
- `canonical_games`;
- `platform_games`;
- `user_canonical_mapping_suggestions`;
- `user_game_ownership`;
- backend-only `PostgresNexusCatalogRepository`;
- PostgreSQL integration coverage;
- CI gate for the new migration/repository.

Explicitly deferred:

- `platform_achievements` and `user_achievement_states`;
- SteamPlatformAdapter runtime;
- changing the existing desktop Steam library/sync path;
- Xbox/PlayStation runtime or placeholder data;
- provider credentials/tokens;
- Connected Accounts UI or unified-library UI;
- production/staging migration or deploy;
- retirement of `users.steam_id64` constraints (still blocked on operational dual-read proof).

## Integrity decisions

### Canonical mapping evidence

A platform game may point at a canonical game only when the database has the complete verified evidence tuple: method, verifier and verification timestamp. Only `provider_verified` and `editorial_verified` are accepted.

Provider refresh upserts may update provider-owned metadata such as title and timestamps, but they never overwrite or clear canonical mapping evidence.

### Canonical deletion

The original proposal used `ON DELETE SET NULL` for `platform_games.canonical_game_id`. That conflicts with the mapping-evidence check because it would null the canonical id while leaving verification evidence behind. Phase 3A therefore uses `ON DELETE RESTRICT`: detaching a verified mapping must be an explicit future catalog operation that clears the mapping and evidence together before deleting a canonical record.

### Ownership provider truth

`user_game_ownership` deliberately carries neither `user_id` nor `provider`. The owning user is derived from `linked_account_id`; the game provider is derived from `platform_game_id`.

Because two independent foreign keys alone cannot prove that both parents belong to the same provider, migration 021 adds a PostgreSQL trigger that rejects cross-provider ownership with SQLSTATE `23514`. A Steam linked account therefore cannot own an Xbox/PlayStation platform-game row even through direct SQL.

### Playtime truth

Unknown playtime is stored as `NULL` with `playtime_known = false`. A numeric playtime with `playtime_known = false` is rejected, so zero minutes is never confused with unavailable data.

## Rollout

Merging this phase does not authorize applying migration 021 anywhere. The backend service has manual deployment control. Staging/production schema changes remain an explicit separate approval step.

The next runtime phase is the backend-only Steam catalog adapter bridge, which should write the real existing Steam library into these tables while preserving current user-visible behavior.
