# Multi-platform Nexus accounts

Status:

| phase | scope | state |
| --- | --- | --- |
| Phase 1 | domain contracts, adapter boundaries, capability model, validators, docs | **completed** (architecture only, no runtime change) |
| Phase 2A | Steam transitional linked-account persistence: migration 020, backend storage/service, flag-gated dual-write | **implemented on this branch** |
| Phase 2B | flip identity resolution to linked accounts | **next phase — not this one** |

What Phase 2A does **not** change: `users.steam_id64` is still the
authoritative login identity, Steam OpenID verification, access tokens,
persistent desktop sessions, `session_epoch`, RBAC, account-status checks, the
desktop session protocol, the Steam profile/library behaviour and the UI are all
untouched. The linked-account row is additive metadata.

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
| `services/auth-api/src/nexus/` | backend-only | `LinkedPlatformAccount` server record, `ProviderCredentialMetadata`, the public-projection mapper, account linking/disconnect policy, credential scanners, `PlatformAdapter` + `AdapterContext` + sync DTOs, and (Phase 2A) `linkedAccountRepository.ts` + `linkedAccountService.ts` |

The desktop domain barrel (`src/domain/nexus/index.ts`) deliberately does not
re-export anything from the backend tree, so `ProviderCredentialMetadata`,
`AdapterContext`, the credential-resolving `PlatformAdapter` and the Phase 2A
persistence layer cannot be imported through it. The validators prove this by
inspecting both the barrel source and its runtime namespace, and by scanning the
whole `src/` tree for imports of the backend linked-account modules.

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
Phase 2A relies on exactly this: it adds the link row without touching sessions.

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
(`services/auth-api/src/nexus/identity.ts`) and, since Phase 2A, enforced by the
database as well:

- linking requires an authenticated Nexus user; there is no implicit
  "login created a link" path;
- a provider identity (`provider` + `providerUserId`) may be attached to at most
  one Nexus account at a time;
- a Nexus account holds at most one active link per provider (V1 rule);
- a revoked or disconnected link frees the slot again. A link is active iff
  `revoked_at IS NULL`, and a CHECK constraint ties the terminal statuses
  `revoked`/`disconnected` to `revoked_at` so the uniqueness slot frees
  reliably;
- matching email addresses are never sufficient evidence to link.

`connectionStatus` (`connected`, `reauth_required`, `revoked`, `disconnected`,
`error`) is what the future Connected Accounts UI will render. Sync state
(`lastSyncAt`, `lastSyncStatus`) belongs to the link, not to the user, because
each provider syncs on its own schedule and can fail independently.

The desktop never receives the backend record. It receives only
`LinkedPlatformAccountPublic`, an explicit allowlisted projection (see Security
and token boundaries). Phase 2A ships no desktop or public route at all.

## Phase 2A — Steam transitional link persistence

Phase 2A is Stage A, step 2 of the migration path. It makes the link table real
for Steam only, without moving the authority for login.

```
Steam OpenID verification      (unchanged)
   → users.steam_id64 resolution   (unchanged, still authoritative)
   → existing Nexus user           (unchanged, users.id)
   → ensure linked_platform_accounts Steam row   ← added by Phase 2A
   → session creation              (unchanged)
```

**What was implemented**

- `020_nexus_linked_platform_accounts.sql` creates `linked_platform_accounts`
  with the Phase 1 partial unique-index design, and backfills exactly one
  active Steam link per existing valid user. See
  `MULTI_PLATFORM_DB_PROPOSAL.md` for the applied SQL and the backfill rules.
- `services/auth-api/src/nexus/linkedAccountRepository.ts` — backend-only
  persistence: `findActiveByProviderIdentity`, `findActiveByUserAndProvider`,
  `listByUser`, `insert`, `updateProfile`, plus an in-memory implementation for
  tests. Unique-index violations surface as `LinkedAccountUniqueViolation`
  carrying which slot was hit, so the database stays authoritative under
  concurrency instead of being second-guessed by a read-then-write race.
- `services/auth-api/src/nexus/linkedAccountService.ts` —
  `ensureSteamLinkedAccount()` for an already-resolved Nexus user. It is
  idempotent, refreshes only profile fields, and never stores credentials.
- The dual-write hook is an optional 5th constructor argument on
  `SessionTokenService`, invoked inside `issueForSteamIdentity` after the user
  is resolved and before the session is issued. Because
  `DesktopSessionService.issueForSteamIdentity` delegates to it, one hook covers
  both the web and desktop session paths.

**Integrity: a provider identity is never silently moved**

- Steam ID X already active on Nexus user A, code tries to link it to user B →
  `LinkedAccountConflictError` with code
  `PROVIDER_IDENTITY_OWNED_BY_ANOTHER_USER`. Nothing is written.
- Nexus user A already has active Steam identity X, code tries to link Y →
  `USER_ALREADY_LINKED_TO_ANOTHER_PROVIDER_IDENTITY`. The existing link is never
  replaced.
- A malformed Steam ID → `INVALID_PROVIDER_IDENTITY`, rejected before any write.
- Migration backfill follows the same fail-closed rule: only an already-active
  exact `(user_id, steam, provider_user_id)` mapping is skipped. A mismatched
  active provider identity is left to the partial unique indexes and aborts the
  migration instead of being silently absorbed.

The hook is wired non-fatally: a conflict is logged as an operational signal
(event, provider and error code only — never a user id or a Steam ID) and never
turns into a login outage. Login correctness does not depend on the link.

**Rollout sequence**

The dual-write is gated by the backend-only environment flag
`NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED`, default `false`. There is no
frontend flag, and the validators fail if the name ever appears in `src/`.

1. Migration 020 exists and is applied **in staging**. The table is created and
   the backfill runs; nothing reads the table yet.
2. Validate the backfill in staging: one active Steam link per user, ids
   deterministic, `users.steam_id64` byte-identical to before.
3. Enable `NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED=true` in staging only.
4. Validate idempotency: repeated Steam logins create no duplicate row, and the
   conflict codes appear only for genuinely conflicting identities.
5. Production only after explicit approval. **The flag is not enabled in
   production by this phase, and no production migration or deploy was
   performed.**

**Rollback behaviour**

- *Flag off.* Setting `NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED` back to `false`
  (or unsetting it) instantly restores the previous behaviour: the hook is not
  constructed, so Steam authentication performs exactly the statements it did
  before Phase 2A. Existing link rows are simply left in place and unread.
- *Schema.* Migration 020 is purely additive — it creates one table, two partial
  unique indexes and one ordinary index, and inserts into that new table only.
  It never updates, deletes or alters `users`, `desktop_sessions` or any RBAC
  table, so rolling the backend back to a pre-020 build needs no schema change:
  the old code never references the new table.
- *Full removal.* If the table must go, dropping `linked_platform_accounts`
  loses only derived data, because every value in it is reconstructible from
  `users.steam_id64` by re-running the backfill. That is the whole point of
  keeping `users.steam_id64` authoritative until Phase 2B.
- *Replay.* Re-running the migration is safe for an already-correct state: the
  table uses `CREATE TABLE IF NOT EXISTS`, the backfill derives a deterministic
  primary key per user, skips an already-active exact Steam mapping, and uses
  `ON CONFLICT (id) DO NOTHING` only for that deterministic primary-key replay.
  Conflicts on `(provider, provider_user_id)` or `(user_id, provider)` remain
  fail-closed and stop the migration.

**Explicitly out of scope for Phase 2A:** identity resolution via
`linked_platform_accounts` (that is Phase 2B), the provider credential store,
provider tokens, Xbox/PlayStation login, OAuth callbacks, Connected Accounts UI,
unified library UI, SuperTokens, provider-neutral signup, catalog tables, the
`SteamPlatformAdapter` runtime, and any change to the `users.steam_id64`
constraints.

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
truth. None of these tables exist yet; Phase 2A created the link table only.

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
- The same separation holds for the applied link table:
  `linked_platform_accounts.id` is an internal opaque uuid, while
  `(provider, provider_user_id)` is the provider natural key. The Phase 2A
  backfill derives the uuid deterministically from the owning user so a replay
  cannot mint a second identifier for the same link.

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
  `DisconnectOutcome`) are defined backend-side. If the desktop ever needs
  them, genuinely safe DTOs can be hoisted into `src/domain/nexus` later;
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
- Phase 1 defined the boundary; Phase 2A still implements **no** adapter. The
  Phase 2A service writes a link row and nothing else — it calls no provider
  API.

## Security and token boundaries

- **The primary security boundary is the explicit allowlisted projection.**
  `LinkedPlatformAccountPublic` names every field that may cross to the
  desktop; `credentialRef` and `encryptionKeyId` are not part of it, and
  neither is the internal `userId` mapping.
- `ProviderCredentialMetadata` is backend-only and lives in
  `services/auth-api/src/nexus/identity.ts`. The token itself would live only in
  the server-side, encrypted credential store behind the opaque
  `credentialRef`.
- **The provider credential store is deferred, not weakened.** Steam OpenID 2.0
  is an identity assertion: it issues no access token and no refresh token, so
  a Steam link has nothing to store. Building an encrypted credential store now
  would mean shipping, and having to secure and review, an unused secret store.
  `provider_credentials` is therefore implemented in the phase that introduces
  the first token-based provider (Xbox or PlayStation), together with the real
  key-management and revocation requirements of that provider. Until then the
  applied table has no credential column at all, and the tests assert that no
  credential-shaped column or field exists.
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
- Phase 2A logs the dual-write outcome with the event name, the provider and,
  on failure, a sanitised error code only. No Steam ID, user id or link id is
  logged.
- SuperTokens is only a *candidate* for a future Nexus session layer. No SDK,
  no connection URI, no API key and no cookie change is introduced, and the
  existing hardened Steam OpenID session system remains the only session
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

The applied table accepts `xbox` and `playstation` in its provider CHECK so the
schema does not need another migration later, but no code path can create such
a row: only `ensureSteamLinkedAccount()` writes links, and no Xbox or
PlayStation login exists.

## Migration path

Each step is separately reversible.

### Stage A — Transitional stage: existing Steam-authenticated users link additional providers

1. **Phase 1 — completed.** Domain contracts, adapter boundaries, capability
   model, validators, architecture and database proposal. No runtime wiring.
2. **Phase 2A — completed on this branch.** Apply the
   `linked_platform_accounts` table in staging, backfill exactly one `steam`
   row per existing user from `users.steam_id64`, and dual-write on Steam login
   behind `NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED`. The current Steam session
   remains the session authority and `users.steam_id64` remains the login
   authority. The credential store is deliberately **not** part of this step.
3. **Phase 2B — identity resolution rollout.** With
   `NEXUS_LINKED_ACCOUNTS_IDENTITY_RESOLUTION_ENABLED=true`, resolve
   *provider identity → linked account → Nexus user* first, then fall back to
   `users.steam_id64` only when the active Steam link is absent. The flag is
   default-off; invalid or conflicting mappings fail closed and never create or
   move a mapping. Sessions need no change: they still reference `users.id`.
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
7. **Provider credential store.** Implemented together with the first
   token-based provider, because that is the first time there is a credential
   to protect.
8. **Connected Accounts UI and unified library.** Only once real linked data
   exists, gated by capability flags.
9. **Second provider.** Xbox or PlayStation discovery → linking → sync. Full
   Xbox/PlayStation onboarding depends on Stage B: provider-neutral Nexus auth
   is a **prerequisite** for it, not an afterthought placed after the final
   provider rollout.
10. **Optional Nexus session layer.** Evaluate SuperTokens or an equivalent as a
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
  normalization, proposal shape, and the Phase 2A backend-only persistence
  boundary).
- `docs/architecture/MULTI_PLATFORM_ACCOUNTS.md` and
  `docs/architecture/MULTI_PLATFORM_DB_PROPOSAL.md`.

## What Phase 2A implements

- `services/auth-api/src/storage/postgres/migrations/020_nexus_linked_platform_accounts.sql`
  — the applied table, its two partial unique indexes, the revocation
  consistency CHECK and the deterministic Steam backfill.
- `services/auth-api/src/nexus/linkedAccountRepository.ts` — in-memory and
  PostgreSQL implementations of the backend-only persistence contract.
- `services/auth-api/src/nexus/linkedAccountService.ts` —
  `ensureSteamLinkedAccount()` with the two integrity conflict codes.
- `services/auth-api/src/config.ts` — the optional, default-off
  `NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED` flag.
- `services/auth-api/src/authorization/sessionTokenService.ts` — the optional,
  additive dual-write hook placed between user resolution and session issuance.
- `services/auth-api/src/storage/storageFactory.ts` and
  `services/auth-api/src/server.ts` — wiring, flag gating and sanitised logging.
- `services/auth-api/tests/nexusLinkedAccounts.test.ts` and
  `services/auth-api/tests/postgres.nexusLinkedAccounts.integration.test.ts`.

## What later phases defer

Intentionally not implemented here: Xbox login, PlayStation login, SuperTokens,
Connected Accounts UI, unified library UI, the provider credential store and
provider token storage, provider OAuth callbacks, automatic canonical-game
matching, the catalog/game/achievement tables, the backend adapter runtime, any
change to the `users.steam_id64` constraints, any production migration or
deploy, and any placeholder Xbox or PlayStation data. No existing UI, validator,
session, RBAC or sync behaviour was modified.
