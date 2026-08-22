/**
 * Contract validators for the Nexus multi-platform foundation (correction pass).
 *
 * These validate the new domain rules only: completion truth, canonical trust,
 * ownership integrity, id strategy, the backend-only adapter boundary and the
 * public/server credential split. They do not touch, relax or re-implement any
 * existing Steam validator.
 */

import {
  NEXUS_PROVIDERS,
  PROVIDER_CAPABILITIES,
  capabilityStatus,
  isNexusProvider,
  isProviderLinkable,
  providerDescriptor,
  supportsCapability,
  visibleCapabilities
} from "./provider.ts";
import type { LinkedPlatformAccount } from "./identity.ts";
import {
  evaluateAccountLink,
  findRawCredentialFields,
  planDisconnect,
  toPublicLinkedAccount
} from "./identity.ts";
import type {
  CanonicalMapping,
  PlatformGame,
  UserGameOwnership
} from "./catalog.ts";
import {
  CanonicalMappingError,
  candidateMappingFromTitleMatch,
  groupOwnershipByCanonical,
  isVerifiedMapping,
  legacySteamGameKey,
  linkPlatformGameToCanonical,
  platformGameKey,
  suggestionFromUserConfirmation
} from "./catalog.ts";
import type { UserAchievementState } from "./achievements.ts";
import {
  canCompareProviderScores,
  legacySteamAchievementKey,
  platformAchievementKey,
  summarizeAchievementProgress
} from "./achievements.ts";
import {
  adapterSupports,
  linkStrategyFor,
  unsupportedLibrarySync
} from "./adapter.ts";
import {
  fromLegacyPlatform,
  linkedAccountFromSteamProfile,
  ownershipFromSteamOwnedGame,
  platformAchievementFromSteam,
  platformGameFromSteamOwnedGame,
  steamPlatformGameKey,
  toLegacyPlatform
} from "./steamCompatibility.ts";

const NOW = "2026-08-22T00:00:00.000Z";

export function validateNexusPlatformFoundation(): number {
  let assertions = 0;
  function check(condition: unknown, message: string): void {
    assertions += 1;
    if (!condition) throw new Error(`Nexus foundation validation failed: ${message}`);
  }

  // Provider and capability model -----------------------------------------
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

  // Account linking policy -------------------------------------------------
  const steamAccount: LinkedPlatformAccount = {
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
  const revokedSteam: LinkedPlatformAccount = { ...steamAccount, connectionStatus: "revoked" };
  check(
    evaluateAccountLink({
      authenticatedNexusUserId: "nexus-user-1",
      provider: "steam",
      providerUserId: "76561190000000003",
      existingAccounts: [revokedSteam]
    }).allowed,
    "a revoked link must free the provider slot again"
  );

  // Credential trust boundary ----------------------------------------------
  check(findRawCredentialFields(steamAccount).length === 0, "the Steam link must carry no credential fields");
  const leaky = { account: { provider: "xbox", access_token: "redacted-in-test" } };
  check(findRawCredentialFields(leaky).length === 1, "raw credential fields must be detected");
  const xboxAccount: LinkedPlatformAccount = {
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

  // Canonical trust model ----------------------------------------------------
  check(platformGameKey("steam", "10") === "steam:10", "provider identity keys stay provider-scoped");
  check(legacySteamGameKey(10) === "steam:10", "the legacy Steam game key is preserved for compatibility");
  const steamGame: PlatformGame = {
    id: "pg-internal-0001",
    provider: "steam",
    providerGameId: "1091500",
    title: "Cyberpunk 2077",
    firstSeenAt: NOW,
    updatedAt: NOW
  };
  const xboxGame: PlatformGame = {
    id: "pg-internal-0002",
    provider: "xbox",
    providerGameId: "9NKX70BBCDRN",
    title: "Cyberpunk 2077",
    firstSeenAt: NOW,
    updatedAt: NOW
  };
  check(steamGame.id !== steamGame.providerGameId, "the internal id is opaque and distinct from the provider key");
  check(steamGame.canonicalGameId === undefined, "platform games start without a canonical link");

  const suggestion = suggestionFromUserConfirmation(
    "sug-1",
    steamGame.id,
    "canonical-cp2077",
    "nexus-user-1",
    NOW
  );
  check(suggestion.method === "user_confirmed" && suggestion.status === "pending", "a user confirmation is only a pending suggestion");
  check(!("verifiedBy" in suggestion), "a user suggestion carries no verification evidence");
  check(suggestion.platformGameId === steamGame.id, "a suggestion references the platform game but lives outside it");

  const forgedUserMapping = {
    method: "user_confirmed",
    confidence: "verified",
    verifiedBy: "nexus-user-1",
    verifiedAt: NOW
  } as unknown as CanonicalMapping;
  check(!isVerifiedMapping(forgedUserMapping), "user_confirmed is never a verified mapping method");
  let userForgeryRejected = false;
  try {
    linkPlatformGameToCanonical(steamGame, "canonical-cp2077", forgedUserMapping, NOW);
  } catch (error) {
    userForgeryRejected =
      error instanceof CanonicalMappingError && error.code === "unverified_mapping_rejected";
  }
  check(userForgeryRejected, "a user-confirmed suggestion can never globally link PlatformGame -> CanonicalGame");

  const titleCandidate = candidateMappingFromTitleMatch(1, NOW);
  check(titleCandidate.method === "title_similarity_candidate", "title similarity stays a candidate-only hint");
  const forgedTitleMapping = titleCandidate as unknown as CanonicalMapping;
  check(!isVerifiedMapping(forgedTitleMapping), "identical titles are not verified evidence");
  let titleForgeryRejected = false;
  try {
    linkPlatformGameToCanonical(steamGame, "canonical-cp2077", forgedTitleMapping, NOW);
  } catch (error) {
    titleForgeryRejected =
      error instanceof CanonicalMappingError && error.code === "unverified_mapping_rejected";
  }
  check(titleForgeryRejected, "title-only mappings must be refused by the domain");

  const editorialVerified: CanonicalMapping = {
    method: "editorial_verified",
    confidence: "verified",
    verifiedBy: "catalog-operator",
    verifiedAt: NOW
  };
  const providerVerified: CanonicalMapping = {
    method: "provider_verified",
    confidence: "verified",
    verifiedBy: "provider-catalog-feed",
    verifiedAt: NOW
  };
  check(isVerifiedMapping(editorialVerified) && isVerifiedMapping(providerVerified), "provider and editorial verification may create shared mappings");
  const mappedSteam = linkPlatformGameToCanonical(steamGame, "canonical-cp2077", editorialVerified, NOW);
  const mappedXbox = linkPlatformGameToCanonical(xboxGame, "canonical-cp2077", providerVerified, NOW);
  check(mappedSteam.canonicalGameId === "canonical-cp2077", "verified mappings must attach");

  // Ownership integrity ------------------------------------------------------
  const ownership = (game: PlatformGame, linkedAccountId: string): UserGameOwnership => ({
    id: `${linkedAccountId}:${game.id}`,
    linkedAccountId,
    platformGameId: game.id,
    provider: game.provider,
    playtimeKnown: game.provider === "steam",
    firstSeenAt: NOW
  });
  const sampleOwnership = ownership(mappedSteam, "link-steam-1");
  check(
    !("userId" in sampleOwnership),
    "ownership carries no redundant userId; the Nexus user is derived via the linked account"
  );
  check(sampleOwnership.linkedAccountId === "link-steam-1", "ownership is keyed by the linked account");
  const portalGame: PlatformGame = {
    ...steamGame,
    id: "pg-internal-0003",
    providerGameId: "400",
    title: "Portal"
  };
  const grouped = groupOwnershipByCanonical([
    { ownership: sampleOwnership, platformGame: mappedSteam },
    { ownership: ownership(mappedXbox, "link-xbox-1"), platformGame: mappedXbox },
    { ownership: ownership(portalGame, "link-steam-1"), platformGame: portalGame }
  ]);
  check(grouped.length === 2, "unmapped platform games must not merge into a canonical group");
  check(grouped[0].providers.length === 2, "verified mappings group provider entries under one canonical game");
  check(grouped[1].key.startsWith("unmapped:"), "unmapped entries keep a provider-scoped group key");

  // Achievement completion truth ---------------------------------------------
  check(
    platformAchievementKey("steam", "10", "ACH_WIN_ONE_GAME") === "steam:10:ACH_WIN_ONE_GAME",
    "achievement provider identities stay provider and game scoped"
  );
  check(
    legacySteamAchievementKey(10, "ACH_WIN_ONE_GAME") === "steam:10:ACH_WIN_ONE_GAME",
    "the legacy Steam achievement key is preserved for compatibility"
  );
  const states: UserAchievementState[] = [
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

  // Adapter boundary -----------------------------------------------------------
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

  // Steam compatibility + legacy keys --------------------------------------------
  check(steamPlatformGameKey(10) === "steam:10", "Steam keys must match the existing steam:<appId> convention");
  check(toLegacyPlatform("steam") === "steam", "legacy UI platform values stay unchanged");
  check(fromLegacyPlatform("other") === undefined, "the legacy 'other' platform maps to no Nexus provider");
  const ownedGame = { appId: 10, name: "Counter-Strike", playtimeForeverMinutes: 120, lastPlayedUnix: 1_700_000_000 };
  const mappedGame = platformGameFromSteamOwnedGame(ownedGame, NOW);
  check(mappedGame.canonicalGameId === undefined, "Steam import must never invent a canonical mapping");
  check(mappedGame.providerGameId === "10" && mappedGame.provider === "steam", "Steam AppID becomes providerGameId");
  const mappedOwnership = ownershipFromSteamOwnedGame(ownedGame, { userId: "nexus-user-1", linkedAccountId: "link-steam-1" }, NOW);
  check(mappedOwnership.playtimeKnown && mappedOwnership.playtimeMinutes === 120, "Steam playtime is a proven capability");
  check(mappedOwnership.linkedAccountId === "link-steam-1", "ownership belongs to the linked account");
  check(!("userId" in mappedOwnership), "the compatibility layer must not reintroduce a redundant userId");
  const mappedAchievement = platformAchievementFromSteam(10, {
    apiName: "ACH_WIN_ONE_GAME",
    displayName: "Winner",
    description: "Win one game",
    hidden: false,
    iconUrl: "",
    lockedIconUrl: "",
    unlocked: true
  }, NOW);
  check(
    mappedAchievement.id === "steam:10:ACH_WIN_ONE_GAME",
    "achievement ids must match the existing steam:<appId>:<apiName> convention"
  );
  const linked = linkedAccountFromSteamProfile(
    {
      steamId: "76561190000000001",
      personaName: "Player One",
      profileUrl: "https://steamcommunity.com/id/example",
      avatarUrl: "",
      avatarMediumUrl: "",
      avatarFullUrl: "",
      visibilityState: 3
    },
    { userId: "nexus-user-1", linkedAccountId: "link-steam-1" },
    NOW
  );
  check(linked.credentialMetadata === undefined && linked.scopes.length === 0, "Steam OpenID linking stores no credentials and no scopes");
  check(linked.providerUserId === "76561190000000001", "Steam ID64 stays a provider identifier, not the Nexus identity");
  const publicLinked = toPublicLinkedAccount(linked);
  check(
    publicLinked.providerUserId === linked.providerUserId && !("credentialMetadata" in publicLinked),
    "the Steam public projection is safe and credential-free"
  );

  return assertions;
}
