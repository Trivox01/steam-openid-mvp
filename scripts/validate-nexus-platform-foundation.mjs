import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Desktop-safe domain surface (what the React/Tauri app may import).
import * as desktopBarrel from "../src/domain/nexus/index.ts";
import {
  NEXUS_PROVIDERS,
  PROVIDER_CAPABILITIES,
  capabilityStatus,
  isNexusProvider,
  isProviderLinkable,
  providerDescriptor,
  supportsCapability,
  visibleCapabilities
} from "../src/domain/nexus/provider.ts";
import {
  CanonicalMappingError,
  candidateMappingFromTitleMatch,
  groupOwnershipByCanonical,
  isVerifiedMapping,
  legacySteamGameKey,
  linkPlatformGameToCanonical,
  platformGameKey,
  suggestionFromUserConfirmation
} from "../src/domain/nexus/catalog.ts";
import {
  canCompareProviderScores,
  legacySteamAchievementKey,
  platformAchievementKey,
  summarizeAchievementProgress
} from "../src/domain/nexus/achievements.ts";
import {
  fromLegacyPlatform,
  ownershipFromSteamOwnedGame,
  platformAchievementFromSteam,
  platformGameFromSteamOwnedGame,
  steamPlatformGameKey,
  toLegacyPlatform,
  userAchievementStateFromSteam
} from "../src/domain/nexus/steamCompatibility.ts";

// Backend-owned contracts (auth-api). The desktop barrel must never expose these.
import {
  evaluateAccountLink,
  findRawCredentialFields,
  linkedAccountFromSteamIdentity,
  planDisconnect,
  toPublicLinkedAccount
} from "../services/auth-api/src/nexus/identity.ts";
import {
  adapterSupports,
  linkStrategyFor,
  unsupportedLibrarySync
} from "../services/auth-api/src/nexus/adapter.ts";

const NOW = "2026-08-22T00:00:00.000Z";
let assertions = 0;
function check(condition, message) {
  assertions += 1;
  if (!condition) {
    throw new Error(`Nexus foundation validation failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Domain contracts
// ---------------------------------------------------------------------------

// Provider and capability model.
check(NEXUS_PROVIDERS.length === 3, "provider set must be steam, xbox, playstation");
check(isNexusProvider("steam"), "steam must be a known provider");
check(!isNexusProvider("epic"), "unknown providers must be rejected");
check(PROVIDER_CAPABILITIES.length === 5, "capability set must stay explicit");
check(providerDescriptor("steam").integrationStatus === "proven", "Steam is the only proven provider");
check(
  supportsCapability("steam", "library") &&
    supportsCapability("steam", "achievements") &&
    supportsCapability("steam", "playtime") &&
    supportsCapability("steam", "game_metadata"),
  "proven Steam capabilities must stay enabled"
);
check(capabilityStatus("steam", "presence") !== "supported", "unproven presence must stay gated");
check(
  PROVIDER_CAPABILITIES.every((capability) => capabilityStatus("xbox", capability) === "unverified"),
  "Xbox capabilities must all be unverified"
);
check(
  PROVIDER_CAPABILITIES.every((capability) => capabilityStatus("playstation", capability) === "unverified"),
  "PlayStation capabilities must all be unverified"
);
check(visibleCapabilities("xbox").length === 0, "unverified providers must expose nothing to the UI");
check(visibleCapabilities("steam").length === 4, "Steam must expose exactly its proven capabilities");
check(isProviderLinkable("steam"), "Steam linking must remain available");
check(!isProviderLinkable("xbox") && !isProviderLinkable("playstation"), "unimplemented providers must not be linkable");
check(providerDescriptor("steam").expectsProviderCredentials === false, "Steam OpenID yields no provider credentials");
check(
  providerDescriptor("xbox").expectsProviderCredentials &&
    providerDescriptor("playstation").expectsProviderCredentials,
  "future providers must be modelled as credential-bearing"
);

// Account linking policy (backend-owned).
const steamAccount = {
  id: "link-steam-1",
  userId: "nexus-user-1",
  provider: "steam",
  providerUserId: "76561190000000001",
  displayName: "Player One",
  connectionStatus: "connected",
  scopes: [],
  linkedAt: NOW
};
const anonymous = evaluateAccountLink({
  authenticatedNexusUserId: null,
  provider: "steam",
  providerUserId: "76561190000000002",
  existingAccounts: []
});
check(
  anonymous.allowed === false && anonymous.reason === "unauthenticated_nexus_user",
  "linking without an authenticated Nexus user must fail"
);
const emailMatched = evaluateAccountLink({
  authenticatedNexusUserId: "nexus-user-1",
  provider: "steam",
  providerUserId: "76561190000000002",
  existingAccounts: [],
  matchedByEmailOnly: true
});
check(
  emailMatched.allowed === false && emailMatched.reason === "implicit_email_match_not_allowed",
  "email-only matching must never link accounts"
);
const disabledProvider = evaluateAccountLink({
  authenticatedNexusUserId: "nexus-user-1",
  provider: "xbox",
  providerUserId: "xuid-1",
  existingAccounts: []
});
check(
  disabledProvider.allowed === false && disabledProvider.reason === "provider_not_enabled",
  "unimplemented providers must not accept links"
);
const takenIdentity = evaluateAccountLink({
  authenticatedNexusUserId: "nexus-user-2",
  provider: "steam",
  providerUserId: steamAccount.providerUserId,
  existingAccounts: [steamAccount]
});
check(
  takenIdentity.allowed === false && takenIdentity.reason === "provider_account_already_linked",
  "one provider identity must not attach to two Nexus users"
);
const secondSteam = evaluateAccountLink({
  authenticatedNexusUserId: "nexus-user-1",
  provider: "steam",
  providerUserId: "76561190000000003",
  existingAccounts: [steamAccount]
});
check(
  secondSteam.allowed === false && secondSteam.reason === "duplicate_provider_for_user",
  "a Nexus user keeps at most one active account per provider"
);
const revokedSteam = { ...steamAccount, connectionStatus: "revoked" };
check(
  evaluateAccountLink({
    authenticatedNexusUserId: "nexus-user-1",
    provider: "steam",
    providerUserId: "76561190000000003",
    existingAccounts: [revokedSteam]
  }).allowed,
  "a revoked link must free the provider slot again"
);

// Credential trust boundary (backend-owned).
check(findRawCredentialFields(steamAccount).length === 0, "the Steam link must carry no credential fields");
const leaky = { account: { provider: "xbox", access_token: "redacted-in-test" } };
check(findRawCredentialFields(leaky).length === 1, "raw credential fields must be detected");
const xboxAccount = {
  id: "link-xbox-1",
  userId: "nexus-user-1",
  provider: "xbox",
  providerUserId: "xuid-1",
  connectionStatus: "connected",
  scopes: ["library.read"],
  credentialMetadata: {
    credentialRef: "cred-ref-1",
    encryptionKeyId: "key-1",
    revocationSupported: true
  },
  linkedAt: NOW
};
check(findRawCredentialFields(xboxAccount).length === 0, "credential references are not raw credentials");
const publicXbox = toPublicLinkedAccount(xboxAccount);
check(!("credentialMetadata" in publicXbox), "the public projection must drop credential metadata");
check(
  !("credentialRef" in publicXbox) && !("encryptionKeyId" in publicXbox),
  "credentialRef and encryptionKeyId must never be desktop-facing"
);
check(!("userId" in publicXbox), "the public projection must not leak the internal user id mapping");
const publicJson = JSON.stringify(publicXbox);
check(
  !publicJson.includes("cred-ref-1") && !publicJson.includes("key-1"),
  "the public projection must not serialise any credential locator"
);
check(publicXbox.providerUserId === "xuid-1", "the provider identity is safe to show on the desktop");
const steamDisconnect = planDisconnect(steamAccount);
check(
  steamDisconnect.credentialDisposition === "not_applicable" &&
    steamDisconnect.removesOwnership &&
    steamDisconnect.removesAchievementState &&
    steamDisconnect.retainsCanonicalCatalog,
  "Steam disconnect removes user-scoped data and keeps shared catalog rows"
);
check(
  planDisconnect(xboxAccount).credentialDisposition === "revoke_then_delete",
  "credential-bearing providers must revoke before deleting"
);
const linkedFromSteam = linkedAccountFromSteamIdentity(
  { steamId: "76561190000000001", personaName: "Player One", avatarUrl: "" },
  { userId: "nexus-user-1", linkedAccountId: "link-steam-1" },
  NOW
);
check(
  linkedFromSteam.credentialMetadata === undefined && linkedFromSteam.scopes.length === 0,
  "Steam OpenID linking stores no credentials and no scopes"
);
check(
  linkedFromSteam.providerUserId === "76561190000000001" && linkedFromSteam.userId === "nexus-user-1",
  "Steam ID64 stays a provider identifier on the backend record"
);
const publicSteam = toPublicLinkedAccount(linkedFromSteam);
check(
  publicSteam.providerUserId === linkedFromSteam.providerUserId && !("credentialMetadata" in publicSteam),
  "the Steam public projection is safe and credential-free"
);

// Canonical trust model.
check(platformGameKey("steam", "10") === "steam:10", "provider identity keys stay provider-scoped");
check(legacySteamGameKey(10) === "steam:10", "the legacy Steam game key is preserved for compatibility");
const steamGame = {
  id: "pg-internal-0001",
  provider: "steam",
  providerGameId: "1091500",
  title: "Cyberpunk 2077",
  firstSeenAt: NOW,
  updatedAt: NOW
};
const xboxGame = {
  id: "pg-internal-0002",
  provider: "xbox",
  providerGameId: "9NKX70BBCDRN",
  title: "Cyberpunk 2077",
  firstSeenAt: NOW,
  updatedAt: NOW
};
check(steamGame.id !== steamGame.providerGameId, "the internal id is opaque and distinct from the provider key");
check(steamGame.canonicalGameId === undefined, "platform games start without a canonical link");

const suggestion = suggestionFromUserConfirmation("sug-1", steamGame.id, "canonical-cp2077", "nexus-user-1", NOW);
check(suggestion.method === "user_confirmed" && suggestion.status === "pending", "a user confirmation is only a pending suggestion");
check(!("verifiedBy" in suggestion), "a user suggestion carries no verification evidence");
check(suggestion.platformGameId === steamGame.id, "a suggestion references the platform game but lives outside it");

const forgedUserMapping = {
  method: "user_confirmed",
  confidence: "verified",
  verifiedBy: "nexus-user-1",
  verifiedAt: NOW
};
check(!isVerifiedMapping(forgedUserMapping), "user_confirmed is never a verified mapping method");
let userForgeryRejected = false;
try {
  linkPlatformGameToCanonical(steamGame, "canonical-cp2077", forgedUserMapping, NOW);
} catch (error) {
  userForgeryRejected = error instanceof CanonicalMappingError && error.code === "unverified_mapping_rejected";
}
check(userForgeryRejected, "a user-confirmed suggestion can never globally link PlatformGame -> CanonicalGame");

const titleCandidate = candidateMappingFromTitleMatch(1, NOW);
check(titleCandidate.method === "title_similarity_candidate", "title similarity stays a candidate-only hint");
check(!isVerifiedMapping(titleCandidate), "identical titles are not verified evidence");
let titleForgeryRejected = false;
try {
  linkPlatformGameToCanonical(steamGame, "canonical-cp2077", titleCandidate, NOW);
} catch (error) {
  titleForgeryRejected = error instanceof CanonicalMappingError && error.code === "unverified_mapping_rejected";
}
check(titleForgeryRejected, "title-only mappings must be refused by the domain");

const editorialVerified = {
  method: "editorial_verified",
  confidence: "verified",
  verifiedBy: "catalog-operator",
  verifiedAt: NOW
};
const providerVerified = {
  method: "provider_verified",
  confidence: "verified",
  verifiedBy: "provider-catalog-feed",
  verifiedAt: NOW
};
check(
  isVerifiedMapping(editorialVerified) && isVerifiedMapping(providerVerified),
  "provider and editorial verification may create shared mappings"
);
const mappedSteam = linkPlatformGameToCanonical(steamGame, "canonical-cp2077", editorialVerified, NOW);
const mappedXbox = linkPlatformGameToCanonical(xboxGame, "canonical-cp2077", providerVerified, NOW);
check(mappedSteam.canonicalGameId === "canonical-cp2077", "verified mappings must attach");

// Ownership integrity: no userId and no provider duplication.
const ownershipOf = (game, linkedAccountId) => ({
  id: `${linkedAccountId}:${game.id}`,
  linkedAccountId,
  platformGameId: game.id,
  playtimeKnown: game.provider === "steam",
  firstSeenAt: NOW
});
const sampleOwnership = ownershipOf(mappedSteam, "link-steam-1");
check(!("userId" in sampleOwnership), "ownership carries no redundant userId; the Nexus user is derived via the linked account");
check(!("provider" in sampleOwnership), "ownership carries no provider; it is derived via the PlatformGame");
check(sampleOwnership.linkedAccountId === "link-steam-1", "ownership is keyed by the linked account");
const portalGame = { ...steamGame, id: "pg-internal-0003", providerGameId: "400", title: "Portal" };
const grouped = groupOwnershipByCanonical([
  { ownership: sampleOwnership, platformGame: mappedSteam },
  { ownership: ownershipOf(mappedXbox, "link-xbox-1"), platformGame: mappedXbox },
  { ownership: ownershipOf(portalGame, "link-steam-1"), platformGame: portalGame }
]);
check(grouped.length === 2, "unmapped platform games must not merge into a canonical group");
check(grouped[0].providers.length === 2, "providers are derived from each entry's PlatformGame");
check(grouped[1].key.startsWith("unmapped:"), "unmapped entries keep a provider-scoped group key");

// Achievement completion truth + provider normalization.
check(
  platformAchievementKey("steam", "10", "ACH_WIN_ONE_GAME") === "steam:10:ACH_WIN_ONE_GAME",
  "achievement provider identities stay provider and game scoped"
);
check(
  legacySteamAchievementKey(10, "ACH_WIN_ONE_GAME") === "steam:10:ACH_WIN_ONE_GAME",
  "the legacy Steam achievement key is preserved for compatibility"
);
const states = [
  { id: "s1", linkedAccountId: "link-steam-1", platformAchievementId: "steam:10:A", unlocked: true, unlockStateKnown: true },
  { id: "s2", linkedAccountId: "link-steam-1", platformAchievementId: "steam:10:B", unlocked: false, unlockStateKnown: true },
  { id: "s3", linkedAccountId: "link-steam-1", platformAchievementId: "steam:10:C", unlocked: false, unlockStateKnown: false }
];
check(!("userId" in states[0]), "achievement state carries no redundant userId");
const summary = summarizeAchievementProgress(states);
check(summary.total === 3 && summary.known === 2 && summary.unknown === 1 && summary.unlocked === 1, "unknown unlock state must not count as locked");
check(summary.completionPercentage === null, "an exact completion figure is impossible while unknown states exist");
check(summary.knownCompletionPercentage === 50, "the diagnostic known-only figure stays available and non-exact");
const allKnown = summarizeAchievementProgress(states.slice(0, 2));
check(allKnown.completionPercentage === 50, "completion is exact only when every state is known");
const emptySummary = summarizeAchievementProgress([]);
check(
  emptySummary.completionPercentage === null && emptySummary.knownCompletionPercentage === null,
  "no states means no completion figure"
);
const unknownOnly = summarizeAchievementProgress([states[2]]);
check(
  unknownOnly.completionPercentage === null && unknownOnly.knownCompletionPercentage === null,
  "known === 0 means no completion figure at all"
);
check(
  canCompareProviderScores({ kind: "xbox_gamerscore", value: 10 }, { kind: "xbox_gamerscore", value: 20 }),
  "same-provider scores are comparable"
);
check(
  !canCompareProviderScores({ kind: "xbox_gamerscore", value: 10 }, { kind: "playstation_trophy", grade: "gold" }),
  "scores must never be compared across providers"
);
check(!canCompareProviderScores({ kind: "none" }, { kind: "none" }), "Steam has no comparable score currency");

// Adapter boundary (backend-owned contract).
const steamStrategy = linkStrategyFor("steam");
check(
  steamStrategy.provider === "steam" && steamStrategy.protocol === "steam_openid",
  "Steam keeps its own OpenID linking strategy"
);
check(
  steamStrategy.provider === "steam" && steamStrategy.returnsProviderTokens === false,
  "Steam OpenID must not be modelled as a token-issuing protocol"
);
const xboxStrategy = linkStrategyFor("xbox");
check(
  xboxStrategy.provider !== "steam" && xboxStrategy.status === "discovery_pending",
  "Xbox linking must stay undetermined until discovery"
);
const refusal = unsupportedLibrarySync("playstation", "link-ps-1", NOW);
check(
  refusal.status === "unsupported" && refusal.counters.fetched === 0,
  "unsupported capabilities must return an honest empty outcome"
);
check(
  !adapterSupports({ capabilities: providerDescriptor("xbox").capabilities }, "library"),
  "adapters must gate on proven capabilities only"
);
check(
  adapterSupports({ capabilities: providerDescriptor("steam").capabilities }, "library"),
  "the Steam adapter surface must keep its library capability"
);

// Steam compatibility + legacy keys (desktop-safe half).
check(steamPlatformGameKey(10) === "steam:10", "Steam keys must match the existing steam:<appId> convention");
check(toLegacyPlatform("steam") === "steam", "legacy UI platform values stay unchanged");
check(fromLegacyPlatform("other") === undefined, "the legacy 'other' platform maps to no Nexus provider");
const ownedGame = { appId: 10, name: "Counter-Strike", playtimeForeverMinutes: 120, lastPlayedUnix: 1_700_000_000 };
const mappedGame = platformGameFromSteamOwnedGame(ownedGame, NOW);
check(mappedGame.canonicalGameId === undefined, "Steam import must never invent a canonical mapping");
check(mappedGame.providerGameId === "10" && mappedGame.provider === "steam", "Steam AppID becomes providerGameId on the PlatformGame");
const mappedOwnership = ownershipFromSteamOwnedGame(ownedGame, { linkedAccountId: "link-steam-1" }, NOW);
check(mappedOwnership.playtimeKnown && mappedOwnership.playtimeMinutes === 120, "Steam playtime is a proven capability");
check(mappedOwnership.linkedAccountId === "link-steam-1", "ownership belongs to the linked account");
check(!("userId" in mappedOwnership), "the compatibility layer must not reintroduce a redundant userId");
check(!("provider" in mappedOwnership), "the compatibility layer must not reintroduce a redundant provider");
const achievementDto = {
  apiName: "ACH_WIN_ONE_GAME",
  displayName: "Winner",
  description: "Win one game",
  hidden: false,
  iconUrl: "",
  lockedIconUrl: "",
  unlocked: true
};
const mappedAchievement = platformAchievementFromSteam(10, achievementDto, NOW);
check(
  mappedAchievement.id === "steam:10:ACH_WIN_ONE_GAME",
  "achievement ids must match the existing steam:<appId>:<apiName> convention"
);
check(!("provider" in mappedAchievement), "the mapped achievement derives its provider via the PlatformGame");
const mappedState = userAchievementStateFromSteam(10, achievementDto, { linkedAccountId: "link-steam-1" }, NOW);
check(
  mappedState.linkedAccountId === "link-steam-1" && !("userId" in mappedState),
  "unlock state belongs to the linked account only"
);

assert.ok(
  assertions >= 50,
  `expected focused coverage of the domain contracts, got ${assertions} assertions`
);

// ---------------------------------------------------------------------------
// Structural boundary guards
// ---------------------------------------------------------------------------

// A. The desktop barrel must not re-export backend-only modules or identifiers.
const barrelSource = fs.readFileSync("src/domain/nexus/index.ts", "utf8");
assert.doesNotMatch(
  barrelSource,
  /from "\.\/adapter\.ts"/,
  "the desktop barrel must not re-export the backend adapter module"
);
for (const forbidden of [
  "PlatformAdapter",
  "AdapterContext",
  "ProviderCredentialMetadata",
  "toPublicLinkedAccount",
  "evaluateAccountLink",
  "planDisconnect",
  "findRawCredentialFields",
  "assertNoRawCredentials",
  "LinkedPlatformAccountRecord",
  "LinkedAccountRepository",
  "NexusLinkedAccountService"
]) {
  assert.ok(
    !barrelSource.includes(forbidden),
    `the desktop barrel must not expose ${forbidden}`
  );
  assert.ok(
    !(forbidden in desktopBarrel),
    `the desktop barrel namespace must not contain ${forbidden}`
  );
}
for (const forbiddenValue of [
  "linkStrategyFor",
  "unsupportedLibrarySync",
  "unsupportedAchievementSync",
  "emptyCounters",
  "linkedAccountFromSteamIdentity",
  "InMemoryLinkedAccountRepository",
  "PostgresLinkedAccountRepository",
  "LinkedAccountConflictError"
]) {
  assert.ok(
    !(forbiddenValue in desktopBarrel),
    `the desktop barrel namespace must not contain backend helper ${forbiddenValue}`
  );
}

// B. The desktop domain tree contains no backend-only concepts.
const domainDir = "src/domain/nexus";
assert.ok(!fs.existsSync(path.join(domainDir, "adapter.ts")), "the adapter contract must live in the backend tree");
assert.ok(!fs.existsSync(path.join(domainDir, "validation.ts")), "contract validators live in this script, not the desktop tree");
const domainFiles = fs.readdirSync(domainDir).filter((name) => name.endsWith(".ts"));
assert.ok(domainFiles.length >= 5, "the desktop-safe Nexus domain modules must be present");
for (const file of domainFiles) {
  const source = fs.readFileSync(path.join(domainDir, file), "utf8");
  assert.doesNotMatch(source, /from "react/, `${file} must not depend on React`);
  assert.doesNotMatch(
    source,
    /from "\.\.\/\.\.\/(components|pages|state|store|hooks|repositories)\//,
    `${file} must not depend on UI or persistence layers`
  );
  assert.doesNotMatch(source, /api\.steampowered\.com|fetch\(/, `${file} must stay a pure domain module`);
  assert.doesNotMatch(
    source,
    /from "[^"]*services\/auth-api/,
    `${file} must not import the backend tree`
  );
  assert.doesNotMatch(source, /interface PlatformAdapter/, `${file} must not define the backend adapter interface`);
  assert.doesNotMatch(
    source,
    /\bLinkedPlatformAccount\b(?!Id|Public)/,
    `${file} must not reference the backend server record`
  );
  for (const forbidden of [
    "ProviderCredentialMetadata",
    "AdapterContext",
    "toPublicLinkedAccount",
    "evaluateAccountLink",
    "planDisconnect",
    "LinkedAccountRepository",
    "NexusLinkedAccountService"
  ]) {
    assert.ok(!source.includes(forbidden), `${file} must not reference backend-only ${forbidden}`);
  }
}

// C. Backend contracts exist under services/auth-api.
const backendDir = path.join("services", "auth-api", "src", "nexus");
for (const file of ["identity.ts", "adapter.ts", "index.ts"]) {
  assert.ok(fs.existsSync(path.join(backendDir, file)), `backend contract missing: services/auth-api/src/nexus/${file}`);
}
const backendIdentity = fs.readFileSync(path.join(backendDir, "identity.ts"), "utf8");
for (const marker of [
  "export type ProviderCredentialMetadata",
  "export type LinkedPlatformAccount =",
  "export function toPublicLinkedAccount",
  "export function evaluateAccountLink",
  "export function planDisconnect",
  "export function findRawCredentialFields"
]) {
  assert.ok(backendIdentity.includes(marker), `backend identity module must define ${marker}`);
}
const backendAdapter = fs.readFileSync(path.join(backendDir, "adapter.ts"), "utf8");
for (const marker of ["export interface PlatformAdapter", "export type AdapterContext"]) {
  assert.ok(backendAdapter.includes(marker), `backend adapter module must define ${marker}`);
}

// D. SuperTokens stays documented, not installed.
for (const manifest of ["package.json", "services/auth-api/package.json"]) {
  assert.doesNotMatch(
    fs.readFileSync(manifest, "utf8"),
    /supertokens/i,
    `${manifest} must not gain a SuperTokens dependency in this phase`
  );
}

// E. Phase 2A applies linked accounts and Phase 3A applies catalog/ownership.
// Credentials and achievement persistence remain deferred. Comments legitimately
// discuss deferred tables, so only executable SQL is inspected.
const migrationsDir = "services/auth-api/src/storage/postgres/migrations";
const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
assert.ok(migrations.length > 0, "existing migrations must remain in place");
const executableMigrationSql = migrations
  .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
  .join("\n")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
for (const table of [
  "provider_credentials",
  "platform_achievements",
  "user_achievement_states"
]) {
  assert.doesNotMatch(
    executableMigrationSql,
    new RegExp(table),
    `${table} must stay a proposal until a later phase applies it`
  );
}
assert.ok(
  !fs.existsSync(path.join(migrationsDir, "020_nexus_multi_platform_foundation.sql")),
  "the full catalog migration must not be added to the migrations directory"
);

const linkedAccountsMigrationName = "020_nexus_linked_platform_accounts.sql";
assert.ok(
  migrations.includes(linkedAccountsMigrationName),
  "Phase 2A must ship the linked_platform_accounts migration"
);
const linkedAccountsMigration = fs.readFileSync(
  path.join(migrationsDir, linkedAccountsMigrationName),
  "utf8"
);
for (const fragment of [
  "CREATE TABLE IF NOT EXISTS linked_platform_accounts",
  "REFERENCES users(id) ON DELETE CASCADE",
  "CHECK (provider IN ('steam', 'xbox', 'playstation'))",
  "linked_platform_accounts_revocation_consistency",
  "linked_accounts_provider_identity_uniq",
  "linked_accounts_one_per_provider_uniq",
  "WHERE revoked_at IS NULL"
]) {
  assert.ok(
    linkedAccountsMigration.includes(fragment),
    `migration 020 must contain: ${fragment}`
  );
}
// Both active-uniqueness slots must be partial on the same predicate, so ending
// a link reliably frees them.
assert.equal(
  [...linkedAccountsMigration.matchAll(/WHERE revoked_at IS NULL/g)].length >= 2,
  true,
  "both unique indexes must be partial on revoked_at IS NULL"
);
// The migration is additive: it must never rewrite the authoritative identity.
for (const forbidden of [
  /DELETE\s+FROM\s+users/i,
  /UPDATE\s+users\b/i,
  /ALTER\s+TABLE\s+users\b/i,
  /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i,
  /credential_ref|access_token|refresh_token|encryption_key/i
]) {
  assert.doesNotMatch(
    linkedAccountsMigration,
    forbidden,
    `migration 020 must not contain ${forbidden}`
  );
}
assert.match(
  linkedAccountsMigration,
  /INSERT INTO linked_platform_accounts[\s\S]*FROM users u/,
  "migration 020 must backfill existing Steam users"
);
assert.match(
  linkedAccountsMigration,
  /NOT EXISTS[\s\S]*existing\.user_id = u\.id[\s\S]*existing\.provider = 'steam'[\s\S]*existing\.provider_user_id = trim\(u\.steam_id64\)[\s\S]*existing\.revoked_at IS NULL/,
  "the backfill must skip only an already-active exact Steam mapping"
);
assert.match(
  linkedAccountsMigration,
  /ON CONFLICT \(id\) DO NOTHING/,
  "replay safety may suppress only the deterministic primary-key conflict"
);
assert.doesNotMatch(
  linkedAccountsMigration,
  /ON CONFLICT DO NOTHING/,
  "provider/user uniqueness conflicts must remain fail-closed"
);

const catalogMigrationName = "021_nexus_catalog_ownership_foundation.sql";
assert.equal(migrations.filter((name) => /^021_/.test(name)).length, 1, "Phase 3A must ship exactly one migration 021");
assert.ok(migrations.includes(catalogMigrationName), `Phase 3A migration must be named exactly ${catalogMigrationName}`);
const catalogMigration = fs.readFileSync(path.join(migrationsDir, catalogMigrationName), "utf8");
const catalogMigrationSql = catalogMigration.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
for (const table of ["canonical_games", "platform_games", "user_canonical_mapping_suggestions", "user_game_ownership"]) {
  assert.match(catalogMigrationSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "i"), `migration 021 must create ${table}`);
}
assert.match(catalogMigrationSql, /CREATE UNIQUE INDEX IF NOT EXISTS platform_games_identity_uniq\s+ON platform_games \(provider, provider_game_id\)/i, "migration 021 must enforce provider-game identity");
assert.match(catalogMigrationSql, /CREATE UNIQUE INDEX IF NOT EXISTS user_game_ownership_uniq\s+ON user_game_ownership \(linked_account_id, platform_game_id\)/i, "migration 021 must enforce ownership identity");
const ownershipMigrationTable = catalogMigrationSql.match(/CREATE TABLE IF NOT EXISTS user_game_ownership \(([\s\S]*?)\n\);/i);
assert.ok(ownershipMigrationTable, "migration 021 must define user_game_ownership");
assert.doesNotMatch(ownershipMigrationTable[1], /\buser_id\b/i, "migration 021 ownership must derive the user through linked_account_id");
assert.doesNotMatch(ownershipMigrationTable[1], /\bprovider\b/i, "migration 021 ownership must derive provider through platform_games");
assert.match(ownershipMigrationTable[1], /CONSTRAINT user_game_ownership_playtime_truth CHECK \(\s*playtime_known OR playtime_minutes IS NULL\s*\)/i, "migration 021 must preserve unknown-playtime truth");
assert.match(catalogMigrationSql, /CREATE TRIGGER user_game_ownership_provider_match[\s\S]*BEFORE INSERT OR UPDATE OF linked_account_id, platform_game_id[\s\S]*EXECUTE FUNCTION nexus_enforce_ownership_provider_match\(\)/i, "migration 021 must enforce provider consistency in the database");
const platformMigrationTable = catalogMigrationSql.match(/CREATE TABLE IF NOT EXISTS platform_games \(([\s\S]*?)\n\);/i);
assert.ok(platformMigrationTable, "migration 021 must define platform_games");
assert.match(platformMigrationTable[1], /canonical_game_id\s+uuid REFERENCES canonical_games\(id\) ON DELETE RESTRICT/i, "migration 021 canonical links must use ON DELETE RESTRICT");
assert.match(platformMigrationTable[1], /canonical_mapping_method\s+text CHECK \(canonical_mapping_method IN\s*\(\s*'provider_verified','editorial_verified'\s*\)\)/i, "migration 021 must accept only provider/editorial verified mappings");
assert.match(platformMigrationTable[1], /canonical_game_id IS NOT NULL[\s\S]*canonical_mapping_method IS NOT NULL[\s\S]*canonical_verified_by IS NOT NULL[\s\S]*canonical_verified_at IS NOT NULL/i, "migration 021 verified mappings must carry canonical id, method, verifier and timestamp");
assert.doesNotMatch(catalogMigrationSql, /provider_credentials|platform_achievements|user_achievement_states|access_token|refresh_token|session_token|credential_ref|client_secret|api_key|poll_secret|encryption_key|password/i, "migration 021 must contain no credentials, tokens, secrets or achievement persistence");

// F. Phase 2A persistence is backend-owned, flag-gated and route-free.
for (const file of ["linkedAccountRepository.ts", "linkedAccountService.ts"]) {
  assert.ok(
    fs.existsSync(path.join(backendDir, file)),
    `Phase 2A backend module missing: services/auth-api/src/nexus/${file}`
  );
}
const backendNexusBarrel = fs.readFileSync(path.join(backendDir, "index.ts"), "utf8");
for (const moduleName of ["./linkedAccountRepository.ts", "./linkedAccountService.ts"]) {
  assert.ok(
    backendNexusBarrel.includes(moduleName),
    `the backend Nexus barrel must export ${moduleName}`
  );
}
assert.ok(fs.existsSync(path.join(backendDir, "catalogRepository.ts")), "Phase 3A catalogRepository.ts must remain backend-owned");
const repositorySource = fs.readFileSync(path.join(backendDir, "linkedAccountRepository.ts"), "utf8");
for (const marker of [
  "export interface LinkedAccountRepository",
  "export class InMemoryLinkedAccountRepository",
  "export class PostgresLinkedAccountRepository",
  "export class LinkedAccountUniqueViolation",
  "findActiveByProviderIdentity",
  "findActiveByUserAndProvider"
]) {
  assert.ok(repositorySource.includes(marker), `the linked-account repository must define ${marker}`);
}
assert.doesNotMatch(
  repositorySource,
  /credential_ref|access_token|refresh_token/i,
  "Phase 2A persistence must store no credential material"
);
const serviceSource = fs.readFileSync(path.join(backendDir, "linkedAccountService.ts"), "utf8");
for (const marker of [
  "export class NexusLinkedAccountService",
  "ensureSteamLinkedAccount",
  "PROVIDER_IDENTITY_OWNED_BY_ANOTHER_USER",
  "USER_ALREADY_LINKED_TO_ANOTHER_PROVIDER_IDENTITY"
]) {
  assert.ok(serviceSource.includes(marker), `the linked-account service must define ${marker}`);
}

const configSource = fs.readFileSync("services/auth-api/src/config.ts", "utf8");
assert.ok(
  configSource.includes("NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED"),
  "the backend rollout flag must be read from the environment"
);
assert.ok(
  configSource.includes("nexusLinkedAccountsDualWriteEnabled?: boolean"),
  "the rollout flag must be optional so an unset environment keeps current behaviour"
);
const sessionSource = fs.readFileSync(
  "services/auth-api/src/authorization/sessionTokenService.ts",
  "utf8"
);
assert.match(
  sessionSource,
  /ensureAuthenticatedUser[\s\S]*ensureLinkedAccount[\s\S]*issueForUser\(user\)/,
  "the linked-account write must run after Nexus user resolution and before session issuance"
);
assert.ok(
  sessionSource.includes("ensureLinkedAccount?: EnsureSteamLinkedAccount"),
  "the dual-write hook must stay optional so the flag can disable it entirely"
);
assert.doesNotMatch(
  fs.readFileSync("services/auth-api/src/router.ts", "utf8"),
  /linked[-_]?(platform[-_]?)?account/i,
  "Phase 2A must not expose a desktop or public linked-account route"
);

// G. The rollout flag is backend-only: the desktop app must never see it.
function walkSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
for (const file of walkSourceFiles("src")) {
  const source = fs.readFileSync(file, "utf8");
  assert.ok(
    !source.includes("NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED"),
    `${file} must not carry the backend-only rollout flag`
  );
  assert.doesNotMatch(
    source,
    /services\/auth-api\/src\/nexus\/linkedAccount/,
    `${file} must not import the backend linked-account persistence layer`
  );
  assert.doesNotMatch(source, /services\/auth-api\/src\/nexus\/catalogRepository/, `${file} must not import the backend catalog persistence layer`);
}

// H. Existing Steam-first surfaces are untouched by this phase.
for (const kept of [
  "src/services/platform/PlatformProvider.ts",
  "src/services/platform/SteamProvider.ts",
  "src/services/platform/SteamLibrarySyncService.ts",
  "src/services/platform/steamLibraryValidation.ts",
  "src/types/steam.ts",
  "src/types/library.ts"
]) {
  assert.ok(fs.existsSync(kept), `${kept} must remain in place`);
}
assert.match(
  fs.readFileSync("src/types/index.ts", "utf8"),
  /export type Platform =[^;]*"steam"[^;]*"other"[^;]*;/,
  "the existing frontend Platform union must remain unchanged"
);

// I. The architecture documentation covers every required topic.
const architectureDoc = fs.readFileSync("docs/architecture/MULTI_PLATFORM_ACCOUNTS.md", "utf8");
for (const topic of [
  "Why the Nexus account is independent from Steam",
  "Module ownership",
  "Linked provider architecture",
  "Canonical game vs platform game",
  "Identity and key strategy",
  "Achievement ownership",
  "Adapter boundaries",
  "Security and token boundaries",
  "Capability differences",
  "Migration path",
  "Transitional stage",
  "Provider-neutral onboarding",
  "What Phase 1 implements",
  "What later phases defer",
  "services/auth-api/src/nexus",
  "Phase 2A",
  "NEXUS_LINKED_ACCOUNTS_DUAL_WRITE_ENABLED",
  "Phase 2B",
  "NEXUS_LINKED_ACCOUNTS_IDENTITY_RESOLUTION_ENABLED",
  "Rollout sequence",
  "Rollback behaviour"
]) {
  assert.ok(architectureDoc.includes(topic), `the architecture document must cover: ${topic}`);
}

// J. The database proposal keeps the normalized, backend-safe shape.
const dbProposal = fs.readFileSync("docs/architecture/MULTI_PLATFORM_DB_PROPOSAL.md", "utf8");
for (const topic of [
  "PRIMARY KEY",
  "REFERENCES",
  "CREATE UNIQUE INDEX",
  "uniqueness semantics",
  "Unlink behaviour",
  "Deletion and privacy behaviour",
  "connection_status",
  "revoked_at",
  "020_nexus_linked_platform_accounts.sql",
  "Backfill"
]) {
  assert.ok(dbProposal.includes(topic), `the database proposal must document: ${topic}`);
}
// linked_platform_accounts is applied now; everything else stays unapplied.
assert.match(dbProposal, /DO NOT APPLY/, "the unapplied part of the schema must stay marked");

const ownershipTable = dbProposal.match(/CREATE TABLE user_game_ownership \(([\s\S]*?)\);/);
assert.ok(ownershipTable, "user_game_ownership must be defined in the proposal");
assert.doesNotMatch(ownershipTable[1], /\buser_id\b/, "user_game_ownership must derive the Nexus user via linked_account_id");
assert.doesNotMatch(ownershipTable[1], /\bprovider\s+text\b/, "user_game_ownership must derive the provider via platform_games");

const statesTable = dbProposal.match(/CREATE TABLE user_achievement_states \(([\s\S]*?)\);/);
assert.ok(statesTable, "user_achievement_states must be defined in the proposal");
assert.doesNotMatch(statesTable[1], /\buser_id\b/, "user_achievement_states must derive the Nexus user via linked_account_id");

const achievementsTable = dbProposal.match(/CREATE TABLE platform_achievements \(([\s\S]*?)\);/);
assert.ok(achievementsTable, "platform_achievements must be defined in the proposal");
assert.doesNotMatch(
  achievementsTable[1],
  /\bprovider\s+text\b/,
  "platform_achievements must derive the provider via platform_games, not a duplicated column"
);

const linksTable = dbProposal.match(/CREATE TABLE( IF NOT EXISTS)? linked_platform_accounts \(([\s\S]*?)\);/);
assert.ok(linksTable, "linked_platform_accounts must be documented in the proposal");
assert.doesNotMatch(linksTable[2], /credential_ref/, "linked_platform_accounts must not duplicate credential_ref");

const identityResolverPath = path.join(backendDir, "steamIdentityResolver.ts");
assert.ok(fs.existsSync(identityResolverPath), "Phase 2B resolver must remain backend-owned");
const identityResolverSource = fs.readFileSync(identityResolverPath, "utf8");
assert.match(identityResolverSource, /findActiveByProviderIdentity/, "Phase 2B must read linked identities first");
assert.match(identityResolverSource, /ensureAuthenticatedUser/, "Phase 2B must retain legacy fallback");
assert.doesNotMatch(identityResolverSource, /provider_credentials|access_token|refresh_token/i, "Phase 2B must not add credentials");
const phase2bConfigSource = fs.readFileSync("services/auth-api/src/config.ts", "utf8");
assert.match(phase2bConfigSource, /NEXUS_LINKED_ACCOUNTS_IDENTITY_RESOLUTION_ENABLED/, "Phase 2B flag must be explicit");
for (const file of walkSourceFiles("src")) {
  assert.doesNotMatch(
    fs.readFileSync(file, "utf8"),
    /services\/auth-api\/src\/nexus\/steamIdentityResolver/,
    `${file} must not import the backend Phase 2B resolver`
  );
}

console.log(
  `Nexus platform validation passed (${assertions} domain assertions, ${domainFiles.length} desktop modules, ` +
    "backend Nexus contracts present, Phase 2A linked-account persistence backend-only and flag-gated, " +
    "Phase 2B identity resolution backend-only and dual-read gated, " +
    "Phase 3A catalog persistence structurally guarded)."
);
