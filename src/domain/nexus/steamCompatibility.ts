/**
 * Steam compatibility layer.
 *
 * Pure, inert mappings between the existing Steam-shaped types and the new
 * Nexus domain. Nothing in this file is wired into the running application in
 * Phase 1: the current Steam OpenID, sync and UI paths are untouched. Its only
 * job is to prove that the existing, working Steam behaviour can become a
 * backend SteamPlatformAdapter later without a rewrite.
 *
 * ID strategy (correction pass): the "steam:<appId>" and
 * "steam:<appId>:<apiName>" strings produced here are LEGACY COMPATIBILITY
 * KEYS ONLY. They are not future database primary keys. Future rows use opaque
 * internal/UUID ids; these helpers only let the existing Steam runtime be
 * bridged onto the new model without re-keying.
 */

import type { Platform } from "../../types/index.ts";
import type {
  SteamAchievementDto,
  SteamOwnedGameDto,
  SteamProfile
} from "../../types/steam.ts";
import type { NexusProvider } from "./provider.ts";
import type {
  LinkedPlatformAccount,
  LinkedPlatformAccountId,
  NexusUserId
} from "./identity.ts";
import type {
  PlatformGame,
  PlatformGameId,
  UserGameOwnership
} from "./catalog.ts";
import { legacySteamGameKey } from "./catalog.ts";
import type {
  PlatformAchievement,
  UserAchievementState
} from "./achievements.ts";
import { legacySteamAchievementKey } from "./achievements.ts";

export const STEAM_PROVIDER: NexusProvider = "steam";

export type SteamAccountBinding = {
  readonly userId: NexusUserId;
  readonly linkedAccountId: LinkedPlatformAccountId;
};

/** The existing frontend Platform union stays authoritative for the UI. */
export function toLegacyPlatform(provider: NexusProvider): Platform {
  return provider;
}

export function fromLegacyPlatform(
  platform: Platform
): NexusProvider | undefined {
  return platform === "other" ? undefined : platform;
}

/**
 * Legacy compatibility key for an existing Steam game row. Compatibility only;
 * NOT a future database primary key (those are opaque internal/UUID ids).
 */
export function steamPlatformGameKey(appId: number | string): string {
  return legacySteamGameKey(appId);
}

export function platformGameFromSteamOwnedGame(
  dto: SteamOwnedGameDto,
  observedAt: string
): PlatformGame {
  return {
    // Phase 1 bridge reuses the legacy Steam key as a stand-in id. A future
    // migration assigns real opaque internal ids; this is compatibility only.
    id: steamPlatformGameKey(dto.appId),
    provider: STEAM_PROVIDER,
    providerGameId: String(dto.appId),
    title: dto.name,
    // No canonical link is produced here. Canonical mapping requires verified
    // evidence and is out of scope for Phase 1.
    firstSeenAt: observedAt,
    updatedAt: observedAt
  };
}

export function ownershipFromSteamOwnedGame(
  dto: SteamOwnedGameDto,
  binding: SteamAccountBinding,
  observedAt: string
): UserGameOwnership {
  const platformGameId = steamPlatformGameKey(dto.appId) as PlatformGameId;
  return {
    id: `${binding.linkedAccountId}:${platformGameId}`,
    // No userId: the owning Nexus user is derived via the linked account.
    linkedAccountId: binding.linkedAccountId,
    platformGameId,
    provider: STEAM_PROVIDER,
    playtimeMinutes: dto.playtimeForeverMinutes,
    playtimeKnown: true,
    lastPlayedAt: dto.lastPlayedUnix
      ? new Date(dto.lastPlayedUnix * 1000).toISOString()
      : undefined,
    firstSeenAt: observedAt,
    lastSyncAt: observedAt
  };
}

export function platformAchievementFromSteam(
  appId: number | string,
  dto: SteamAchievementDto,
  syncedAt: string
): PlatformAchievement {
  const platformGameId = steamPlatformGameKey(appId) as PlatformGameId;
  return {
    // Legacy compatibility key as stand-in id; not a future DB PK.
    id: legacySteamAchievementKey(appId, dto.apiName),
    platformGameId,
    provider: STEAM_PROVIDER,
    providerAchievementId: dto.apiName,
    title: dto.displayName,
    description: dto.description,
    hidden: dto.hidden,
    iconUrl: dto.iconUrl || undefined,
    lockedIconUrl: dto.lockedIconUrl || undefined,
    globalUnlockPercent: dto.globalUnlockPercent,
    providerScore: { kind: "none" },
    syncedAt
  };
}

export function userAchievementStateFromSteam(
  appId: number | string,
  dto: SteamAchievementDto,
  binding: SteamAccountBinding,
  syncedAt: string
): UserAchievementState {
  const platformAchievementId = legacySteamAchievementKey(appId, dto.apiName);
  return {
    id: `${binding.linkedAccountId}:${platformAchievementId}`,
    // No userId: the owning Nexus user is derived via the linked account.
    linkedAccountId: binding.linkedAccountId,
    platformAchievementId,
    unlocked: dto.unlocked,
    unlockStateKnown: true,
    unlockedAt: dto.unlockedAt,
    syncedAt
  };
}

/**
 * Steam OpenID returns an identity assertion, not tokens, so the linked account
 * carries no scopes and no credential metadata.
 */
export function linkedAccountFromSteamProfile(
  profile: SteamProfile,
  binding: SteamAccountBinding,
  linkedAt: string,
  lastSyncAt?: string
): LinkedPlatformAccount {
  return {
    id: binding.linkedAccountId,
    userId: binding.userId,
    provider: STEAM_PROVIDER,
    providerUserId: profile.steamId,
    displayName: profile.personaName,
    avatarUrl: profile.avatarUrl,
    connectionStatus: "connected",
    scopes: [],
    linkedAt,
    lastSyncAt
  };
}
