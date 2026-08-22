/**
 * Steam compatibility layer (desktop-safe half).
 *
 * Pure, inert mappings between the existing Steam-shaped DTOs and the new
 * Nexus domain. Nothing here is wired into the running application in Phase 1:
 * the current Steam OpenID, sync and UI paths are untouched. Its only job is
 * to prove the existing Steam behaviour can later be wrapped by a backend
 * adapter without a rewrite.
 *
 * Mapping a Steam identity assertion onto the linked-account server record is
 * backend-owned (the auth-api Nexus module) and intentionally not part of this
 * desktop-facing layer.
 *
 * ID strategy: the "steam:<appId>" and "steam:<appId>:<apiName>" strings
 * produced here are LEGACY COMPATIBILITY KEYS ONLY. They are not future
 * database primary keys. Future rows use opaque internal/UUID ids; these
 * helpers only let the existing Steam runtime be bridged without re-keying.
 */

import type { Platform } from "../../types/index.ts";
import type {
  SteamAchievementDto,
  SteamOwnedGameDto
} from "../../types/steam.ts";
import type { NexusProvider } from "./provider.ts";
import type { LinkedPlatformAccountId } from "./identity.ts";
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
    // No userId and no provider: both are derived (user via the linked
    // account, provider via the referenced PlatformGame).
    linkedAccountId: binding.linkedAccountId,
    platformGameId,
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
    // No provider field: derived via the referenced PlatformGame.
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
    linkedAccountId: binding.linkedAccountId,
    platformAchievementId,
    unlocked: dto.unlocked,
    unlockStateKnown: true,
    unlockedAt: dto.unlockedAt,
    syncedAt
  };
}
