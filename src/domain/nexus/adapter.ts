/**
 * Platform adapter boundary.
 *
 * One shared domain contract for reading provider data. Account linking is
 * deliberately NOT part of this interface: Steam OpenID, Xbox and PlayStation
 * authentication are different protocols and pretending otherwise would bake a
 * false abstraction into the system.
 *
 * An adapter never receives credentials. It receives a linked account id and
 * resolves the credential server-side, from the encrypted credential store.
 */

import type {
  NexusProvider,
  ProviderCapabilities,
  ProviderCapability
} from "./provider.ts";
import type {
  DisconnectPlan,
  LinkedPlatformAccountId,
  NexusUserId
} from "./identity.ts";

export type AdapterSyncStatus = "success" | "partial" | "unsupported" | "failed";

export type AdapterContext = {
  readonly nexusUserId: NexusUserId;
  readonly linkedAccountId: LinkedPlatformAccountId;
  readonly providerUserId: string;
  readonly signal?: AbortSignal;
};

export type ProviderProfile = {
  readonly provider: NexusProvider;
  readonly providerUserId: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly profileUrl?: string;
};

export type SyncCounters = {
  readonly fetched: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
};

type SyncOutcomeBase = {
  readonly provider: NexusProvider;
  readonly linkedAccountId: LinkedPlatformAccountId;
  readonly status: AdapterSyncStatus;
  readonly syncedAt: string;
  readonly counters: SyncCounters;
  readonly warnings: readonly string[];
  readonly errorCode?: string;
};

export type LibrarySyncOutcome = SyncOutcomeBase & {
  readonly capability: "library";
};

export type GameSyncOutcome = SyncOutcomeBase & {
  readonly capability: "game_metadata";
  readonly providerGameId: string;
};

export type AchievementSyncRequest = {
  readonly providerGameIds: readonly string[];
  readonly reason: "manual" | "scheduled" | "post_library_sync";
};

export type AchievementSyncOutcome = SyncOutcomeBase & {
  readonly capability: "achievements";
  readonly providerGameIds: readonly string[];
  readonly unlockTransitions?: number;
};

export type DisconnectOutcome = {
  readonly provider: NexusProvider;
  readonly linkedAccountId: LinkedPlatformAccountId;
  readonly plan: DisconnectPlan;
  readonly credentialRevoked: boolean;
  readonly removedOwnershipRows: number;
  readonly removedAchievementStateRows: number;
  readonly completedAt: string;
};

export interface PlatformAdapter {
  readonly provider: NexusProvider;
  readonly capabilities: ProviderCapabilities;
  getProfile(context: AdapterContext): Promise<ProviderProfile>;
  syncLibrary(context: AdapterContext): Promise<LibrarySyncOutcome>;
  syncGame(
    context: AdapterContext,
    providerGameId: string
  ): Promise<GameSyncOutcome>;
  syncAchievements(
    context: AdapterContext,
    request: AchievementSyncRequest
  ): Promise<AchievementSyncOutcome>;
  disconnect(context: AdapterContext): Promise<DisconnectOutcome>;
}

/** Linking strategies are provider-shaped on purpose. */
export type SteamOpenIdLinkStrategy = {
  readonly provider: "steam";
  readonly protocol: "steam_openid";
  readonly returnsProviderTokens: false;
  readonly verification: "openid_check_authentication";
};

export type DeferredLinkStrategy = {
  readonly provider: "xbox" | "playstation";
  readonly protocol: "undetermined";
  readonly status: "discovery_pending";
};

export type AccountLinkStrategy =
  | SteamOpenIdLinkStrategy
  | DeferredLinkStrategy;

export function linkStrategyFor(provider: NexusProvider): AccountLinkStrategy {
  if (provider === "steam") {
    return {
      provider: "steam",
      protocol: "steam_openid",
      returnsProviderTokens: false,
      verification: "openid_check_authentication"
    };
  }
  return { provider, protocol: "undetermined", status: "discovery_pending" };
}

export function emptyCounters(): SyncCounters {
  return {
    fetched: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0
  };
}

export function adapterSupports(
  adapter: Pick<PlatformAdapter, "capabilities">,
  capability: ProviderCapability
): boolean {
  return adapter.capabilities[capability] === "supported";
}

/** Honest refusal for a capability a provider cannot supply. */
export function unsupportedLibrarySync(
  provider: NexusProvider,
  linkedAccountId: LinkedPlatformAccountId,
  syncedAt: string
): LibrarySyncOutcome {
  return {
    provider,
    linkedAccountId,
    capability: "library",
    status: "unsupported",
    syncedAt,
    counters: emptyCounters(),
    warnings: ["capability_unsupported"],
    errorCode: "capability_unsupported"
  };
}

export function unsupportedAchievementSync(
  provider: NexusProvider,
  linkedAccountId: LinkedPlatformAccountId,
  providerGameIds: readonly string[],
  syncedAt: string
): AchievementSyncOutcome {
  return {
    provider,
    linkedAccountId,
    capability: "achievements",
    status: "unsupported",
    syncedAt,
    providerGameIds,
    counters: emptyCounters(),
    warnings: ["capability_unsupported"],
    errorCode: "capability_unsupported"
  };
}
