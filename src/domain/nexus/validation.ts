/**
 * Contract validators for the Nexus multi-platform foundation.
 *
 * These validate the new domain rules only. They do not touch, relax or
 * re-implement any existing Steam validator.
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
  planDisconnect
} from "./identity.ts";
import type { PlatformGame, UserGameOwnership } from "./catalog.ts";
import {
  CanonicalMappingError,
  candidateMappingFromTitleMatch,
  groupOwnershipByCanonical,
  isVerifiedMapping,
  linkPlatformGameToCanonical,
  platformGameKey
} from "./catalog.ts";
import type { UserAchievementState } from "./achievements.ts";
import {
  canCompareProviderScores,
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

  // Credential boundary ----------------------------------------------------
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
    tokenMetadata: {
      credentialRef: "cred-ref-1",
      encryptionKeyId: "key-1",
      revocationSupported: true
    },
    linkedAt: NOW
  };
  check(findRawCredentialFields(xboxAccount).length === 0, "credential references must not look like credentials");
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

  // Canonical vs platform game --------------------------------------------
  check(platformGameKey("steam", "10") === "steam:10", "platform game keys stay provider-scoped");
  const steamGame: PlatformGame = {
    id: platformGameKey("steam", "1091500"),
    provider: "steam",
    providerGameId: "1091500",
    title: "Cyberpunk 2077",
    firstSeenAt: NOW,
    updatedAt: NOW
  };
  const xboxGame: PlatformGame = {
    id: platformGameKey("xbox", "9NKX70BBCDRN"),
    provider: "xbox",
    providerGameId: "9NKX70BBCDRN",
    title: "Cyberpunk 2077",
    firstSeenAt: NOW,
    updatedAt: NOW
  };
  check(steamGame.canonicalGameId === undefined, "platform games start without a canonical link");
  const titleCandidate = candidateMappingFromTitleMatch(1, NOW);
  check(!isVerifiedMapping(titleCandidate), "identical titles are not verified evidence");
  let rejected = false;
  try {
    linkPlatformGameToCanonical(steamGame, "canonical-cp2077", titleCandidate, NOW);
  } catch (error) {
    rejected = error instanceof CanonicalMappingError && error.code === "unverified_mapping_rejected";
  }
  check(rejected, "title-only mappings must be refused by the domain");
  const verified = {
    method: "editorial_verified" as const,
    confidence: "verified" as const,
    verifiedBy: "catalog-operator",
    verifiedAt: NOW
  };
  const mappedSteam = linkPlatformGameToCanonical(steamGame, "canonical-cp2077", verified, NOW);
  const mappedXbox = linkPlatformGameToCanonical(xboxGame, "canonical-cp2077", verified, NOW);
  check(mappedSteam.canonicalGameId === "canonical-cp2077", "verified mappings must attach");
  const ownership = (game: PlatformGame, linkedAccountId: string): UserGameOwnership => ({
    id: `${linkedAccountId}:${game.id}`,
    userId: "nexus-user-1",
    linkedAccountId,
    platformGameId: game.id,
    provider: game.provider,
    playtimeKnown: game.provider === "steam",
    firstSeenAt: NOW
  });
  const grouped = groupOwnershipByCanonical([
    { ownership: ownership(mappedSteam, "link-steam-1"), platformGame: mappedSteam },
    { ownership: ownership(mappedXbox, "link-xbox-1"), platformGame: mappedXbox },
    { ownership: ownership(steamGame, "link-steam-1"), platformGame: { ...steamGame, id: "steam:400", providerGameId: "400", title: "Portal" } }
  ]);
  check(grouped.length === 2, "unmapped platform games must not merge into a canonical group");
  check(grouped[0].providers.length === 2, "verified mappings group provider entries under one canonical game");
  check(grouped[1].key.startsWith("unmapped:"), "unmapped entries keep a provider-scoped group key");

  // Achievements -----------------------------------------------------------
  check(
    platformAchievementKey("steam", "10", "ACH_WIN_ONE_GAME") === "steam:10:ACH_WIN_ONE_GAME",
    "achievement keys stay provider and game scoped"
  );
  const states: UserAchievementState[] = [
    { id: "s1", userId: "nexus-user-1", linkedAccountId: "link-steam-1", platformAchievementId: "steam:10:A", unlocked: true, unlockStateKnown: true },
    { id: "s2", userId: "nexus-user-1", linkedAccountId: "link-steam-1", platformAchievementId: "steam:10:B", unlocked: false, unlockStateKnown: true },
    { id: "s3", userId: "nexus-user-1", linkedAccountId: "link-steam-1", platformAchievementId: "steam:10:C", unlocked: false, unlockStateKnown: false }
  ];
  const summary = summarizeAchievementProgress(states);
  check(summary.known === 2 && summary.unknown === 1 && summary.unlocked === 1, "unknown unlock state must not count as locked");
  check(summary.completionPercentage === 50, "completion is computed over known state only");
  check(summarizeAchievementProgress([]).completionPercentage === null, "no known state means no completion figure");
  check(
    canCompareProviderScores({ kind: "xbox_gamerscore", value: 10 }, { kind: "xbox_gamerscore", value: 20 }),
    "same-provider scores are comparable"
  );
  check(
    !canCompareProviderScores({ kind: "xbox_gamerscore", value: 10 }, { kind: "playstation_trophy", grade: "gold" }),
    "scores must never be compared across providers"
  );
  check(!canCompareProviderScores({ kind: "none" }, { kind: "none" }), "Steam has no comparable score currency");

  // Adapter boundary -------------------------------------------------------
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

  // Steam compatibility ----------------------------------------------------
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
  check(linked.tokenMetadata === undefined && linked.scopes.length === 0, "Steam OpenID linking stores no tokens and no scopes");
  check(linked.providerUserId === "76561190000000001", "Steam ID64 stays a provider identifier, not the Nexus identity");

  return assertions;
}
