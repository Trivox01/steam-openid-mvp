# Multi-platform Nexus accounts

Status: Phase 1, architecture only (final structural cleanup). Nothing
described here changes runtime behaviour today. The current Steam OpenID login,
desktop session system, RBAC, sync services and UI are untouched by this phase.

Target model:

```
Nexus account (owner identity)
├── linked Steam account
├── linked Xbox account        (later phase)
└── linked PlayStation account (later phase)
```

## Module ownership

The trust boundary is enforced structurally, by module location — not by
comments:

| location | owner | contents |
| --- | --- | --- |
| `src/domain/nexus/` | desktop-safe shared domain | provider + capability model, `NexusUser`, the `LinkedPlatformAccountPublic` projection, `CanonicalGame` / `PlatformGame` / ownership, achievement contracts + completion truth, Steam compatibility mappings |
| `services/auth-api/src/nexus/` | backend-only | `LinkedPlatformAccount` server record, `ProviderCredentialMetadata`, the public-projection mapper, account linking/disconnect policy, credential scanners, `PlatformAdapter` + `AdapterContext` + sync DTOs |

The desktop domain barrel (`src/domain/nexus/index.ts`) deliberately does not
re-export anything from the backend tree, so `ProviderCredentialMetadata`,
`AdapterContext` and the credential-resolving `PlatformAdapter` cannot be
imported through it. The validators prove this by inspecting both the barrel
source and its runtime namespace.

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
history. A person with **no Steam account at all** must also be able to create
and use a Nexus account (see Migration path, Stage B). If the user row *is* the
Steam row, then:

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
   └── LinkedPlatformAccount[]        (backend server record, services/auth-api/src/nexus/identity.ts)
          └── LinkedPlatformAccountPublic   (desktop-facing projection, src/domain/nexus/identity.ts)
```

Rules encoded in the backend-owned policy module
(`services/auth-api/src/nexus/identity.ts`):

- linking requires an authenticated Nexus user; there is no implicit
  "login created a link" path;
- a provider identity (`provider` + `providerUserId`) may be attached to at most
  one Nexus account at a time;
- a Nexus account holds at most one active link per provider (V1 rule);
- a revoked or disconnected link frees the slot again. A link is active iff
  `connection_status` is not `revoked`/`disconnected`, and the database proposal
  ties those terminal statuses to `revoked_at` with a CHECK constraint so the
  uniqueness slot frees reliably;
- matching email addresses are never sufficient evidence to link.

`connectionStatus` (`connected`, `reauth_required`, `revoked`, `disconnected`,
`error`) is what the future Connected Accounts UI will render. Sync state
(`lastSyncAt`, `lastSyncStatus`) belongs to the link, not to the user, because
each provider syncs on its own schedule and can fail independently.

The desktop never receives the backend record. It receives only
`LinkedPlatformAccountPublic`, an explicit allowlisted projection (see Security
and token boundaries).

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
- **trust model:** only `provider_verified` and `editorial_verified` may create
  a shared, globally verified mapping, via `linkPlatformGameToCanonical()`.
  `user_confirmed` is deliberately NOT a mapping method: a single user's
  confirmation only produces a `UserCanonicalMappingSuggestion`, which lives
  outside `PlatformGame` (its own table in the database proposal) and stays
  `pending` until editorial/provider verification. A validator proves that a
  forged `user_confirmed` mapping is rejected with
  `unverified_mapping_rejected`;
- title similarity is not a mapping at all: `candidateMappingFromTitleMatch()`
  returns a `CanonicalMatchCandidate`, a candidate-only hint type that can never
  be persisted as a shared link. Identical titles are not evidence;
- unmapped platform games never merge. `groupOwnershipByCanonical()` keeps them
  as separate, provider-scoped groups;
- **normalization:** `PlatformGame` owns `provider` + `providerGameId`.
  `UserGameOwnership` deliberately carries no `provider` field — the provider is
  derived via the referenced `PlatformGame`, so an ownership row can never
  disagree with its game about which provider it belongs to.

This is why a unified library is a *view* over verified mappings, not a
deduplication heuristic, and why no user action can rewrite global catalog
truth.

## Identity and key strategy

Three different kinds of identifier exist, and they must not be conflated:

| kind | example | role |
| --- | --- | --- |
| internal entity id | `PlatformGame.id` (opaque, future UUID) | database primary key |
| provider natural key | `(provider, providerGameId)`, e.g. `steam` + `1091500` | unique provider identity |
| legacy Steam compatibility key | `steam:1091500`, `steam:1091500:ACH_WIN_ONE_GAME` | compatibility with existing runtime rows only |

- `PlatformGame.id` and `PlatformAchievement.id` are internal opaque ids. The
  unique provider identity is `provider` + `providerGameId` for games and
  `platformGameId` + `providerAchievementId` for achievements.
- `legacySteamGameKey()` and `legacySteamAchievementKey()` exist so the current
  Steam runtime can be bridged onto the new model without re-keying existing
  rows. The Phase 1 compatibility helpers reuse those legacy keys as stand-in
  ids, but they are **compatibility keys, not future database primary keys**.
  A later migration assigns real internal ids.
- `platformGameKey()` / `platformAchievementKey()` return the provider natural
  key, not an entity id, and never become duplicated authoritative state on a
  stored entity.

## Achievement ownership

- `PlatformAchievement` is a definition and belongs to a `PlatformGame`.
  Achievement sets differ per provider even for the same canonical title, so
  there is no canonical achievement concept in this phase.
- **Provider normalization:** `PlatformAchievement` carries no `provider`
  field. The provider identity of an achievement is derived —
  `PlatformAchievement → PlatformGame → provider` — so an impossible state such
  as an Xbox achievement attached to a Steam platform game is unrepresentable.
- `UserAchievementState` is the unlock fact and belongs to a
  `LinkedPlatformAccount`. It carries no redundant `userId`; the owning Nexus
  user is derived through the linked account, so a cross-user row is
  structurally impossible.
- **Completion truth contract:**
  - `total === 0` or `known === 0` → `completionPercentage = null`;
  - `unknown > 0` → `completionPercentage = null`;
  - only when every state is known may `completionPercentage` be exact;
  - `knownCompletionPercentage` is a diagnostic/internal-only figure computed
    over known states. It is explicitly non-exact and must never be presented
    as the user-facing completion percentage;
  - unknown unlock state is never presented as locked.
- Provider scores are not a shared currency. Gamerscore and trophy grades are
  never summed or compared across providers (`canCompareProviderScores()`).

Effect of unlinking: the definitions stay (shared reference data), the user's
unlock rows for that link are removed.

## Adapter boundaries

Trust boundary:

```
Desktop/Tauri
   ↓  safe DTOs only (requests, projections, sync results)
Achievement Nexus Backend
   ↓  resolves provider credentials server-side
Provider Adapter (BACKEND-ONLY)
   ↓
Steam / Xbox / PlayStation APIs
```

- `PlatformAdapter` is a **backend-owned runtime interface** and lives at
  `services/auth-api/src/nexus/adapter.ts`. An adapter that resolves provider
  credentials must never execute in React/Tauri — and the desktop barrel cannot
  re-export it, which the validators prove.
- `AdapterContext` (`nexusUserId`, `linkedAccountId`, `providerUserId`) is
  backend-only: it is how the backend resolves the linked account and any
  credential, and it is never serialised to the desktop.
- The sync result DTOs (`ProviderProfile`, sync outcomes, `SyncCounters`,
  `DisconnectOutcome`) are defined backend-side in Phase 1. If the desktop ever
  needs them, genuinely safe DTOs can be hoisted into `src/domain/nexus` later;
  nothing desktop-side imports them today.
- The desktop receives only safe projections and results, e.g.
  `LinkedPlatformAccountPublic`. It never receives a credential, a credential
  locator, or a credential-resolving object.
- Account linking stays provider-shaped (`AccountLinkStrategy`): Steam OpenID
  2.0 is an identity assertion with no tokens; Xbox and PlayStation linking is
  undetermined until discovery. No fake shared auth protocol.
- A future `SteamPlatformAdapter` is a thin backend wrapper:
  `SteamLibrarySyncService`, `SteamAchievementSyncService`,
  `SteamBackendDataClient` and `steamArtwork` keep their current behaviour and
  are called by the adapter, not replaced by it.
- Phase 1 defines the boundary only. No backend adapter is implemented yet.

## Security and token boundaries

- **The primary security boundary is the explicit allowlisted projection.**
  `LinkedPlatformAccountPublic` names every field that may cross to the
  desktop; `credentialRef` and `encryptionKeyId` are not part of it, and
  neither is the internal `userId` mapping.
- `ProviderCredentialMetadata` is backend-only and lives in
  `services/auth-api/src/nexus/identity.ts`. The token itself lives only in the
  server-side, encrypted credential store behind the opaque `credentialRef`.
- `findRawCredentialFields()` / `assertNoRawCredentials()` remain as
  **defense-in-depth test helpers only**, backend-side. Scanning a blacklist of
  suspicious key names is not proof that a payload contains no secret, and
  these helpers are never treated as the primary boundary.
- Provider access tokens, refresh tokens and provider secrets are server-side
  only, encrypted at rest, and never appear in React, frontend persistence, the
  desktop SQLite cache, source control or logs.
- Disconnect is a plan, not a delete statement: `planDisconnect()` returns
  `revoke_then_delete` when the provider supports revocation, `delete_only`
  otherwise, and `not_applicable` for Steam, which issues no credential. It
  also states that user-scoped ownership and unlock rows are removed while
  shared catalog rows are retained.
- Linking always requires an authenticated Nexus user and an explicit user
  action. Email matching is rejected in code, not by convention.
- SuperTokens is only a *candidate* for a future Nexus session layer. No SDK,
  no connection URI, no API key and no cookie change is introduced in this
  phase, and the existing hardened Steam OpenID session system remains the only
  session authority.

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

### Stage A — Transitional stage: existing Steam-authenticated users link additional providers

1. **Phase 1 (this change).** Domain contracts, adapter boundaries, capability
   model, validators, architecture and database proposal. No runtime wiring.
2. **Introduce the link table.** Apply the proposed `linked_platform_accounts`
   table (and the credential store) in staging, backfill exactly one `steam`
   row per existing user from `users.steam_id64`, and dual-write on Steam
   login. The current Steam session remains the session authority.
3. **Flip identity resolution.** Resolve login as *provider identity → linked
   account → Nexus user* behind a flag. Sessions need no change: they already
   reference `users.id`.
4. **Retire the Steam column.** Only after dual-read is proven, drop the
   not-null/unique constraints on `users.steam_id64` and treat it as legacy.
   Uniqueness now lives on `(provider, provider_user_id)`.
5. **Catalog tables and the Steam adapter.** Add canonical/platform game,
   ownership and achievement tables, then wrap the existing Steam sync services
   in a backend-only `SteamPlatformAdapter`. Behaviour must stay identical.

### Stage B — Provider-neutral onboarding

6. **Provider-neutral Nexus auth.** New users can create a Nexus account and
   authenticate independently of any gaming provider (email/password or
   equivalent), then link zero or more providers. A user with no Steam account
   is a first-class case, not an edge case. SuperTokens remains only a
   candidate session layer for this; nothing is integrated now.
7. **Connected Accounts UI and unified library.** Only once real linked data
   exists, gated by capability flags.
8. **Second provider.** Xbox or PlayStation discovery → linking → sync. Full
   Xbox/PlayStation onboarding depends on Stage B: provider-neutral Nexus auth
   is a **prerequisite** for it, not an afterthought placed after the final
   provider rollout.
9. **Optional Nexus session layer.** Evaluate SuperTokens or an equivalent as a
   separate, later decision.

## What Phase 1 implements

Desktop-safe shared domain (`src/domain/nexus/`):

- `provider.ts` — provider union, capability model, provider descriptors,
  capability gates.
- `identity.ts` — `NexusUser` and the allowlisted `LinkedPlatformAccountPublic`
  projection only. No server record, no credential types, no policy.
- `catalog.ts` — `CanonicalGame`, `PlatformGame`, `UserGameOwnership` (no
  redundant user id, no duplicated provider), verified-only mapping rules,
  `UserCanonicalMappingSuggestion`, `CanonicalMatchCandidate`, legacy Steam
  compatibility keys, grouping helper.
- `achievements.ts` — `PlatformAchievement` (provider derived via the
  PlatformGame), `UserAchievementState`, the completion truth contract, score
  rules, legacy achievement compatibility key.
- `steamCompatibility.ts` — pure, inert mappings from the existing Steam DTOs
  to the new desktop-safe records, using legacy keys as stand-in ids.

Backend-owned contracts (`services/auth-api/src/nexus/`):

- `identity.ts` — `LinkedPlatformAccount` server record,
  `ProviderCredentialMetadata`, the public-projection mapper, account
  linking/disconnect policy, the Steam-identity linking mapper,
  defense-in-depth credential scanners.
- `adapter.ts` — the backend-owned `PlatformAdapter` contract,
  `AdapterContext`, sync outcomes, link strategies, capability-refusal helpers.
- `index.ts` — backend barrel.

Validators and documentation:

- `scripts/validate-nexus-platform-foundation.mjs` — domain contract assertions
  plus structural boundary guards (barrel exposure, module location, provider
  normalization, proposal shape).
- `docs/architecture/MULTI_PLATFORM_ACCOUNTS.md` and
  `docs/architecture/MULTI_PLATFORM_DB_PROPOSAL.md`.

## What later phases defer

Intentionally not implemented here: Xbox login, PlayStation login, SuperTokens,
Connected Accounts UI, unified library UI, applied database migrations, provider
token storage, provider OAuth callbacks, automatic canonical-game matching, the
backend adapter runtime, the credential store, and any placeholder Xbox or
PlayStation data. No existing UI, validator, session or sync behaviour was
modified.
