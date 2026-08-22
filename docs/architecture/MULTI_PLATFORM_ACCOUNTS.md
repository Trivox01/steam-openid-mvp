# Multi-platform Nexus accounts

Status: Phase 1, architecture only. Nothing described here changes runtime
behaviour today. The current Steam OpenID login, desktop session system, RBAC,
sync services and UI are untouched by this phase.

Target model:

```
Nexus account (owner identity)
├── linked Steam account
├── linked Xbox account        (later phase)
└── linked PlayStation account (later phase)
```

## Current Steam-first assumptions found

These are the places where the code today treats a provider as the identity.
They are recorded, not changed.

**user == Steam identity**

- `services/auth-api/src/storage/postgres/migrations/003_authorization_foundation.sql`
  defines `users.steam_id64` as a required, unique column, so a user row cannot
  exist without a Steam identity.
- `007_user_management_foundation.sql` stores `steam_nickname` and `avatar_url`
  directly on the user row, so provider profile data is user profile data.
- `services/auth-api/src/users/contracts.ts` requires `steamId64` on
  `UserDetails` and `steamNickname` on `UserSummary`, so the admin surface is
  Steam-shaped too.
- The whole public auth surface in `services/auth-api/src/router.ts` is
  `/v1/auth/steam/*`; there is no provider-neutral identity endpoint.
- `src/services/platform/SteamProvider.ts` synthesises a profile
  (`steam-player` / `Steam Player`) when asked for the app user, so the
  frontend notion of "the user" is derived from the Steam provider.

One useful exception: `017_persistent_desktop_sessions.sql` and
`src/repositories/steamOpenIdDesktopRepository.ts` bind sessions to the internal
`users.id`, not to the Steam ID. The session layer is therefore already
compatible with a Nexus identity; only user lookup/creation is Steam-keyed.

**game == Steam game**

- `src/types/index.ts` gives `Game` a required `appId` plus a `platform` field,
  mixing the canonical title and the provider entry in one record.
- `SteamProvider.ts` builds game ids as `steam:<appId>`, so the primary key of a
  library row is a Steam key.
- `src/types/library.ts` (`LibraryFilter`, `LibraryQuery`, `LibraryPage`) has no
  provider dimension: the library is assumed to be one flat Steam list.
- `src/repositories/contracts.ts` exposes
  `SyncMetadataRepository.getSyncMetadata(platformId)`, keyed by a platform
  string rather than by a linked account.

**achievement == Steam achievement**

- Achievement ids are `steam:<appId>:<apiName>` and `Achievement.source` accepts
  `"steam-achievements"`, so provider vocabulary leaks into the shared type.
- `SteamAchievementSyncService` / `SteamAchievementMerge` own the only unlock
  pipeline, and unlock state is attached to the game row, not to an account.

## Why the Nexus account is independent from Steam

A user must be able to connect more than one platform account, disconnect one,
or connect a second one later without losing their identity, roles, badges or
history. If the user row *is* the Steam row, then:

- disconnecting Steam would mean deleting the account;
- a second provider would have no owner to attach to;
- RBAC and audit rows would silently change meaning when a provider link
  changes;
- a user with only an Xbox account could never exist.

So the Nexus account is the owner identity, and every provider account is a
`LinkedPlatformAccount` row that points at it. Steam becomes the first linked
provider, not the identity.

## Linked provider architecture

```
NexusUser (id, displayName, status, roles)
   └── LinkedPlatformAccount[]
          id, userId, provider, providerUserId, displayName,
          connectionStatus, scopes, tokenMetadata?, linkedAt,
          lastSyncAt, lastSyncStatus
```

Rules encoded in `src/domain/nexus/identity.ts`:

- linking requires an authenticated Nexus user; there is no implicit
  "login created a link" path;
- a provider identity (`provider` + `providerUserId`) may be attached to at most
  one Nexus account at a time;
- a Nexus account holds at most one active link per provider;
- a revoked or disconnected link frees the slot again;
- matching email addresses are never sufficient evidence to link.

`connectionStatus` (`connected`, `reauth_required`, `revoked`, `disconnected`,
`error`) is what the future Connected Accounts UI will render. Sync state
(`lastSyncAt`, `lastSyncStatus`) belongs to the link, not to the user, because
each provider syncs on its own schedule and can fail independently.

## Canonical game vs platform game

`CanonicalGame` is the product-level title. `PlatformGame` is one provider's
concrete entry for it.

```
CanonicalGame "Cyberpunk 2077"
   ├── PlatformGame steam / 1091500
   ├── PlatformGame xbox / <product id>
   └── PlatformGame playstation / <title id>
```

- ownership, playtime, artwork and achievements hang off `PlatformGame`,
  because they are provider facts;
- `PlatformGame.canonicalGameId` is optional and starts empty;
- a link is only created through `linkPlatformGameToCanonical()`, which rejects
  any mapping that is not verified;
- `candidateMappingFromTitleMatch()` exists so a future matching phase has a
  typed place for hints, and it is deliberately built so the domain refuses to
  persist it: identical titles are not evidence;
- unmapped platform games never merge. `groupOwnershipByCanonical()` keeps them
  as separate, provider-scoped groups.

This is why a unified library is a *view* over verified mappings, not a
deduplication heuristic.

## Achievement ownership

- `PlatformAchievement` is a definition and belongs to a `PlatformGame`.
  Achievement sets differ per provider even for the same canonical title, so
  there is no canonical achievement concept in this phase.
- `UserAchievementState` is the unlock fact and belongs to a
  `LinkedPlatformAccount`, because the achievement was earned on that account.
- `unlockStateKnown` preserves the existing Steam semantics: a definition can
  arrive without a trustworthy unlock state, and unknown must never be counted
  as locked. `summarizeAchievementProgress()` computes completion over known
  state only and returns `null` when nothing is known.
- Provider scores are not a shared currency. Gamerscore and trophy grades are
  never summed or compared across providers
  (`canCompareProviderScores()`).

Effect of unlinking: the definitions stay (shared reference data), the user's
unlock rows for that link are removed.

## Adapter boundaries

`PlatformAdapter` (`src/domain/nexus/adapter.ts`) is the shared data contract:
`provider`, `capabilities`, `getProfile()`, `syncLibrary()`, `syncGame()`,
`syncAchievements()`, `disconnect()`.

Deliberately **not** part of the adapter: account linking. Steam OpenID 2.0 is
an identity assertion with no tokens; Xbox and PlayStation linking is
undetermined until their discovery phase. Forcing them through one login method
would encode a false abstraction, so linking is described by a separate,
provider-shaped `AccountLinkStrategy`.

An adapter never receives credentials. It receives an `AdapterContext`
(`nexusUserId`, `linkedAccountId`, `providerUserId`) and resolves anything
sensitive server-side.

Boundary the code will follow:

```
Nexus identity / session
   ↓
Achievement Nexus backend (adapters, credential store)
   ↓
Linked platform accounts
   ↓
Steam / Xbox / PlayStation APIs
```

A future `SteamPlatformAdapter` is a thin wrapper: `SteamLibrarySyncService`,
`SteamAchievementSyncService`, `SteamBackendDataClient` and `steamArtwork` keep
their current behaviour and are called by the adapter, not replaced by it.
`src/domain/nexus/steamCompatibility.ts` already maps the existing Steam DTOs
onto the new records and keeps the existing `steam:<appId>` and
`steam:<appId>:<apiName>` id conventions so a later migration can reuse rows
instead of re-keying them.

## Security and token boundaries

- Provider access tokens, refresh tokens and provider secrets are server-side
  only, encrypted at rest, and never appear in React, frontend persistence, the
  desktop SQLite cache, source control or logs.
- The domain type cannot carry a token: `ProviderTokenMetadata` holds an opaque
  `credentialRef`, an `encryptionKeyId`, expiry timestamps and a
  `revocationSupported` flag. The secret itself lives only in the credential
  store behind that reference.
- `findRawCredentialFields()` / `assertNoRawCredentials()` are structural guards
  for any payload crossing a trust boundary, and are exercised by the
  validators.
- Disconnect is a plan, not a delete statement: `planDisconnect()` returns
  `revoke_then_delete` when the provider supports revocation, `delete_only`
  otherwise, and `not_applicable` for Steam, which issues no credential. It also
  states that user-scoped ownership and unlock rows are removed while shared
  catalog rows are retained.
- The desktop SQLite cache stays a cache of non-sensitive projections only.
- Linking always requires an authenticated Nexus user and an explicit user
  action. Email matching is rejected in code, not by convention.

SuperTokens is only a *candidate* for a future Nexus session layer. No SDK, no
connection URI, no API key and no cookie change is introduced in this phase, and
the existing hardened Steam OpenID session system remains the only session
authority.

## Capability differences

Providers do not expose the same data. `ProviderCapabilities` marks each of
`library`, `achievements`, `playtime`, `presence`, `game_metadata` as
`supported`, `unsupported` or `unverified`.

| provider | status | library | achievements | playtime | presence | game_metadata |
| --- | --- | --- | --- | --- | --- | --- |
| steam | proven | supported | supported | supported | unverified | supported |
| xbox | unimplemented | unverified | unverified | unverified | unverified | unverified |
| playstation | unimplemented | unverified | unverified | unverified | unverified | unverified |

`unverified` is the honest default and is never treated as a yes. Only
`supported` may unlock UI or data, through `supportsCapability()` /
`adapterSupports()`. `visibleCapabilities("xbox")` is therefore empty today, so
no Xbox or PlayStation surface can appear before real connected data exists.
Unsupported sync requests return an explicit `unsupported` outcome with zeroed
counters rather than empty results that look like a successful sync.

## Migration path

Each step is separately reversible and none of them is executed in this phase.

1. **Phase 1 (this change).** Domain contracts, adapter boundaries, capability
   model, validators, architecture and database proposal. No runtime wiring.
2. **Introduce the link table.** Apply the proposed `linked_platform_accounts`
   table in staging, backfill exactly one `steam` row per existing user from
   `users.steam_id64`, and dual-write on Steam login. `users.steam_id64` stays
   authoritative during this window.
3. **Flip identity resolution.** Resolve login as *provider identity → linked
   account → Nexus user* behind a flag. Sessions need no change: they already
   reference `users.id`.
4. **Retire the Steam column.** Only after dual-read is proven, drop the
   not-null/unique constraints on `users.steam_id64` and treat it as legacy.
   Uniqueness now lives on `(provider, provider_user_id)`.
5. **Catalog tables and the Steam adapter.** Add canonical/platform game,
   ownership and achievement tables, then wrap the existing Steam sync services
   in `SteamPlatformAdapter`. Behaviour must stay identical.
6. **Connected Accounts UI and unified library.** Only once real linked data
   exists, gated by capability flags.
7. **Second provider.** Discovery for Xbox or PlayStation: real capability
   measurement first, then linking, then sync.
8. **Optional Nexus session layer.** Evaluate SuperTokens or an equivalent as a
   separate decision, after identity is provider-neutral.

## What Phase 1 implements

- `src/domain/nexus/provider.ts` — provider union, capability model, provider
  descriptors, capability gates.
- `src/domain/nexus/identity.ts` — `NexusUser`, `LinkedPlatformAccount`,
  token metadata, linking policy, disconnect plan, credential guards.
- `src/domain/nexus/catalog.ts` — `CanonicalGame`, `PlatformGame`,
  `UserGameOwnership`, verified-mapping rules, grouping helper.
- `src/domain/nexus/achievements.ts` — `PlatformAchievement`,
  `UserAchievementState`, progress and score-comparison rules.
- `src/domain/nexus/adapter.ts` — `PlatformAdapter`, sync outcomes, link
  strategies, capability-refusal helpers.
- `src/domain/nexus/steamCompatibility.ts` — pure, inert mappings from the
  existing Steam DTOs to the new records.
- `src/domain/nexus/validation.ts` and
  `scripts/validate-nexus-platform-foundation.mjs` — contract validators plus
  Phase 1 boundary guards.
- `docs/architecture/MULTI_PLATFORM_ACCOUNTS.md` and
  `docs/architecture/MULTI_PLATFORM_DB_PROPOSAL.md`.

## What later phases defer

Intentionally not implemented here: Xbox login, PlayStation login, SuperTokens,
Connected Accounts UI, unified library UI, applied database migrations, provider
token storage, provider OAuth callbacks, automatic canonical-game matching, and
any placeholder Xbox or PlayStation data. No existing UI, validator, session or
sync behaviour was modified.
